// Provisional workflow (confirm against the real brief — see ENGINEERING_DECISIONS.md):
//   OPEN -> IN_PROGRESS -> REVIEW -> DONE
//   OPEN | IN_PROGRESS | REVIEW -> CANCELLED (terminal, like DONE)
//   REVIEW -> IN_PROGRESS (rework)
// Pure module: no HTTP, no DB. Unit-tested exhaustively.

export const STATUSES = ["OPEN", "IN_PROGRESS", "REVIEW", "DONE", "CANCELLED"] as const;
export type Status = (typeof STATUSES)[number];

const EDGES: Record<Status, readonly Status[]> = {
  OPEN: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["REVIEW", "CANCELLED"],
  REVIEW: ["DONE", "IN_PROGRESS", "CANCELLED"],
  DONE: [],
  CANCELLED: [],
};

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
