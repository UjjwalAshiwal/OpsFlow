"use client";

import Link from "next/link";
import type { ApiWorkItem } from "@/lib/client";
import { formatRelative } from "@/lib/dates";
import { Avatar } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PriorityBadge, StatusBadge, TeamBadge } from "@/components/kit";

/**
 * Compact scan-first table: identity first, then state, then ownership.
 * Status and priority use deliberately different shapes (pill vs bar) so the
 * two dimensions are separable without reading the labels.
 */
export function WorkItemsTable({ items }: { items: ApiWorkItem[] }) {
  return (
    <Table className="min-w-[820px]">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-[36%]">Work item</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Priority</TableHead>
          <TableHead>Team</TableHead>
          <TableHead>Assignee</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead className="text-right">Ver.</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((i) => (
          <TableRow key={i.id}>
            <TableCell>
              <Link
                href={`/work-items/${i.id}`}
                className="block max-w-[320px] truncate text-[13px] font-semibold text-foreground transition-colors hover:text-primary"
              >
                {i.title}
              </Link>
              <span className="block max-w-[320px] truncate text-[12px] text-muted-foreground">
                {i.description ? i.description.slice(0, 72) : "No description"}
              </span>
            </TableCell>
            <TableCell>
              <StatusBadge status={i.status} />
            </TableCell>
            <TableCell>
              <PriorityBadge priority={i.priority} />
            </TableCell>
            <TableCell>
              {i.team ? <TeamBadge name={i.team.name} /> : <span className="text-[12px] text-muted-foreground">—</span>}
            </TableCell>
            <TableCell>
              {i.assignee ? (
                <span className="inline-flex items-center gap-1.5">
                  <Avatar name={i.assignee.name} className="size-5 text-[9px]" />
                  <span className="text-[13px] font-medium whitespace-nowrap text-foreground">{i.assignee.name}</span>
                </span>
              ) : (
                <span className="text-[12px] text-muted-foreground">Unassigned</span>
              )}
            </TableCell>
            <TableCell
              className="whitespace-nowrap text-[12px] text-muted-foreground"
              title={`${i.creator.name} · ${new Date(i.updatedAt).toLocaleString()}`}
            >
              {formatRelative(i.updatedAt)}
            </TableCell>
            <TableCell className="text-right text-[12px] text-muted-foreground tabular-nums">v{i.version}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}