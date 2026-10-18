// Provisional workflow (confirm against the real brief — see ENGINEERING_DECISIONS.md):
//   OPEN -> IN_PROGRESS -> REVIEW -> DONE
//   OPEN | IN_PROGRESS | REVIEW -> CANCELLED (terminal, like DONE)
//   REVIEW -> IN_PROGRESS (rework)
// Pure module: no HTTP, no DB. Unit-tested exhaustively.

export const STATUSES = ["OPEN", "IN_PROGRESS", "REVIEW", "DONE", "CANCELLED"] as const;
export type Status = (typeof STATUSES)[number];

// Pure constants shared by the server (zod schemas) and the client (filter and
// priority pickers). Kept here, not in schemas.ts, because this module imports
// nothing and is already pulled into client bundles.
export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type Priority = (typeof PRIORITIES)[number];

const EDGES: Record<Status, readonly Status[]> = {
  OPEN: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["REVIEW", "CANCELLED"],
  REVIEW: ["DONE", "IN_PROGRESS", "CANCELLED"],
  DONE: [],
  CANCELLED: [],
};

/** The happy path, in order: the linear spine the stepper visualises. */
export const HAPPY_PATH = ["OPEN", "IN_PROGRESS", "REVIEW", "DONE"] as const;

export type TransitionCheck =
  | { ok: true; to: Status }
  | { ok: false; kind: "illegal" | "precondition"; reason: string };

export function allowedTransitions(from: Status): readonly Status[] {
  return EDGES[from];
}

export function isTerminal(status: Status): boolean {
  return EDGES[status].length === 0;
}

/**
 * Pure transition validation. `assigneeId` is the value the item would have
 * AFTER the requested edit (pass the post-update value so callers can allow
 * "assign + start" in one request).
 */
export function checkTransition(from: Status, to: Status, assigneeId: string | null): TransitionCheck {
  if (!EDGES[from].includes(to)) {
    return { ok: false, kind: "illegal", reason: `Transition from ${from} to ${to} is not allowed.` };
  }
  if (to === "IN_PROGRESS" && !assigneeId) {
    return { ok: false, kind: "precondition", reason: "An assignee is required before work can start." };
  }
  return { ok: true, to };
}
