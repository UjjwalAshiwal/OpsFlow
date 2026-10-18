"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, errorMessage, type ApiWorkItem } from "@/lib/client";
import { formatRelative } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  CardSkeleton,
  ErrorState,
  PageHeader,
  StatusBadge,
  useRequireAuth,
} from "@/components/kit";
import { Icon, type IconName } from "@/components/icons";

const STATUSES = ["OPEN", "IN_PROGRESS", "REVIEW", "DONE", "CANCELLED"] as const;

type Tone = "open" | "progress" | "review" | "done" | "cancelled";
const TONE: Record<string, Tone> = {
  OPEN: "open",
  IN_PROGRESS: "progress",
  REVIEW: "review",
  DONE: "done",
  CANCELLED: "cancelled",
};
const DOT: Record<Tone, string> = {
  open: "bg-status-open",
  progress: "bg-status-progress",
  review: "bg-status-review",
  done: "bg-status-done",
  cancelled: "bg-status-cancelled",
};
const BAR: Record<Tone, string> = {
  open: "bg-status-open/60",
  progress: "bg-status-progress/60",
  review: "bg-status-review/60",
  done: "bg-status-done/60",
  cancelled: "bg-status-cancelled/60",
};

interface DashboardData {
  counts: Record<string, number>;
  total: number;
  recent: ApiWorkItem[];
  mine: ApiWorkItem[];
  review: ApiWorkItem[];
}

/** One status total, straight from GET /api/work-items/stats (exact GROUP BY). */
function StatTile({ status, count, total }: { status: string; count: number; total: number }) {
  const tone = TONE[status] ?? "slate";
  const share = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <Link
      href={`/work-items?status=${status}`}
      className="group flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3.5 shadow-card transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-raised"
      aria-label={`${count} items ${status.replace("_", " ").toLowerCase()}`}
    >
      <div className="flex items-center gap-1.5">
        <span className={cn("size-1.5 rounded-full", DOT[tone])} aria-hidden="true" />
        <span className="text-[11px] font-bold tracking-[0.05em] text-muted-foreground uppercase">
          {status.replace("_", " ")}
        </span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="text-[26px] leading-none font-bold tracking-[-0.02em] text-foreground tabular-nums">{count}</span>
        <span className="pb-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">{share}%</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className={cn("h-full rounded-full", BAR[tone])} style={{ width: `${Math.max(share, count > 0 ? 4 : 0)}%` }} />
      </div>
    </Link>
  );
}

function ItemRow({ item, showAssignee = true }: { item: ApiWorkItem; showAssignee?: boolean }) {
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
            {showAssignee ? (item.assignee ? item.assignee.name : "Unassigned") : item.creator.name} ·{" "}
            {formatRelative(item.updatedAt)}
          </span>
        </span>
        <StatusBadge status={item.status} />
      </Link>
    </li>
  );
}

