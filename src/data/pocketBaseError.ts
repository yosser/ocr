import { ClientResponseError } from "pocketbase";

export function pocketBaseErrorMessage(
  error: unknown,
  fallback: string,
  uniqueMessage = "That value is already in use.",
): string {
  if (error instanceof ClientResponseError) {
    const data = error.response?.data;
    if (data && typeof data === "object") {
      for (const value of Object.values(data as Record<string, unknown>)) {
        if (!value || typeof value !== "object" || !("message" in value)) {
          continue;
        }
        const message = value.message;
        if (typeof message !== "string" || message.length === 0) {
          continue;
        }
        if (message === "Value must be unique.") {
          return uniqueMessage;
        }
        return message;
      }
    }
    if (error.message) {
      return error.message;
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}
