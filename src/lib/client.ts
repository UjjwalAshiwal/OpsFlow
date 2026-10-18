"use client";

// Minimal typed fetch wrapper. Server remains authoritative for validation,
// auth, workflow, and concurrency; this only surfaces its responses.
export class ClientApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit, extraHeaders?: Record<string, string>): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json", ...(extraHeaders ?? {}), ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ClientApiError(
      res.status,
      data?.error?.code ?? "UNKNOWN",
      data?.error?.message ?? `Request failed (${res.status}).`,
      data?.error?.details,
    );
  }
  return data as T;
}

export interface ApiUser {
  id: string;
  email: string;
  name: string;
  role: "USER" | "ADMIN";
}

export type ApiPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type ApiStatus = "OPEN" | "IN_PROGRESS" | "REVIEW" | "DONE" | "CANCELLED";

export interface ApiWorkItem {
  id: string;
  title: string;
  description: string;
  status: ApiStatus;
  priority: ApiPriority;
  version: number;
  creator: { id: string; name: string; email: string };
  assignee: { id: string; name: string; email: string } | null;
  team: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiTeam {
  id: string;
  name: string;
  memberCount: number;
  myRole: "LEAD" | "MEMBER" | null;
  createdAt: string;
}

export interface ApiTeamDetail extends ApiTeam {
  members: ({ id: string; name: string; email: string } & { role: "LEAD" | "MEMBER" })[];
  itemCount: number;
}

export interface ApiActivityEvent {
  id: string;
  type: string;
  actor: { id: string; name: string; email: string } | null;
  fromStatus: string | null;
  toStatus: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  createdAt: string;
}

export async function getSession(): Promise<{ user: ApiUser | null }> {
  return api("/api/auth/session");
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}
