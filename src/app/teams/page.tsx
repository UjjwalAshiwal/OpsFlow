"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, type ApiTeam } from "@/lib/client";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  EmptyState,
  ErrorState,
  Field,
  LoadingPanel,
  PageHeader,
  RoleBadge,
  Spinner,
  notify,
  useRequireAuth,
} from "@/components/kit";

import { Icon } from "@/components/icons";

function TeamCard({ team }: { team: ApiTeam }) {
  const leads = team.myRole === "LEAD";
  return (
    <Card className="group relative transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-raised">
      <Link href={`/teams/${team.id}`} className="block p-4 focus-visible:outline-none">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold",
              leads ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
            )}
          >
            {team.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-bold text-foreground">{team.name}</p>
              <RoleBadge role={team.myRole} />
            </div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {team.memberCount} {team.memberCount === 1 ? "member" : "members"} · created {formatDateTime(team.createdAt)}
            </p>
          </div>
          <Icon
            name="chevRight"
            className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          />
        </div>
        <div className="mt-3.5 flex items-center justify-between border-t border-border/70 pt-2.5">
          <span className="text-[12px] text-muted-foreground">{leads ? "You can manage this roster" : "You are a member"}</span>
          <span className="text-[12px] font-semibold text-primary">View work →</span>
        </div>
      </Link>
    </Card>
  );
}

export default function TeamsPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const router = useRouter();
  const [teams, setTeams] = useState<ApiTeam[] | null>(null);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [pending, setPending] = useState(false);

  const fetchTeams = useCallback(() => api<{ teams: ApiTeam[] }>("/api/teams"), []);
  const apply = (d: { teams: ApiTeam[] }) => {
    setTeams(d.teams);
    setState("ready");
  };
  const fail = (e: unknown) => {
    setError(errorMessage(e));
    setState("error");
  };

  // Initial mount: async work only, so state lands in the callback (no cascading render).
  useEffect(() => {
    if (!user) return;
    fetchTeams().then(apply, fail);
  }, [user, fetchTeams]);

  function retry() {
    setState("loading");
    fetchTeams().then(apply, fail);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFieldError("");
    if (!name.trim()) {
      setFieldError("Team name is required.");
      return;
    }
    setPending(true);
    try {
      const d = await api<{ team: ApiTeam }>("/api/teams", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      notify("Team created. You are its lead.");
      router.push(`/teams/${d.team.id}`);
    } catch (err) {
      const details = (err as { details?: Record<string, string[]> }).details;
      setFieldError(details?.name?.[0] ?? errorMessage(err));
      setPending(false);
    }
  }

  if (authLoading || !user) return <LoadingPanel label="Loading teams…" />;

  return (
    <div>
      <PageHeader
        title="Teams"
        description="Teams scope who can see work items and who can manage the roster."
        action={
          !creating && (
            <Button onClick={() => setCreating(true)}>
              <Icon name="plus" className="h-4 w-4" />
              New team
            </Button>
          )
        }
      />

      {creating && (
        <Card className="mb-4">
          <div className="border-b border-border/70 px-4 py-3">
            <h2 className="text-[13px] font-bold tracking-tight text-foreground">Create a team</h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              You become its lead, so you can manage the roster.
            </p>
          </div>
          <form onSubmit={submit} className="flex flex-wrap items-start gap-3 p-4">
            <div className="min-w-[240px] flex-1">
              <Field label="Team name" htmlFor="team-name" required error={fieldError}>
                <Input
                  id="team-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  placeholder="e.g. Platform"
                  disabled={pending}
                  autoFocus
                  aria-invalid={fieldError ? true : undefined}
                />
              </Field>
            </div>
            <div className="flex items-center gap-2 pt-7">
              <Button type="submit" disabled={pending}>
                {pending && <Spinner />}
                {pending ? "Creating…" : "Create team"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setCreating(false);
                  setName("");
                  setFieldError("");
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {state === "loading" && <LoadingPanel label="Loading teams…" />}

      {state === "error" && (
        <ErrorState
          title="Could not load your teams"
          body={error}
          action={
            <Button variant="secondary" onClick={retry}>
              Retry
            </Button>
          }
        />
      )}

      {state === "ready" && teams && teams.length === 0 && (
        <EmptyState
          icon="users"
          title="You are not in any teams yet"
          body="Create a team to group work items and control who can see them."
          action={
            <Button onClick={() => setCreating(true)}>
              <Icon name="plus" />
              Create your first team
            </Button>
          }
        />
      )}

      {state === "ready" && teams && teams.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {teams.map((t) => (
            <TeamCard key={t.id} team={t} />
          ))}
        </div>
      )}
    </div>
  );
}