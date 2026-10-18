"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import {
  api,
  ClientApiError,
  errorMessage,
  type ApiActivityEvent,
  type ApiUser,
  type ApiTeam,
  type ApiWorkItem,
} from "@/lib/client";
import { formatDateTime, formatRelative } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useTeamRoster } from "@/lib/use-team-roster";
import { canMutate } from "@/modules/work-items/authz";
import { allowedTransitions, HAPPY_PATH, isTerminal, PRIORITIES } from "@/modules/work-items/workflow";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ConfirmDialog,
  ErrorState,
  Field,
  FormSection,
  KeyValueRow,
  LoadingPanel,
  PageHeader,
  PriorityBadge,
  Spinner,
  StatusBadge,
  TeamBadge,
  notify,
  useRequireAuth,
} from "@/components/kit";

import { Icon } from "@/components/icons";

const FIELD_LABEL: Record<string, string> = {
  title: "title",
  description: "description",
  assigneeId: "assignee",
  team: "team",
  priority: "priority",
};

const short = (v: unknown) => {
  if (v === null || v === undefined || v === "") return "none";
  const text = String(v);
  return `“${text.length > 28 ? `${text.slice(0, 28)}…` : text}”`;
};

/** Turns a raw event into one readable sentence: who did what. */
function describe(e: ApiActivityEvent): string {
  if (e.type === "CREATED") return "created this work item";
  if (e.type === "STATE_CHANGED" && e.fromStatus && e.toStatus)
    return `moved ${e.fromStatus.replace("_", " ")} → ${e.toStatus.replace("_", " ")}`;
  const keys = Object.keys(e.changes ?? {});
  if (keys.length === 0) return "updated this work item";
  return keys
    .map((k) => {
      const change = (e.changes as Record<string, { from: unknown; to: unknown }>)[k];
      const field = FIELD_LABEL[k] ?? k;
      return `${field} ${short(change?.from)} → ${short(change?.to)}`;
    })
    .join(" · ");
}

const EVENT_STYLE: Record<string, { icon: "check" | "arrowRight" | "clock"; ring: string }> = {
  CREATED: { icon: "check", ring: "bg-status-done-surface text-status-done" },
  STATE_CHANGED: { icon: "arrowRight", ring: "bg-status-progress-surface text-status-progress" },
  FIELD_UPDATED: { icon: "clock", ring: "bg-muted text-muted-foreground" },
};

