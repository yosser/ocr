import { useCallback, useEffect, useRef, useState } from "react";
import type { RecordModel } from "pocketbase";
import { pb } from "./pb";
import { mapRecord, toMutationBody } from "./mapRecord";

export type QueryDef<TArgs, TResult> = {
    collection: string;
    kind: "list" | "one";
    filter?: (args: TArgs) => string;
    id?: (args: TArgs) => string;
    sort?: string;
    expand?: string;
    transform?: (record: RecordModel) => unknown;
    fetch?: (args: TArgs) => Promise<TResult>;
    subscribeCollections?: string[];
    readonly _result?: TResult;
};

export type MutationDef<TArgs, TResult = unknown> = {
    collection: string;
    action: "create" | "update" | "delete";
    prepare?: (args: TArgs) => Record<string, unknown>;
    execute?: (args: TArgs) => Promise<TResult>;
    readonly _pbArgs?: TArgs;
};

type SharedQuery = {
    data: unknown;
    refCount: number;
    generation: number;
    listeners: Set<() => void>;
    unsubscribers: Array<() => void>;
    collections: string[];
    load: () => Promise<void>;
};

const sharedQueries = new Map<string, SharedQuery>();
const queryDefIds = new WeakMap<object, number>();
let nextQueryDefId = 0;

function queryKey(def: QueryDef<unknown, unknown>, argsKey: string) {
    let defId = queryDefIds.get(def);
    if (defId === undefined) {
        nextQueryDefId += 1;
        defId = nextQueryDefId;
        queryDefIds.set(def, defId);
    }
    return `${defId}|${argsKey}`;
}

async function executeQuery<TArgs, TResult>(
    def: QueryDef<TArgs, TResult>,
    queryArgs: TArgs,
): Promise<TResult> {
    const collection = pb.collection(def.collection);
    const mapOne = (record: RecordModel) => {
        if (def.transform) {
            return def.transform(record);
        }
        return mapRecord(record);
    };

    if (def.fetch) {
        return def.fetch(queryArgs);
    }
    if (def.kind === "one") {
        const id = def.id ? def.id(queryArgs) : (queryArgs as { id: string }).id;
        const record = await collection.getOne(id, { expand: def.expand });
        return mapOne(record as RecordModel) as TResult;
    }
    const rawFilter = def.filter ? def.filter(queryArgs) : undefined;
    const filter = rawFilter ? rawFilter : undefined;
    const records = await collection.getFullList({
        filter,
        sort: def.sort,
        expand: def.expand,
    });
    return records.map((record) => mapOne(record as RecordModel)) as TResult;
}

function notify(entry: SharedQuery) {
    entry.listeners.forEach((listener) => {
        listener();
    });
}

function retainQuery<TArgs, TResult>(
    key: string,
    def: QueryDef<TArgs, TResult>,
    queryArgs: TArgs,
): SharedQuery {
    let entry = sharedQueries.get(key);
    if (entry) {
        entry.refCount += 1;
        return entry;
    }

    entry = {
        data: undefined,
        refCount: 1,
        generation: 0,
        listeners: new Set(),
        unsubscribers: [],
        collections: def.subscribeCollections ?? [def.collection],
        load: async () => { },
    };
    sharedQueries.set(key, entry);

    const load = async () => {
        const generation = ++entry.generation;
        try {
            const next = await executeQuery(def, queryArgs);
            if (sharedQueries.get(key) !== entry || entry.generation !== generation) {
                return;
            }
            entry.data = next;
            notify(entry);
        } catch (error) {
            if (sharedQueries.get(key) === entry && entry.generation === generation) {
                console.error(`PocketBase query failed (${def.collection}):`, error);
            }
        }
    };
    entry.load = load;

    load();

    const topic = def.kind === "one"
        ? (def.id ? def.id(queryArgs) : (queryArgs as { id: string }).id)
        : "*";
    const collections = def.subscribeCollections ?? [def.collection];
    collections.forEach((name) => {
        pb.collection(name).subscribe(name === def.collection ? topic : "*", () => {
            load();
        }).then((unsub) => {
            if (sharedQueries.get(key) !== entry) {
                unsub();
                return;
            }
            entry.unsubscribers.push(unsub);
        }).catch(() => { });
    });

    return entry;
}

function refetchQueriesFor(collection: string) {
    sharedQueries.forEach((entry) => {
        if (entry.collections.includes(collection)) {
            void entry.load();
        }
    });
}

function releaseQuery(key: string) {
    const entry = sharedQueries.get(key);
    if (!entry) {
        return;
    }
    entry.refCount -= 1;
    if (entry.refCount > 0) {
        return;
    }
    entry.generation += 1;
    entry.unsubscribers.forEach((unsub) => {
        unsub();
    });
    sharedQueries.delete(key);
}

export function useQuery<TResult>(
    def: QueryDef<void, TResult>,
    args?: "skip",
): TResult | undefined;
export function useQuery<TArgs, TResult>(
    def: QueryDef<TArgs, TResult>,
    args: TArgs | "skip",
): TResult | undefined;
export function useQuery<TArgs, TResult>(
    def: QueryDef<TArgs, TResult>,
    args?: TArgs | "skip",
): TResult | undefined {
    const skipped = args === "skip";
    const argsKey = skipped ? "skip" : JSON.stringify(args ?? {});
    const key = skipped ? "" : queryKey(def as QueryDef<unknown, unknown>, argsKey);
    const argsRef = useRef(args);
    const [, setVersion] = useState(0);

    useEffect(() => {
        argsRef.current = args;
    });

    useEffect(() => {
        if (skipped) {
            return;
        }
        const entry = retainQuery(key, def, argsRef.current as TArgs);
        const onChange = () => {
            setVersion((version) => version + 1);
        };
        entry.listeners.add(onChange);
        if (entry.data !== undefined) {
            setVersion((version) => version + 1);
        }
        return () => {
            entry.listeners.delete(onChange);
            releaseQuery(key);
        };
    }, [def, skipped, key]);

    if (skipped) {
        return undefined;
    }
    return sharedQueries.get(key)?.data as TResult | undefined;
}

