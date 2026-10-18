import { describe, expect, it } from "vitest";
import { allowedTransitions, checkTransition, isTerminal, STATUSES, type Status } from "@/modules/work-items/workflow";

describe("workflow engine", () => {
  it("allows exactly the specified transitions", () => {
    const expected: Record<Status, Status[]> = {
      OPEN: ["IN_PROGRESS", "CANCELLED"],
      IN_PROGRESS: ["REVIEW", "CANCELLED"],
      REVIEW: ["DONE", "IN_PROGRESS", "CANCELLED"],
      DONE: [],
      CANCELLED: [],
    };
    for (const s of STATUSES) expect([...allowedTransitions(s)].sort()).toEqual([...expected[s]].sort());
  });

  it("accepts every allowed edge (with assignee where needed)", () => {
    const cases: [Status, Status, string | null][] = [
      ["OPEN", "IN_PROGRESS", "u1"],
      ["OPEN", "CANCELLED", null],
      ["IN_PROGRESS", "REVIEW", "u1"],
      ["IN_PROGRESS", "CANCELLED", "u1"],
      ["REVIEW", "DONE", "u1"],
      ["REVIEW", "IN_PROGRESS", "u1"],
      ["REVIEW", "CANCELLED", null],
    ];
    for (const [from, to, assignee] of cases) {
      expect(checkTransition(from, to, assignee)).toEqual({ ok: true, to });
    }
  });

  it("rejects every prohibited edge", () => {
    const bad: [Status, Status][] = [
      ["OPEN", "REVIEW"],
      ["OPEN", "DONE"],
      ["OPEN", "OPEN"],
      ["IN_PROGRESS", "OPEN"],
      ["IN_PROGRESS", "DONE"],
      ["IN_PROGRESS", "IN_PROGRESS"],
      ["REVIEW", "OPEN"],
      ["REVIEW", "REVIEW"],
      ["DONE", "OPEN"],
      ["DONE", "IN_PROGRESS"],
      ["DONE", "CANCELLED"],
      ["CANCELLED", "OPEN"],
      ["CANCELLED", "IN_PROGRESS"],
    ];
    for (const [from, to] of bad) {
      const r = checkTransition(from, to, "u1");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.kind).toBe("illegal");
    }
  });

  it("enforces the assignee precondition for starting work", () => {
    const r = checkTransition("OPEN", "IN_PROGRESS", null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("precondition");
  });

  it("marks terminal states", () => {
    expect(isTerminal("DONE")).toBe(true);
    expect(isTerminal("CANCELLED")).toBe(true);
    expect(isTerminal("OPEN")).toBe(false);
    expect(isTerminal("REVIEW")).toBe(false);
  });
});