function Timeline({ events }: { events: ApiActivityEvent[] }) {
  if (events.length === 0) {
    return <p className="px-4 pb-4 text-[13px] text-muted-foreground">No activity recorded yet.</p>;
  }
  return (
    <ol className="relative space-y-0 px-4 pb-4">
      {events.map((e, i) => {
        const style = EVENT_STYLE[e.type] ?? EVENT_STYLE.FIELD_UPDATED;
        return (
          <li key={e.id} className="relative flex gap-2.5 pb-4 last:pb-0">
            {i < events.length - 1 && (
              <span aria-hidden="true" className="absolute top-7 bottom-0 left-[13px] w-px bg-border" />
            )}
            <span className={cn("z-10 mt-px flex size-[26px] shrink-0 items-center justify-center rounded-full", style.ring)}>
              <Icon name={style.icon} className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-snug text-foreground">
                <span className="font-semibold">{e.actor ? e.actor.name : "System"}</span> {describe(e)}
              </p>
              <p className="mt-0.5 text-[12px] text-muted-foreground" title={formatDateTime(e.createdAt)}>
                {formatRelative(e.createdAt)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Visualises the real transition table from modules/work-items/workflow.ts. */
function WorkflowStepper({ status }: { status: string }) {
  const path = HAPPY_PATH;
  const current = path.indexOf(status as (typeof path)[number]);
  const cancelled = status === "CANCELLED";
  return (
    <ol className="flex items-center gap-1" aria-label={`Workflow state: ${status.replace("_", " ")}`}>
      {path.map((step, i) => {
        const done = !cancelled && current > i;
        const active = !cancelled && current === i;
        return (
          <li key={step} className="flex flex-1 items-center gap-1">
            <div className="flex flex-col items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn(
                  "size-2 rounded-full ring-4",
                  active ? "bg-primary ring-primary/20" : done ? "bg-primary/40 ring-primary/10" : "bg-border ring-0",
                )}
              />
              <span
                className={cn(
                  "text-[10px] leading-none font-bold tracking-[0.04em] uppercase",
                  active ? "text-foreground" : done ? "text-muted-foreground" : "text-muted-foreground/50",
                )}
              >
                {step.replace("_", " ")}
              </span>
            </div>
            {i < path.length - 1 && (
              <span
                aria-hidden="true"
                className={cn("mt-[13px] h-px flex-1", done || (active && i < current) ? "bg-primary/35" : "bg-border")}
              />
            )}
          </li>
        );
      })}
      {cancelled && (
        <li className="ml-1.5 flex items-center">
          <StatusBadge status="CANCELLED" />
        </li>
      )}
    </ol>
  );
}

function DetailInner() {
  const { user, loading: authLoading } = useRequireAuth();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const [item, setItem] = useState<ApiWorkItem | null>(null);
  const [events, setEvents] = useState<ApiActivityEvent[]>([]);
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [conflict, setConflict] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmTo, setConfirmTo] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [teams, setTeams] = useState<ApiTeam[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const roster = useTeamRoster(editing ? teamId : "");

  const syncForm = useCallback((it: ApiWorkItem) => {
    setItem(it);
    setTitle(it.title);
    setDescription(it.description);
    setAssigneeId(it.assignee?.id ?? "");
    setTeamId(it.team?.id ?? "");
    setPriority(it.priority);
  }, []);

  async function loadDetail() {
    const [d, a] = await Promise.all([
      api<{ item: ApiWorkItem }>(`/api/work-items/${id}`),
      api<{ events: ApiActivityEvent[] }>(`/api/work-items/${id}/activity`),
    ]);
    return { item: d.item, events: a.events };
  }

  function applyDetail(loaded: { item: ApiWorkItem; events: ApiActivityEvent[] }) {
    syncForm(loaded.item);
    setEvents(loaded.events);
    setState("ready");
  }

  function failDetail(e: unknown) {
    setError(errorMessage(e));
    setErrorCode(e instanceof ClientApiError ? e.code : "");
    setState("error");
  }

  const refresh = useCallback(async () => {
    setState("loading");
    // NB: does not clear `conflict`. A 409 handler sets the message and then
    // calls refresh() to pull the newest row; clearing here wiped the
    // explanation in the same React batch, so the conflict banner never
    // rendered. Successful saves/transitions clear it explicitly instead.
    try {
      applyDetail(await loadDetail());
    } catch (e) {
      failDetail(e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    loadDetail().then(
      (loaded) => {
        if (!cancelled) applyDetail(loaded);
      },
      (e: unknown) => {
        if (!cancelled) failDetail(e);
      },
    );
    // Editor pickers only; the item and its history have already loaded above
    // and report their own errors. A failure just means an empty dropdown.
    api<{ users: ApiUser[] }>("/api/users")
      .then((d) => {
        if (!cancelled) setUsers(d.users);
      })
      .catch(() => {});
    api<{ teams: ApiTeam[] }>("/api/teams")
      .then((d) => {
        if (!cancelled) setTeams(d.teams);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, id]);

  function handleApiError(e: unknown): boolean {
    // Returns true when the view was refreshed behind the caller.
    if (e instanceof ClientApiError && e.code === "VERSION_CONFLICT") {
      setConflict(
        "This item changed while you were working. The latest version is shown below — review it and try again. Nothing was overwritten.",
      );
      refresh().catch(() => {});
      return true;
    }
    const err = e as { details?: Record<string, string[]>; message?: string };
    if (err.details) setFieldErrors(err.details);
    else notify(errorMessage(e), "error");
    return false;
  }

  async function runTransition(to: string) {
    if (!item) return;
    const body: Record<string, unknown> = { version: item.version, to };
    if (to === "IN_PROGRESS" && !item.assignee) {
      const choice = users.find((u) => u.id === user?.id) ?? users[0];
      if (!choice) {
        setConflict("Someone must be assigned before work can start. Assign this item first.");
        return;
      }
      body.assigneeId = choice.id;
    }
    setPending(true);
    try {
      const d = await api<{ item: ApiWorkItem }>(`/api/work-items/${id}/transitions`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      syncForm(d.item);
      setConflict("");
      setConfirmTo(null);
      notify(`Moved to ${to.replace("_", " ").toLowerCase()}.`);
      const a = await api<{ events: ApiActivityEvent[] }>(`/api/work-items/${id}/activity`);
      setEvents(a.events);
    } catch (e) {
      handleApiError(e);
    } finally {
      setPending(false);
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!item) return;
    setFieldErrors({});
    if (!title.trim()) {
      setFieldErrors({ title: ["Title is required."] });
      return;
    }
    setPending(true);
    try {
      const d = await api<{ item: ApiWorkItem }>(`/api/work-items/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
                    version: item.version,
                    title: title.trim(),
                    description,
                    assigneeId: assigneeId || null,
                    teamId: teamId || null,
                    priority,
                  }),
      });
      syncForm(d.item);
      setEditing(false);
      setConflict("");
      notify("Changes saved.");
      const a = await api<{ events: ApiActivityEvent[] }>(`/api/work-items/${id}/activity`);
      setEvents(a.events);
    } catch (e) {
      handleApiError(e);
    } finally {
      setPending(false);
    }
  }

  if (authLoading || !user || state === "loading") return <LoadingPanel label="Loading work item…" />;

  if (state === "error" || !item) {
    const fatal = errorCode === "NOT_FOUND" || errorCode === "FORBIDDEN";
    return (
      <ErrorState
        title={fatal ? "Work item unavailable" : "Could not load this work item"}
        body={fatal ? "It was deleted, or it belongs to a team you are not a member of." : error}
        action={
          fatal ? (
            <Button variant="secondary" onClick={() => router.push("/work-items")}>
              Back to work items
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => refresh()}>
              Retry
            </Button>
          )
        }
      />
    );
  }

  const actions = allowedTransitions(item.status);
  // Same policy the API enforces (authz.canMutate), fed the caller's team role
  // from GET /api/teams: creator, assignee, global ADMIN, or LEAD of the team.
  const mayEdit = canMutate(
    user,
    { creatorId: item.creator.id, assigneeId: item.assignee?.id ?? null, teamId: item.team?.id ?? null },
    teams.find((t) => t.id === item.team?.id)?.myRole ?? null,
  );
  // Eligible assignees are the team's roster. If the current assignee is not on
  // it (e.g. mid team change) keep them visible — the API rejects the write with
  // a clear 400 rather than silently dropping the assignment.
  const rosterIds = roster?.map((m) => m.id);
  const assigneeOptions = roster
    ? [...roster, ...(assigneeId && !rosterIds?.includes(assigneeId) ? users.filter((u) => u.id === assigneeId) : [])]
    : users;

  return (
    <div>
      <PageHeader
        title={item.title}
        description={`Created by ${item.creator.name} · ${formatRelative(item.createdAt)}`}
        meta={
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={item.status} />
            <PriorityBadge priority={item.priority} />
            {item.team && <TeamBadge name={item.team.name} />}
          </span>
        }
        action={
          <Button variant="secondary" onClick={() => router.push("/work-items")}>
            <Icon name="chevLeft" />
            Back to list
          </Button>
        }
      />

      {conflict && (
        <Alert variant="warning" className="mb-4">
          <Icon name="alert" className="mt-0.5 size-4 shrink-0 text-warning" />
          <div>
            <AlertTitle>Update conflict</AlertTitle>
            <AlertDescription>{conflict}</AlertDescription>
          </div>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {/* Workflow: where the item is, and what may happen next */}
          <Card>
            <div className="border-b border-border/70 px-4 py-3.5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-[13px] font-bold tracking-tight text-foreground">Workflow</h2>
                <span className="text-[11px] font-medium text-muted-foreground">Version {item.version}</span>
              </div>
              <WorkflowStepper status={item.status} />
            </div>
            {mayEdit && actions.length > 0 && (
              <div className="px-4 py-3.5">
                <p className="mb-2.5 text-[12px] text-muted-foreground">
                  Available transitions from {item.status.replace("_", " ").toLowerCase()}
                </p>
                <div className="flex flex-wrap gap-2">
                  {actions.map((to) => (
                    <Button
                      key={to}
                      variant={isTerminal(to) ? "secondary" : "default"}
                      size="sm"
                      disabled={pending}
                      onClick={() => (isTerminal(to) ? setConfirmTo(to) : runTransition(to))}
                    >
                      Move to {to.replace("_", " ").toLowerCase()}
                      <Icon name="arrowRight" />
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {!mayEdit && actions.length > 0 && (
              <p className="px-4 py-3.5 text-[12px] text-muted-foreground">
                You can view this item. Moving it requires being its creator, its assignee, a lead of{" "}
                {item.team ? `${item.team.name}` : "the team"}, or an admin.
              </p>
            )}
          </Card>

          {/* Description / edit form */}
          {mayEdit && editing ? (
            <Card>
              <form onSubmit={saveEdit} className="space-y-4 p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-[13px] font-bold tracking-tight text-foreground">Edit work item</h2>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                    Cancel edit
                  </Button>
                </div>
                <FormSection title="Content">
                  <Field label="Title" htmlFor="etitle" required error={fieldErrors.title?.[0]}>
                    <Input
                      id="etitle"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      maxLength={200}
                      disabled={pending}
                    />
                  </Field>
                  <Field label="Description" htmlFor="edesc" error={fieldErrors.description?.[0]}>
                    <Textarea
                      id="edesc"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={6}
                      maxLength={5000}
                      disabled={pending}
                    />
                  </Field>
                </FormSection>
                <FormSection title="Ownership" description="Assignees must be members of the item's team.">
                  <Field label="Assignee" htmlFor="eassignee" error={fieldErrors.assigneeId?.[0]}>
                    <Select
                      id="eassignee"
                      value={assigneeId}
                      onChange={(e) => setAssigneeId(e.target.value)}
                      disabled={pending}
                    >
                      <option value="">Unassigned</option>
                      {assigneeOptions.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.email})
                          {roster && !rosterIds?.includes(u.id) ? " — not on this team" : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Team" htmlFor="eteam" error={fieldErrors.teamId?.[0]}>
                      <Select
                        id="eteam"
                        value={teamId}
                        onChange={(e) => setTeamId(e.target.value)}
                        disabled={pending}
                      >
                        <option value="">No team</option>
                        {teams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Priority" htmlFor="epriority" error={fieldErrors.priority?.[0]}>
                      <Select
                        id="epriority"
                        value={priority}
                        onChange={(e) => setPriority(e.target.value)}
                        disabled={pending}
                      >
                        {PRIORITIES.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                </FormSection>
                <div className="flex gap-2 border-t border-border/70 pt-3.5">
                  <Button type="submit" disabled={pending}>
                    {pending && <Spinner />}
                    {pending ? "Saving…" : "Save changes"}
                  </Button>
                  <Button type="button" variant="secondary" disabled={pending} onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </Card>
          ) : (
            <Card>
              <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
                <h2 className="text-[13px] font-bold tracking-tight text-foreground">Description</h2>
                {mayEdit && (
                  <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                )}
              </div>
              <p className="px-4 py-4 text-[14px] leading-relaxed whitespace-pre-wrap text-foreground">
                {item.description || "No description provided."}
              </p>
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <Card>
            <h2 className="border-b border-border/70 px-4 py-3 text-[13px] font-bold tracking-tight text-foreground">
              Properties
            </h2>
            <dl className="px-4 py-1.5">
              <KeyValueRow label="Assignee">
                {item.assignee ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Avatar name={item.assignee.name} className="size-5 text-[9px]" />
                    {item.assignee.name}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Unassigned</span>
                )}
              </KeyValueRow>
              <KeyValueRow label="Creator">{item.creator.name}</KeyValueRow>
              <KeyValueRow label="Team">
                {item.team ? (
                  <Link href={`/work-items?teamId=${item.team.id}`} className="hover:text-primary hover:underline">
                    {item.team.name}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">No team</span>
                )}
              </KeyValueRow>
              <KeyValueRow label="Priority">{item.priority}</KeyValueRow>
              <KeyValueRow label="Created">{formatDateTime(item.createdAt)}</KeyValueRow>
              <KeyValueRow label="Last update">{formatRelative(item.updatedAt)}</KeyValueRow>
            </dl>
          </Card>

          <Card>
            <h2 className="border-b border-border/70 px-4 py-3 text-[13px] font-bold tracking-tight text-foreground">
              Activity history
            </h2>
            <div className="pt-3">
              <Timeline events={events} />
            </div>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmTo !== null}
        title={`Move to ${confirmTo?.replace("_", " ").toLowerCase()}?`}
        body="This is a terminal state. The item cannot move anywhere afterwards."
        confirmLabel={`Move to ${confirmTo?.replace("_", " ").toLowerCase()}`}
        danger
        pending={pending}
        onConfirm={() => confirmTo && runTransition(confirmTo)}
        onClose={() => setConfirmTo(null)}
      />
    </div>
  );
}

export default function WorkItemDetailPage() {
  return (
    <Suspense>
      <DetailInner />
    </Suspense>
  );
}