function AttentionGroup({
  icon,
  title,
  items,
  loading,
  empty,
}: {
  icon: IconName;
  title: string;
  items: ApiWorkItem[];
  loading: boolean;
  empty: React.ReactNode;
}) {
  return (
    <section>
      <header className="flex items-center gap-2 px-2 pb-1">
        <Icon name={icon} className="size-3.5 text-muted-foreground" />
        <h2 className="text-[12px] font-bold tracking-[0.02em] text-foreground">{title}</h2>
        {!loading && items.length > 0 && (
          <span className="rounded bg-muted px-1.5 py-px text-[11px] font-bold text-muted-foreground tabular-nums">
            {items.length}
          </span>
        )}
      </header>
      {loading ? (
        <div className="space-y-2 px-2 py-1">
          {[0, 1].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : items.length > 0 ? (
        <ul className="space-y-0.5">{items.map((i) => <ItemRow key={i.id} item={i} />)}</ul>
      ) : (
        <p className="px-2 py-2 text-[13px] text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

export default function DashboardPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([
      api<{ counts: Record<string, number>; total: number }>("/api/work-items/stats"),
      api<{ items: ApiWorkItem[] }>("/api/work-items?limit=100"),
      api<{ items: ApiWorkItem[] }>(`/api/work-items?assigneeId=${user.id}&limit=5`),
      api<{ items: ApiWorkItem[] }>("/api/work-items?status=REVIEW&limit=5"),
    ]).then(
      ([stats, recent, mine, review]) => {
        if (cancelled) return;
        setData({ counts: stats.counts, total: stats.total, recent: recent.items, mine: mine.items, review: review.items });
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

  if (authLoading || !user) {
    return (
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5" aria-label="Loading">
        {Array.from({ length: 5 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    );
  }

  const counts = data?.counts ?? {};
  const total = data?.total ?? 0;
  // Spotlight derivations come from the recent page only, and the UI says so.
  const unassignedUrgent = (data?.recent ?? [])
    .filter((i) => !i.assignee && (i.priority === "HIGH" || i.priority === "URGENT"))
    .slice(0, 5);
  const updated = [...(data?.recent ?? [])]
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
    .slice(0, 8);

  return (
    <div>
      <PageHeader
        title={`Good ${daypart()}, ${user.name.split(" ")[0]}`}
        description="Workflow load, work needing attention, and the latest changes across everything you can see."
        meta={
          state === "ready" ? (
            <span className="rounded-md border border-border bg-card px-2 py-0.5 text-[12px] font-semibold text-muted-foreground">
              {total} visible item{total === 1 ? "" : "s"}
            </span>
          ) : null
        }
      />

      {state === "error" && (
        <ErrorState
          title="Couldn't load the overview"
          body={error}
          action={
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Retry
            </Button>
          }
        />
      )}

      {(state === "loading" || state === "ready") && (
        <div className="space-y-4">
          <section aria-label="Workflow load" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {STATUSES.map((s) => (
              <StatTile key={s} status={s} count={state === "loading" ? 0 : (counts[s] ?? 0)} total={total} />
            ))}
          </section>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <Card aria-label="Needs attention" className="divide-y divide-border/70">
              <AttentionGroup
                icon="user"
                title="Assigned to you"
                items={data?.mine ?? []}
                loading={state === "loading"}
                empty={
                  <>
                    Nothing assigned to you.{" "}
                    <Link href="/work-items" className="font-semibold text-primary hover:underline">
                      Browse work items
                    </Link>
                  </>
                }
              />
              <AttentionGroup
                icon="clock"
                title="Awaiting review"
                items={data?.review ?? []}
                loading={state === "loading"}
                empty="No items are waiting for review."
              />
              <AttentionGroup
                icon="alert"
                title="Unassigned, high priority"
                items={unassignedUrgent}
                loading={state === "loading"}
                empty="No unassigned HIGH or URGENT items among recent work."
              />
            </Card>

            <Card aria-label="Recently updated" className="flex flex-col">
              <header className="flex items-center justify-between px-4 py-3">
                <h2 className="text-[12px] font-bold tracking-[0.02em] text-foreground">Recently updated</h2>
                <Link href="/work-items" className="text-[12px] font-semibold text-primary hover:underline">
                  View all
                </Link>
              </header>
              {state === "loading" ? (
                <div className="space-y-2 px-4 pb-4">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-8 animate-pulse rounded bg-muted" />
                  ))}
                </div>
              ) : updated.length === 0 ? (
                <div className="px-4 pb-6 text-[13px] text-muted-foreground">
                  No work items yet.{" "}
                  <Link href="/work-items/new" className="font-semibold text-primary hover:underline">
                    Create the first one
                  </Link>
                </div>
              ) : (
                <ul className="flex-1 space-y-0.5 px-2 pb-3">
                  {updated.map((i) => (
                    <ItemRow key={i.id} item={i} showAssignee={false} />
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <p className="text-[12px] text-muted-foreground">
            Status tiles are exact totals from the database. Attention and recent lists cover the 100 most recent items.
          </p>
        </div>
      )}
    </div>
  );
}

function daypart(): string {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}