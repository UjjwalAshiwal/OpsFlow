import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, ME, filterParams, readFilters, toQuery } from "@/lib/filters";

const U = "u1";

describe("work-item filter mapping", () => {
  it("reads deep links, treating a missing URL as no filters", () => {
    expect(readFilters(new URLSearchParams(""))).toEqual(EMPTY_FILTERS);
    expect(readFilters(new URLSearchParams("status=REVIEW&assignee=mine&teamId=t1&q=db"))).toEqual({
      ...EMPTY_FILTERS,
      status: "REVIEW",
      assignee: "mine",
      teamId: "t1",
      q: "db",
    });
  });

  it("round-trips filters through the URL without losing any", () => {
    const f = { ...EMPTY_FILTERS, status: "OPEN", priority: "HIGH", assignee: ME, creator: "u2", teamId: "t1" };
    const url = filterParams(f).toString();
    expect(url).toBe("status=OPEN&priority=HIGH&assignee=mine&creator=u2&teamId=t1");
    // ?q= is deliberately not synced: it is applied on submit, not per keystroke.
    expect(readFilters(new URLSearchParams(url))).toEqual({ ...f, q: "" });
  });

  it("carries every filter through the URL, and ignores params that are not filters", () => {
    const f = { ...EMPTY_FILTERS, q: "db", status: "REVIEW", priority: "LOW", assignee: "u1", creator: "u2", teamId: "t3" };
    expect(readFilters(filterParams(f))).toEqual({ ...f, q: "" });
    // Unknown params (e.g. a cursor that leaked into the URL) are not filters.
    expect(readFilters(new URLSearchParams("cursor=abc&page=3"))).toEqual(EMPTY_FILTERS);
  });

  it("resolves 'mine' to the session user in the API query only", () => {
    expect(toQuery({ ...EMPTY_FILTERS, assignee: "mine", creator: "mine" }, U, 10).get("assigneeId")).toBe(U);
    expect(toQuery({ ...EMPTY_FILTERS, creator: "mine" }, U, 10).get("creatorId")).toBe(U);
    expect(toQuery({ ...EMPTY_FILTERS, assignee: "mine" }, U, 10).get("assignee")).toBe("mine");
    // No session user (session not loaded yet): the filter is omitted, never "undefined".
    const q = toQuery({ ...EMPTY_FILTERS, assignee: "mine" }, undefined, 10);
    expect(q.has("assigneeId")).toBe(false);
  });

  it("carries explicit ids, search text, and the page size to the API", () => {
    const q = toQuery({ ...EMPTY_FILTERS, assignee: "u9", creator: "u8", q: "deploy", teamId: "t1" }, U, 25);
    expect(Object.fromEntries(q)).toEqual({
      assignee: "u9",
      creator: "u8",
      teamId: "t1",
      limit: "25",
      assigneeId: "u9",
      creatorId: "u8",
      q: "deploy",
    });
  });
});
