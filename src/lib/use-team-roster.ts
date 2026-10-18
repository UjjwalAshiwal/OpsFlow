"use client";

// Roster of the team an item is being filed under. The API rejects an assignee
// who is not a team member (400), so the picker shows only eligible people
// instead of letting the user submit a guaranteed failure.

import { useEffect, useState } from "react";
import { api, type ApiTeamDetail } from "@/lib/client";

/** Members of `teamId`, or null while loading / for teamless items (→ show all users). */
export function useTeamRoster(teamId: string): ApiTeamDetail["members"] | null {
  const [loaded, setLoaded] = useState<{ teamId: string; members: ApiTeamDetail["members"] } | null>(null);
  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    api<{ team: ApiTeamDetail }>(`/api/teams/${teamId}`).then(
      (d) => {
        if (!cancelled) setLoaded({ teamId, members: d.team.members });
      },
      () => {
        if (!cancelled) setLoaded({ teamId, members: [] });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [teamId]);
  // Derive the reset during render instead of setState-ing inside the effect.
  return loaded?.teamId === teamId ? loaded.members : null;
}