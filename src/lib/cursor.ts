import { ApiError, Errors } from "./errors";

export interface PageCursor {
  createdAt: string;
  id: string;
}

function base64UrlEncode(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

function base64UrlDecode(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}

export function encodeCursor(cursor: PageCursor): string {
  return base64UrlEncode(JSON.stringify(cursor));
}

/** Malformed cursors are a 400, never silently treated as "first page". */
export function decodeCursor(raw: string): PageCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(base64UrlDecode(raw));
  } catch {
    throw new ApiError(400, "INVALID_CURSOR", "The pagination cursor is malformed.");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as PageCursor).createdAt !== "string" ||
    typeof (parsed as PageCursor).id !== "string" ||
    Number.isNaN(Date.parse((parsed as PageCursor).createdAt))
  ) {
    throw Errors.badRequest("The pagination cursor is malformed.");
  }
  return parsed as PageCursor;
}

export function cursorFor(row: { createdAt: Date; id: string }): string {
  return encodeCursor({ createdAt: row.createdAt.toISOString(), id: row.id });
}
