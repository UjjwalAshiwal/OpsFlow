import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ClientApiError } from "@/lib/client";

type FetchCall = { url: string; init: RequestInit };

function stubFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const calls: FetchCall[] = [];
  const fake = {
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: response.json ?? (async () => ({})),
  };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return fake as Response;
  });
  return calls;
}

const headersOf = (call: FetchCall) => call.init.headers as Record<string, string>;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api() request shape", () => {
  it("defaults to a same-origin JSON request", async () => {
    const calls = stubFetch({ json: async () => ({ ok: true }) });
    await api("/api/teams");

    expect(calls[0].url).toBe("/api/teams");
    expect(headersOf(calls[0])["Content-Type"]).toBe("application/json");
    expect(calls[0].init.credentials).toBe("same-origin");
  });

  it("passes caller headers through instead of dropping them", async () => {
    const calls = stubFetch({ json: async () => ({}) });
    await api("/api/work-items", { method: "POST", headers: { "Idempotency-Key": "k1" } });

    expect(headersOf(calls[0])["Idempotency-Key"]).toBe("k1");
    expect(headersOf(calls[0])["Content-Type"]).toBe("application/json");
    expect(calls[0].init.method).toBe("POST");
  });

  it("lets an explicit Content-Type override the default", async () => {
    const calls = stubFetch({ json: async () => ({}) });
    await api("/api/work-items", { headers: { "Content-Type": "text/plain" } });

    expect(headersOf(calls[0])["Content-Type"]).toBe("text/plain");
  });

  it("returns the parsed body on success", async () => {
    stubFetch({ json: async () => ({ teams: [] }) });
    await expect(api<{ teams: unknown[] }>("/api/teams")).resolves.toEqual({ teams: [] });
  });

  it("raises ClientApiError carrying the server's code, message and details", async () => {
    stubFetch({
      ok: false,
      status: 409,
      json: async () => ({ error: { code: "VERSION_CONFLICT", message: "stale", details: { title: ["required"] } } }),
    });

    await expect(api("/api/work-items/x")).rejects.toBeInstanceOf(ClientApiError);
    await expect(api("/api/work-items/x")).rejects.toMatchObject({
      status: 409,
      code: "VERSION_CONFLICT",
      message: "stale",
      details: { title: ["required"] },
    });
  });

  it("falls back to a generic code and message on an unparseable error body", async () => {
    stubFetch({ ok: false, status: 500, json: async () => Promise.reject(new Error("not json")) });
    await expect(api("/api/teams")).rejects.toMatchObject({ status: 500, code: "UNKNOWN" });
  });
});