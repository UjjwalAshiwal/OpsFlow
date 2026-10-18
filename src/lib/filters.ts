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

// The five shareable filters. `q` is deliberately absent: it is applied on
// submit, not per keystroke, so it never round-trips through the URL.
const URL_KEYS = ["status", "priority", "assignee", "creator", "teamId"] as const;

/** Reads deep-link params (?status=&assignee=mine&teamId=…) into filter state. */
export function readFilters(params: URLSearchParams): Filters {
  const filters: Filters = { ...EMPTY_FILTERS, q: params.get("q") ?? "" };
  for (const key of URL_KEYS) {
    const value = params.get(key);
    if (value) filters[key] = value;
  }
  return filters;
}

/** URL params to share/deep-link. `q` is omitted: it is applied on submit, not per keystroke. */
export function filterParams(f: Filters): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of URL_KEYS) {
    if (f[key]) params.set(key, f[key]);
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