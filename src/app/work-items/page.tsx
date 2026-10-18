"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { api, errorMessage, type ApiTeam, type ApiUser, type ApiWorkItem } from "@/lib/client";
import {
  EMPTY_FILTERS,
  ME,
  filterParams,
  readFilters,
  toQuery,
  type Filters,
} from "@/lib/filters";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  EmptyState,
  ErrorState,
  FilterChip,
  LoadingPanel,
  PageHeader,
  Pagination,
  TableSkeleton,
  useRequireAuth,
} from "@/components/kit";

import { Icon } from "@/components/icons";
import { WorkItemsTable } from "@/components/work-items-table";

const STATUSES = ["OPEN", "IN_PROGRESS", "REVIEW", "DONE", "CANCELLED"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
const PAGE_SIZE = 10;

interface PageData {
  items: ApiWorkItem[];
  nextCursor: string | null;
}

/** One toolbar filter: labelled select that applies immediately on change. */
function FilterSelect({
  label,
  allLabel,
  value,
  onChange,
  options,
}: {
  label: string;
  allLabel: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="block min-w-[140px] flex-1">
      <span className="sr-only">{label}</span>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allLabel}</option>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </Select>
    </label>
  );
}

function ListInner() {
  const { user, loading: authLoading } = useRequireAuth();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Deep-link defaults (?status=&assignee=mine&teamId=) are read once as initial state.
  const [filters, setFilters] = useState<Filters>(() => readFilters(searchParams));
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [teams, setTeams] = useState<ApiTeam[]>([]);
  const [data, setData] = useState<PageData | null>(null);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState(0);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState("");

  const fetchPage = useCallback(
    (cursor: string | null, f: Filters) => {
      const params = toQuery(f, user?.id, PAGE_SIZE);
      if (cursor) params.set("cursor", cursor);
      return api<PageData>(`/api/work-items?${params}`);
    },
    [user],
  );

  function load(cursor: string | null, f: Filters, pageIndex: number) {
    setState("loading");
    fetchPage(cursor, f).then(
      (d) => {
        setData(d);
        setPage(pageIndex);
        setState("ready");
      },
      (e: unknown) => {
        setError(errorMessage(e));
        setState("error");
      },
    );
  }

  function resetAndLoad(patch: Partial<Filters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    setCursors([null]);
    load(null, next, 0);
  }

  // Initial mount fetch (effect body starts async work only — no sync setState).
  useEffect(() => {
    if (!user) return;
    fetchPage(null, readFilters(searchParams)).then(
      (d) => {
        setData(d);
        setPage(0);
        setState("ready");
      },
      (e: unknown) => {
        setError(errorMessage(e));
        setState("error");
      },
    );
    api<{ users: ApiUser[] }>("/api/users")
      .then((d) => setUsers(d.users))
      .catch(() => {});
    api<{ teams: ApiTeam[] }>("/api/teams")
      .then((d) => setTeams(d.teams))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Keep the URL in sync with every active filter so deep links and the
  // back button round-trip (q is applied on submit, not per keystroke).
  useEffect(() => {
    if (!user) return;
    const params = filterParams(filters);
    const qs = params.toString();
    router.replace(qs ? `/work-items?${qs}` : "/work-items", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status, filters.priority, filters.assignee, filters.creator, filters.teamId]);

  if (authLoading || !user) return <LoadingPanel label="Loading work items…" />;

  const hasFilters = Object.values(filters).some(Boolean);
  const personLabel = (id: string) => (id === ME ? "me" : (users.find((u) => u.id === id)?.name ?? "someone"));
  const activeChips = [
    filters.status && { key: "status", label: "Status", value: filters.status.replace("_", " ") },
    filters.priority && { key: "priority", label: "Priority", value: filters.priority },
    filters.assignee && { key: "assignee", label: "Assignee", value: personLabel(filters.assignee) },
    filters.creator && { key: "creator", label: "Creator", value: personLabel(filters.creator) },
    filters.teamId && { key: "teamId", label: "Team", value: teams.find((t) => t.id === filters.teamId)?.name ?? "—" },
    filters.q && { key: "q", label: "Search", value: filters.q },
  ].filter((c): c is { key: keyof Filters; label: string; value: string } => Boolean(c));

  return (
    <div>
      <PageHeader
        title="Work items"
        description="Everything you are allowed to see, filtered and paginated server-side."
      />

      {/* Toolbar: search + filters, then removable chips for what is active */}
      <Card className="mb-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setCursors([null]);
            load(null, filters, 0);
          }}
          className="p-3"
        >
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <label className="relative block lg:min-w-0 lg:flex-1">
              <span className="sr-only">Search work items</span>
              <Icon name="search" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filters.q}
                onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                placeholder="Search title or description…"
                className="pl-8.5"
              />
            </label>
            <div className="flex gap-2 lg:justify-end">
              {hasFilters && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setFilters(EMPTY_FILTERS);
                    setCursors([null]);
                    load(null, EMPTY_FILTERS, 0);
                  }}
                >
                  Clear all
                </Button>
              )}
              <Button type="submit">Search</Button>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <FilterSelect
              label="Filter by status"
              allLabel="All statuses"
              value={filters.status}
              onChange={(v) => resetAndLoad({ status: v })}
              options={STATUSES.map((x) => [x, x.replace("_", " ")] as [string, string])}
            />
            <FilterSelect
              label="Filter by priority"
              allLabel="All priorities"
              value={filters.priority}
              onChange={(v) => resetAndLoad({ priority: v })}
              options={PRIORITIES.map((x) => [x, x] as [string, string])}
            />
            <FilterSelect
              label="Filter by assignee"
              allLabel="All assignees"
              value={filters.assignee}
              onChange={(v) => resetAndLoad({ assignee: v })}
              options={[
                [ME, "Assigned to me"],
                ...users.map((u) => [u.id, u.name] as [string, string]),
              ]}
            />
            <FilterSelect
              label="Filter by creator"
              allLabel="All creators"
              value={filters.creator}
              onChange={(v) => resetAndLoad({ creator: v })}
              options={[
                [ME, "Created by me"],
                ...users.map((u) => [u.id, u.name] as [string, string]),
              ]}
            />
            <FilterSelect
              label="Filter by team"
              allLabel="All teams"
              value={filters.teamId}
              onChange={(v) => resetAndLoad({ teamId: v })}
              options={teams.map((t) => [t.id, t.name] as [string, string])}
            />
          </div>

          {activeChips.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border/70 pt-2.5">
              <span className="text-[11px] font-bold tracking-[0.05em] text-muted-foreground uppercase">Active</span>
              {activeChips.map((c) => (
                <FilterChip key={c.label} label={c.label} value={c.value} onClear={() => resetAndLoad({ [c.key]: "" } as Partial<Filters>)} />
              ))}
            </div>
          )}
        </form>
      </Card>

      {state === "error" && (
        <ErrorState
          title="Couldn't load work items"
          body={error}
          action={
            <Button variant="secondary" onClick={() => load(cursors[page] ?? null, filters, page)}>
              Retry
            </Button>
          }
        />
      )}

      {state === "loading" && <TableSkeleton rows={6} />}

      {state === "ready" && data && data.items.length === 0 && (
        <EmptyState
          icon="inbox"
          title="No work items match"
          body={
            hasFilters
              ? "No items match the active filters. Widen them or search for something else."
              : "Nothing has been created yet in this workspace."
          }
          action={
            <>
              {hasFilters && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setFilters(EMPTY_FILTERS);
                    setCursors([null]);
                    load(null, EMPTY_FILTERS, 0);
                  }}
                >
                  Clear filters
                </Button>
              )}
              <Button asChild>
                <Link href="/work-items/new">Create a work item</Link>
              </Button>
            </>
          }
        />
      )}

      {state === "ready" && data && data.items.length > 0 && (
        <div className="space-y-3">
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border bg-subtle/50 px-4 py-2">
              <p className="text-[12px] font-medium text-muted-foreground">
                Page {page + 1} · {data.items.length} item{data.items.length === 1 ? "" : "s"}
              </p>
              <p className="text-[12px] text-muted-foreground">Newest first</p>
            </div>
            <WorkItemsTable items={data.items} />
          </Card>
          <Pagination
            page={page}
            hasMore={data.nextCursor !== null}
            onPrev={() => load(cursors[page - 1] ?? null, filters, page - 1)}
            onNext={() => {
              const cursor = data.nextCursor;
              if (!cursor) return;
              const next = [...cursors];
              next[page + 1] = cursor;
              setCursors(next);
              load(cursor, filters, page + 1);
            }}
          />
        </div>
      )}
    </div>
  );
}

export default function WorkItemsPage() {
  return (
    <Suspense>
      <ListInner />
    </Suspense>
  );
}
