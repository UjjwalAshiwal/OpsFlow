import { describe, expect, it } from "vitest";
import {
  createWorkItemSchema,
  listQuerySchema,
  updateWorkItemSchema,
} from "@/modules/work-items/schemas";
import { addMemberSchema, createTeamSchema } from "@/modules/teams";

describe("request schemas", () => {
  it("defaults priority to MEDIUM on create", () => {
    expect(createWorkItemSchema.parse({ title: "T" })).toMatchObject({ priority: "MEDIUM", description: "" });
  });

  it("rejects unknown priorities and accepts the explicit set", () => {
    for (const p of ["LOW", "MEDIUM", "HIGH", "URGENT"]) {
      expect(createWorkItemSchema.parse({ title: "T", priority: p }).priority).toBe(p);
    }
    expect(() => createWorkItemSchema.parse({ title: "T", priority: "ASAP" })).toThrow();
    expect(() => listQuerySchema.parse({ priority: "CRITICAL" })).toThrow();
  });

  it("accepts team and priority on update, filter, and roster writes", () => {
    expect(updateWorkItemSchema.parse({ version: 1, teamId: null, priority: "LOW" })).toMatchObject({
      teamId: null,
      priority: "LOW",
    });
    expect(listQuerySchema.parse({ teamId: "t1", priority: "HIGH" })).toMatchObject({
      teamId: "t1",
      priority: "HIGH",
    });
    expect(createTeamSchema.parse({ name: " Platform " })).toMatchObject({ name: "Platform" });
    expect(addMemberSchema.parse({ userId: "u1" })).toMatchObject({ role: "MEMBER" });
    expect(() => createTeamSchema.parse({ name: "  " })).toThrow();
  });
});
