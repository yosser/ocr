import type { RecordModel } from "pocketbase";

export type PbDoc<T extends Record<string, unknown> = Record<string, unknown>> = T & {
    id: string;
    _id: string;
    _creationTime: number;
    created: string;
    updated: string;
};

const META_KEYS = new Set([
    "id",
    "_id",
    "_creationTime",
    "collectionId",
    "collectionName",
    "expand",
    "created",
    "updated",
]);

export function mapRecord<T extends Record<string, unknown> = Record<string, unknown>>(
    record: RecordModel,
): PbDoc<T> {
    return {
        ...(record as unknown as T),
        id: record.id,
        _id: record.id,
        created: record.created as string,
        updated: record.updated as string,
        _creationTime: record.created ? Date.parse(record.created as string) : 0,
    };
}

export function toMutationBody(payload: Record<string, unknown>): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
        if (META_KEYS.has(key)) {
            continue;
        }
        if (value === undefined) {
            continue;
        }
        body[key] = value;
    }
    return body;
}