export type PaginatedStatus = "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";

export type PaginatedQueryResult<TItem> = {
    results: TItem[];
    status: PaginatedStatus;
    loadMore: (numItems: number) => void;
};

const PB_PAGE_SIZE = 500;

export function usePaginatedQuery<TArgs, TItem>(
    def: QueryDef<TArgs, TItem[]>,
    args: TArgs | "skip",
    options: { initialNumItems: number },
): PaginatedQueryResult<TItem> {
    const [results, setResults] = useState<TItem[]>([]);
    const [status, setStatus] = useState<PaginatedStatus>("LoadingFirstPage");
    const skipped = args === "skip";
    const argsKey = skipped ? "skip" : JSON.stringify(args ?? {});
    const [pagination, setPagination] = useState({ argsKey, extra: 0 });
    if (pagination.argsKey !== argsKey) {
        setPagination({ argsKey, extra: 0 });
    }
    const extra = pagination.argsKey === argsKey ? pagination.extra : 0;
    const limit = options.initialNumItems + extra;
    const argsRef = useRef(args);

    useEffect(() => {
        argsRef.current = args;
    });

    useEffect(() => {
        if (skipped) {
            return;
        }

        let cancelled = false;
        let seq = 0;
        const collection = pb.collection(def.collection);
        const queryArgs = argsRef.current as TArgs;
        const mode: "first" | "more" = extra === 0 ? "first" : "more";

        const load = async (requested: number, loadMode: "first" | "more") => {
            const thisSeq = ++seq;
            setStatus(loadMode === "first" ? "LoadingFirstPage" : "LoadingMore");
            try {
                const mapOne = (record: RecordModel) => {
                    if (def.transform) {
                        return def.transform(record) as TItem;
                    }
                    return mapRecord(record) as TItem;
                };
                const rawFilter = def.filter ? def.filter(queryArgs) : undefined;
                const filter = rawFilter ? rawFilter : undefined;
                const items: TItem[] = [];
                let totalItems = 0;
                const pagesNeeded = Math.max(1, Math.ceil(requested / PB_PAGE_SIZE));
                for (let page = 1; page <= pagesNeeded; page += 1) {
                    const remaining = requested - items.length;
                    const perPage = Math.min(PB_PAGE_SIZE, remaining);
                    const result = await collection.getList(page, perPage, {
                        filter,
                        sort: def.sort,
                        expand: def.expand,
                    });
                    totalItems = result.totalItems;
                    items.push(...result.items.map((record) => mapOne(record as RecordModel)));
                    if (items.length >= result.totalItems || items.length >= requested) {
                        break;
                    }
                }
                if (!cancelled && thisSeq === seq) {
                    setResults(items);
                    setStatus(items.length >= totalItems ? "Exhausted" : "CanLoadMore");
                }
            } catch (error) {
                if (!cancelled && thisSeq === seq) {
                    console.error(`PocketBase paginated query failed (${def.collection}):`, error);
                }
            }
        };

        load(limit, mode);

        const collections = def.subscribeCollections ?? [def.collection];
        const unsubPromises = collections.map((name) =>
            pb.collection(name).subscribe("*", () => {
                load(limit, "first");
            }),
        );

        return () => {
            cancelled = true;
            unsubPromises.forEach((unsubPromise) => {
                unsubPromise.then((unsub) => {
                    unsub();
                }).catch(() => { });
            });
        };
    }, [def, skipped, argsKey, extra, limit]);

    const loadMore = useCallback((numItems: number) => {
        setPagination((current) => ({ ...current, extra: current.extra + numItems }));
    }, []);

    if (skipped) {
        return { results: [], status: "Exhausted", loadMore };
    }
    return { results, status, loadMore };
}

type MutateFn<TArgs, TResult> = (args: TArgs) => Promise<TResult>;

export function useMutation<TArgs, TResult = unknown>(
    def: MutationDef<TArgs, TResult>,
): MutateFn<TArgs, TResult> {
    const mutate: MutateFn<TArgs, TResult> = useCallback(async (args: TArgs) => {
        if (def.execute) {
            const result = await def.execute(args) as TResult;
            refetchQueriesFor(def.collection);
            return result;
        }
        const collection = pb.collection(def.collection);
        const payload = def.prepare ? def.prepare(args) : (args as Record<string, unknown>);
        const id = typeof payload.id === "string"
            ? payload.id
            : typeof payload._id === "string"
                ? payload._id
                : undefined;
        const body = toMutationBody(payload);

        if (def.action === "create") {
            const record = await collection.create(body);
            refetchQueriesFor(def.collection);
            return mapRecord(record as RecordModel) as TResult;
        }

        if (def.action === "update") {
            if (!id) {
                throw new Error(`PocketBase update on ${def.collection} requires id`);
            }
            const record = await collection.update(id, body);
            refetchQueriesFor(def.collection);
            return mapRecord(record as RecordModel) as TResult;
        }

        if (!id) {
            throw new Error(`PocketBase delete on ${def.collection} requires id`);
        }
        await collection.delete(id);
        refetchQueriesFor(def.collection);
        return undefined as TResult;
    }, [def]);
    return mutate;
}
