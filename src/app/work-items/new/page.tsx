"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage, type ApiTeam, type ApiUser } from "@/lib/client";
import { useTeamRoster } from "@/lib/use-team-roster";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Field, FormSection, PageHeader, Spinner, notify, useRequireAuth } from "@/components/kit";
import { Icon } from "@/components/icons";


export default function NewWorkItemPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const router = useRouter();
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [teams, setTeams] = useState<ApiTeam[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);
  // On a team item only team members are eligible assignees; show just those.
  const roster = useTeamRoster(teamId);
  // One key per form instance, minted on first submit: safe retries replay instead of duplicating.
  const idempotencyKey = useRef("");

  useEffect(() => {
    if (user) {
      api<{ users: ApiUser[] }>("/api/users")
        .then((d) => setUsers(d.users))
        .catch(() => {});
      api<{ teams: ApiTeam[] }>("/api/teams")
        .then((d) => setTeams(d.teams))
        .catch(() => {});
    }
  }, [user]);

  if (authLoading || !user) {
    return (
      <Card className="p-5">
        <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
      </Card>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setFormError("");
    if (!title.trim()) {
      setFieldErrors({ title: ["Title is required."] });
      return;
    }
    setPending(true);
    try {
      if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
      const d = await api<{ item: { id: string } }>(
        "/api/work-items",
        {
          method: "POST",
          body: JSON.stringify({
            title: title.trim(),
            description,
            assigneeId: assigneeId || null,
            teamId: teamId || null,
            priority,
          }),
        },
        { "Idempotency-Key": idempotencyKey.current },
      );
      notify("Work item created.");
      router.replace(`/work-items/${d.item.id}`);
    } catch (err) {
      const e = err as { details?: Record<string, string[]> };
      if (e.details) setFieldErrors(e.details);
      else setFormError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="New work item"
        description="Items start in OPEN. Assign one now if work should begin immediately."
      />
      <Card>
        <form onSubmit={submit} className="space-y-5 p-4 sm:p-5">
          <FormSection title="What needs doing">
            <Field
              label="Title"
              htmlFor="title"
              required
              hint="A short, scannable summary — under 200 characters."
              error={fieldErrors.title?.[0]}
            >
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                placeholder="e.g. Provision staging database"
                disabled={pending}
              />
            </Field>
            <Field
              label="Description"
              htmlFor="description"
              hint="Context, acceptance criteria, links — up to 5000 characters."
              error={fieldErrors.description?.[0]}
            >
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={6}
                maxLength={5000}
                placeholder="What needs to happen, and how will we know it's done?"
                disabled={pending}
              />
            </Field>
          </FormSection>

          <FormSection
            title="Ownership"
            description="Team items are visible to members only, and their assignee must be a member of that team."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Team"
                htmlFor="team"
                hint="Leave empty for team-less work."
                error={fieldErrors.teamId?.[0]}
              >
                <Select id="team" value={teamId} onChange={(e) => setTeamId(e.target.value)} disabled={pending}>
                  <option value="">No team</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Priority" htmlFor="priority" error={fieldErrors.priority?.[0]}>
                <Select id="priority" value={priority} onChange={(e) => setPriority(e.target.value)} disabled={pending}>
                  {["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field
              label="Assignee"
              htmlFor="assignee"
              hint={
                roster
                  ? "Showing members of the selected team."
                  : "Required before the item can move to In Progress."
              }
              error={fieldErrors.assigneeId?.[0]}
            >
              <Select id="assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} disabled={pending}>
                <option value="">Unassigned</option>
                {(roster ?? users).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </option>
                ))}
              </Select>
            </Field>
          </FormSection>

          {formError && (
            <Alert variant="destructive">
              <Icon name="alert" className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div>
                <AlertTitle>Could not create the item</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </div>
            </Alert>
          )}

          <div className="flex items-center gap-2 border-t border-border/70 pt-4">
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              {pending ? "Creating…" : "Create work item"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => router.back()} disabled={pending}>
              Cancel
            </Button>
            <span className="ml-auto hidden text-[12px] text-muted-foreground sm:block">
              Duplicate submissions are ignored — each form carries one idempotency key.
            </span>
          </div>
        </form>
      </Card>
    </div>
  );
}
