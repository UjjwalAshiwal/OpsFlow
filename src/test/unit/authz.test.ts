import { describe, expect, it } from "vitest";
import { canMutate, canRead } from "@/modules/work-items/authz";
import type { SessionUser } from "@/lib/auth";

const admin: SessionUser = { id: "a", email: "a@x.io", name: "A", role: "ADMIN" };
const creator: SessionUser = { id: "c", email: "c@x.io", name: "C", role: "USER" };
const assignee: SessionUser = { id: "s", email: "s@x.io", name: "S", role: "USER" };
const outsider: SessionUser = { id: "o", email: "o@x.io", name: "O", role: "USER" };
const lead: SessionUser = { id: "l", email: "l@x.io", name: "L", role: "USER" };
const member: SessionUser = { id: "m", email: "m@x.io", name: "M", role: "USER" };
const item = { creatorId: "c", assigneeId: "s", teamId: null as string | null };

describe("authorization policy", () => {
  it("lets creator, assignee, and admin mutate teamless items", () => {
    expect(canMutate(creator, item)).toBe(true);
    expect(canMutate(assignee, item)).toBe(true);
    expect(canMutate(admin, item)).toBe(true);
  });

  it("denies unrelated users on teamless items", () => {
    expect(canMutate(outsider, item)).toBe(false);
    expect(canMutate(outsider, { creatorId: "c", assigneeId: null, teamId: null })).toBe(false);
  });

  it("lets admin mutate unassigned items", () => {
    expect(canMutate(admin, { creatorId: "c", assigneeId: null, teamId: null })).toBe(true);
  });

  it("shows teamless items to every authenticated user", () => {
    expect(canRead(outsider, item)).toBe(true);
    expect(canRead(admin, item)).toBe(true);
  });

  it("hides team items from non-members (plain 404 downstream)", () => {
    const teamItem = { teamId: "t1" };
    expect(canRead(outsider, teamItem)).toBe(false);
    expect(canRead(member, teamItem, "MEMBER")).toBe(true);
    expect(canRead(lead, teamItem, "LEAD")).toBe(true);
    expect(canRead(admin, teamItem)).toBe(true);
  });

  it("lets leads mutate team items but not plain members", () => {
    const teamItem = { creatorId: "c", assigneeId: "s", teamId: "t1" };
    expect(canMutate(lead, teamItem, "LEAD")).toBe(true);
    expect(canMutate(member, teamItem, "MEMBER")).toBe(false);
    expect(canMutate(outsider, teamItem)).toBe(false);
    // Involvement still grants mutation regardless of team role.
    expect(canMutate(creator, teamItem, null)).toBe(true);
    expect(canMutate(assignee, teamItem, "MEMBER")).toBe(true);
    expect(canMutate(admin, teamItem)).toBe(true);
  });
});
