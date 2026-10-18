"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, errorMessage, type ApiWorkItem } from "@/lib/client";
import { formatRelative } from "@/lib/dates";
import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  EmptyState,
  ErrorState,
  LoadingPanel,
  PageHeader,
  PriorityBadge,
  StatusBadge,
  useRequireAuth,
} from "@/components/kit";


function Row({ item }: { item: ApiWorkItem }) {
  return (
    <li>
      <Link
        href={`/work-items/${item.id}`}
        className="flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-primary/[0.04]"
      >
        <Avatar name={item.assignee?.name ?? item.creator.name} className="size-6 text-[10px]" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-foreground">{item.title}</span>
          <span className="block truncate text-[12px] text-muted-foreground">
            {item.team ? `${item.team.name} · ` : ""}
            {formatRelative(item.updatedAt)} · v{item.version}
          </span>
        </span>
        <PriorityBadge priority={item.priority} className="hidden sm:inline-flex" />
        <StatusBadge status={item.status} />
      </Link>
    </li>
  );
}

export default function MyWorkPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [assigned, setAssigned] = useState<ApiWorkItem[]>([]);
  const [created, setCreated] = useState<ApiWorkItem[]>([]);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([
      api<{ items: ApiWorkItem[] }>(`/api/work-items?assigneeId=${user.id}&limit=20`),
      api<{ items: ApiWorkItem[] }>(`/api/work-items?creatorId=${user.id}&limit=20`),
    ]).then(
      ([a, c]) => {
        if (cancelled) return;
        setAssigned(a.items);
        setCreated(c.items);
        setState("ready");
      },
      (e: unknown) => {
        if (cancelled) return;
        setError(errorMessage(e));
        setState("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (authLoading || !user) return <LoadingPanel label="Loading your work…" />;

  return (
    <div>
      <PageHeader
        title="My work"
        description="Everything assigned to you, plus everything you created."
      />

      {state === "error" && (
        <ErrorState
          title="Could not load your work"
          body={error}
          action={<Button variant="secondary" onClick={() => window.location.reload()}>Retry</Button>}
        />
      )}

      {state === "loading" && <LoadingPanel label="Loading your work…" />}

      {state === "ready" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
              <h2 className="text-[13px] font-bold tracking-tight text-foreground">Assigned to me · {assigned.length}</h2>
              <Link href="/work-items?assignee=mine" className="text-[12px] font-semibold text-primary hover:underline">
                View all
              </Link>
            </div>
            {assigned.length === 0 ? (
              <EmptyState
                compact
                icon="user"
                title="Nothing assigned to you"
                body="Items assigned to you will appear here."
              />
            ) : (
              <ul className="flex-1 space-y-0.5 px-2 py-2">
                {assigned.map((i) => (
                  <Row key={i.id} item={i} />
                ))}
              </ul>
            )}
          </Card>
          <Card className="flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
              <h2 className="text-[13px] font-bold tracking-tight text-foreground">Created by me · {created.length}</h2>
              <Link href="/work-items?creator=mine" className="text-[12px] font-semibold text-primary hover:underline">
                View all
              </Link>
            </div>
            {created.length === 0 ? (
              <EmptyState
                compact
                icon="items"
                title="You have not created anything yet"
                body="Work items you create will appear here."
                action={
                  <Button asChild size="sm">
                    <Link href="/work-items/new">
                      <Icon name="plus" />
                      Create a work item
                    </Link>
                  </Button>
                }
              />
            ) : (
              <ul className="flex-1 space-y-0.5 px-2 py-2">
                {created.map((i) => (
                  <Row key={i.id} item={i} />
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
