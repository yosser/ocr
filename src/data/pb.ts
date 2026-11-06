import PocketBase from "pocketbase";

// Default to same-origin (relative) so a hosted build talks to PocketBase on
// the same origin. Local `npm run dev` sets VITE_POCKETBASE_URL. `""` is valid:
// PocketBase resolves it against window.location in the browser.
const url = import.meta.env.VITE_POCKETBASE_URL ?? "";

export const pb = new PocketBase(url);

// React StrictMode remounts effects; auto-cancellation races with that.
pb.autoCancellation(false);

export function isPocketBaseAuthRequired(): boolean {
    const flag = import.meta.env.VITE_POCKETBASE_REQUIRE_AUTH;
    if (flag === "true") {
        return true;
    }
    if (flag === "false") {
        return false;
    }
    try {
        const parsed = new URL(url, window.location.origin);
        if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") {
            return false;
        }
        return parsed.protocol === "https:";
    } catch {
        return false;
    }
}
