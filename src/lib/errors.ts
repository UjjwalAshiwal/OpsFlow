import { NextResponse } from "next/server";
import { ZodError } from "zod";

// Every API error uses this shape: { error: { code, message, details? } }.
// Never leaks stack traces, SQL, or secrets to the client.
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const Errors = {
  unauthenticated: () => new ApiError(401, "UNAUTHENTICATED", "Authentication required."),
  forbidden: () => new ApiError(403, "FORBIDDEN", "You do not have permission for this operation."),
  notFound: (what = "Resource") => new ApiError(404, "NOT_FOUND", `${what} not found.`),
  badRequest: (message: string, details?: unknown) =>
    new ApiError(400, "BAD_REQUEST", message, details),
  invalidTransition: (from: string, to: string) =>
    new ApiError(422, "INVALID_TRANSITION", `Transition from ${from} to ${to} is not allowed.`),
  staleVersion: () =>
    new ApiError(
      409,
      "VERSION_CONFLICT",
      "The item was modified by someone else. Reload and retry.",
    ),
  idempotencyConflict: () =>
    new ApiError(
      409,
      "IDEMPOTENCY_KEY_REUSE",
      "This idempotency key was already used with a different request.",
    ),
  idempotencyInProgress: () =>
    new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "An identical request is already in progress."),
};

export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } },
      { status: err.status },
    );
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid request.", details: err.flatten().fieldErrors } },
      { status: 400 },
    );
  }
  console.error(err);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Something went wrong." } },
    { status: 500 },
  );
}
