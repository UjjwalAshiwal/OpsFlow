import { describe, expect, it } from "vitest";
import { cursorFor, decodeCursor, encodeCursor } from "@/lib/cursor";

describe("cursor pagination helpers", () => {
  it("round-trips", () => {
    const c = encodeCursor({ createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(), id: "abc" });
    expect(decodeCursor(c)).toEqual({ createdAt: "2026-01-01T00:00:00.000Z", id: "abc" });
  });

  it("derives a cursor from a row", () => {
    const at = new Date("2026-05-05T05:05:05.000Z");
    expect(decodeCursor(cursorFor({ createdAt: at, id: "x1" }))).toEqual({
      createdAt: at.toISOString(),
      id: "x1",
    });
  });

  it("rejects garbage, wrong shapes, and bad dates", () => {
    const bad = ["", "!!!", "aGk=", Buffer.from(JSON.stringify({ foo: 1 })).toString("base64url")];
    for (const b of bad) expect(() => decodeCursor(b)).toThrowError(/cursor/i);
    const badDate = Buffer.from(JSON.stringify({ createdAt: "yesterday", id: "x" })).toString("base64url");
    expect(() => decodeCursor(badDate)).toThrowError(/cursor/i);
  });
});
