"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  api,
  ClientApiError,
  errorMessage,
  type ApiTeamDetail,
  type ApiUser,
} from "@/lib/client";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import {
  ConfirmDialog,
  ErrorState,
  KeyValueRow,
  LoadingPanel,
  PageHeader,
  RoleBadge,
  Spinner,
  notify,
  useRequireAuth,
} from "@/components/kit";

import { Icon } from "@/components/icons";

const ROLES = ["MEMBER", "LEAD"] as const;

function RosterTable({
  team,
  canManage,
  busyMember,
  onRole,
  onRemove,
}: {
  team: ApiTeamDetail;
  canManage: boolean;
  busyMember: string;
  onRole: (userId: string, role: "MEMBER" | "LEAD") => void;
  onRemove: (userId: string, name: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-subtle/70">
          <tr>
            {["Member", "Role", ""].map((h, i) => (
              <th
                key={i}
                scope="col"
                className="h-9 px-4 text-left text-[11px] font-bold tracking-[0.05em] text-muted-foreground uppercase first:pl-4 last:pr-4"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {team.members.map((m) => (
            <tr key={m.id} className="border-b border-border/80 transition-colors last:border-0 hover:bg-primary/[0.035]">
              <td className="px-4 py-2.5">
                <span className="flex items-center gap-2.5">
                  <Avatar name={m.name} className="size-7 text-[10px]" />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-foreground">{m.name}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">{m.email}</span>
                  </span>
                </span>
              </td>
              <td className="px-4 py-2.5">
                {canManage ? (
                  <label className="block w-32">
                    <span className="sr-only">Role for {m.name}</span>
                    <Select
                      value={m.role}
                      disabled={busyMember === m.id}
                      onChange={(e) => onRole(m.id, e.target.value as "MEMBER" | "LEAD")}
                      className="h-8 py-0 text-[12px]"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r === "LEAD" ? "Lead" : "Member"}
                        </option>
                      ))}
                    </Select>
                  </label>
                ) : (
                  <RoleBadge role={m.role} />
                )}
              </td>
              <td className="px-4 py-2.5 text-right">
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyMember === m.id}
                    onClick={() => onRemove(m.id, m.name)}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Icon name="x" />
                    Remove
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function TeamDetailPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const [team, setTeam] = useState<ApiTeamDetail | null>(null);
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [busyMember, setBusyMember] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const fetchTeam = useCallback(() => api<{ team: ApiTeamDetail }>(`/api/teams/${id}`), [id]);
  const apply = (d: { team: ApiTeamDetail }) => {
    setTeam(d.team);
    setState("ready");
  };
  const fail = (e: unknown) => {
    setError(errorMessage(e));
    setErrorCode(e instanceof ClientApiError ? e.code : "");
    setState("error");
  };
  const refresh = useCallback(() => {
    setState("loading");
    return fetchTeam().then(apply, fail);
  }, [fetchTeam]);

  useEffect(() => {
    if (!user) return;
    fetchTeam().then(apply, fail);
    // Assignee picker only; the roster and item count come from fetchTeam,
    // which reports its own failure. A failure here just empties the picker.
    api<{ users: ApiUser[] }>("/api/users")
      .then((d) => setUsers(d.users))
      .catch(() => {});
  }, [user, fetchTeam]);

  // Backend treats a global ADMIN as LEAD-equivalent (modules/teams.ts).
  const canManage = !!user && (user.role === "ADMIN" || team?.myRole === "LEAD");
  const candidates = users.filter((u) => !team?.members.some((m) => m.id === u.id));

  async function changeRole(userId: string, role: "MEMBER" | "LEAD") {
    setBusyMember(userId);
    try {
      await api(`/api/teams/${id}/members`, {
        method: "POST",
        body: JSON.stringify({ userId, role }),
      });
      notify(`${role === "LEAD" ? "Lead" : "Member"} role updated.`);
      await refresh();
    } catch (e) {
      notify(errorMessage(e), "error");
      await refresh();
    } finally {
      setBusyMember("");
    }
  }

  async function removeMember(userId: string, name: string) {
    setBusyMember(userId);
    try {
      await api(`/api/teams/${id}/members/${userId}`, { method: "DELETE" });
      notify(`${name} removed from the team.`);
      await refresh();
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setBusyMember("");
    }
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    setAddError("");
    if (!candidateId) {
      setAddError("Choose someone to add.");
      return;
    }
    setAdding(true);
    try {
      await api(`/api/teams/${id}/members`, {
        method: "POST",
        body: JSON.stringify({ userId: candidateId, role: "MEMBER" }),
      });
      notify("Member added.");
      setCandidateId("");
      await refresh();
    } catch (err) {
      setAddError(errorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  async function deleteTeam() {
    setDeleting(true);
    setDeleteError("");
    try {
      await api(`/api/teams/${id}`, { method: "DELETE" });
      notify("Team deleted.");
      router.push("/teams");
    } catch (e) {
      setDeleteError(errorMessage(e));
      setDeleting(false);
    }
  }

  if (authLoading || !user) return <LoadingPanel label="Loading team…" />;

  if (state === "loading") return <LoadingPanel label="Loading team…" />;

  if (state === "error" || !team) {
    const fatal = errorCode === "NOT_FOUND" || errorCode === "FORBIDDEN";
    return (
      <ErrorState
        title={fatal ? "Team unavailable" : "Could not load this team"}
        body={fatal ? "You are not a member of this team, or it no longer exists." : error}
        action={
          <Button variant="secondary" onClick={() => (fatal ? router.push("/teams") : refresh())}>
            {fatal ? "Back to teams" : "Retry"}
          </Button>
        }
      />
    );
  }

  return (
    <div>
      <PageHeader
        title={team.name}
        description={`${team.memberCount} ${team.memberCount === 1 ? "member" : "members"} · ${team.itemCount} work ${
          team.itemCount === 1 ? "item" : "items"
        }${team.myRole ? ` · you are ${team.myRole === "LEAD" ? "a lead" : "a member"}` : " · you are not a member"}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => router.push("/teams")}>
              <Icon name="chevLeft" />
              All teams
            </Button>
            <Link href={`/work-items?teamId=${team.id}`}>
              <Button variant="secondary">View team work</Button>
            </Link>
            {canManage && (
              <Button variant="secondary" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                Delete team
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
            <div>
              <h2 className="text-[13px] font-bold tracking-tight text-foreground">
                Members · {team.members.length}
              </h2>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {canManage
                  ? "Leads manage the roster and can mutate any item in this team."
                  : "Only team leads can change the roster."}
              </p>
            </div>
          </div>
          <RosterTable
            team={team}
            canManage={canManage}
            busyMember={busyMember}
            onRole={changeRole}
            onRemove={removeMember}
          />
          {canManage && (
            <form onSubmit={addMember} className="border-t border-border/70 bg-subtle/40 p-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[220px] flex-1">
                  <label htmlFor="add-member" className="mb-1.5 block text-[13px] font-semibold text-foreground">
                    Add a member
                  </label>
                  <Select
                    id="add-member"
                    value={candidateId}
                    onChange={(e) => setCandidateId(e.target.value)}
                    disabled={adding || candidates.length === 0}
                  >
                    <option value="">
                      {candidates.length === 0 ? "Everyone is already a member" : "Choose someone…"}
                    </option>
                    {candidates.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.email})
                      </option>
                    ))}
                  </Select>
                </div>
                <Button type="submit" disabled={adding || candidates.length === 0}>
                  {adding && <Spinner />}
                  {adding ? "Adding…" : "Add member"}
                </Button>
              </div>
              {addError && (
                <p role="alert" className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-destructive">
                  <Icon name="alert" className="size-3.5" />
                  {addError}
                </p>
              )}
            </form>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <h2 className="border-b border-border/70 px-4 py-3 text-[13px] font-bold tracking-tight text-foreground">
              Team
            </h2>
            <dl className="px-4 py-1.5">
              <KeyValueRow label="Your role">
                <RoleBadge role={team.myRole} />
              </KeyValueRow>
              <KeyValueRow label="Members">
                <span className="tabular-nums">{team.memberCount}</span>
              </KeyValueRow>
              <KeyValueRow label="Work items">
                <span className="tabular-nums">{team.itemCount}</span>
              </KeyValueRow>
            </dl>
            <div className="px-4 pb-4">
              <Button asChild variant="secondary" size="sm" className="w-full">
                <Link href={`/work-items?teamId=${team.id}`}>
                  View team work
                  <Icon name="arrowRight" />
                </Link>
              </Button>
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="text-[12px] font-bold tracking-[0.02em] text-foreground">What leads can do</h2>
            <ul className="mt-2 space-y-1.5 text-[12px] text-muted-foreground">
              {["Add and remove members", "Promote members to lead", "Edit and move any item in this team"].map((t) => (
                <li key={t} className="flex items-start gap-1.5">
                  <Icon name="check" className="mt-0.5 size-3 shrink-0 text-status-done" />
                  {t}
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-border/70 pt-2.5 text-[12px] text-muted-foreground">
              The last lead cannot be removed, and a team holding work items cannot be deleted.
            </p>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${team.name}?`}
        body={
          deleteError ? (
            <span className="font-medium text-destructive">{deleteError}</span>
          ) : (
            "Members lose access to its work items immediately. Teams that still hold work items cannot be deleted."
          )
        }
        confirmLabel="Delete team"
        danger
        pending={deleting}
        onConfirm={() => deleteTeam()}
        onClose={() => {
          setConfirmDelete(false);
          setDeleteError("");
        }}
      />
    </div>
  );
}