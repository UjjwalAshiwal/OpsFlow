// Filter <-> URL <-> API mapping for the work-items list. Pure (no React), so
// the edge cases ("mine" resolution, unknown params, empty query) are unit
// tested instead of discovered in the browser.

export interface Filters {
  q: string;
  status: string;
  priority: string;
  assignee: string; // "" | "mine" | userId
  creator: string; // "" | "mine" | userId
  teamId: string;
}

export const EMPTY_FILTERS: Filters = { q: "", status: "", priority: "", assignee: "", creator: "", teamId: "" };

export const ME = "mine";

/** Reads deep-link params (?status=&assignee=mine&teamId=…) into filter state. */
export function readFilters(params: URLSearchParams): Filters {
  return {
    q: params.get("q") ?? "",
    status: params.get("status") ?? "",
    priority: params.get("priority") ?? "",
    assignee: params.get("assignee") ?? "",
    creator: params.get("creator") ?? "",
    teamId: params.get("teamId") ?? "",
  };
}

/** URL params to share/deep-link. `q` is omitted: it is applied on submit, not per keystroke. */
export function filterParams(f: Filters): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ status: f.status, priority: f.priority, assignee: f.assignee, creator: f.creator, teamId: f.teamId })) {
    if (value) params.set(key, value);
  }
  return params;
}

/** Filters to `GET /api/work-items` query params. "mine" resolves to the session user. */
export function toQuery(f: Filters, userId: string | undefined, limit: number): URLSearchParams {
  const params = filterParams(f);
  params.set("limit", String(limit));
  const assignee = f.assignee === ME ? userId : f.assignee;
  if (assignee) params.set("assigneeId", assignee);
  const creator = f.creator === ME ? userId : f.creator;
  if (creator) params.set("creatorId", creator);
  if (f.q) params.set("q", f.q);
  return params;
}