"use client";

/*
 * OpsFlow app kit — components specific to this product, composed from the
 * shadcn primitives in `src/components/ui/*`. Primitives live in `ui/`;
 * domain-shaped pieces (badges, page furniture, states, toasts) live here.
 *
 * State vocabulary, defined once and reused by every screen:
 *   OPEN slate-grey-green · IN PROGRESS dusty blue · REVIEW ochre
 *   DONE forest · CANCELLED brick
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getSession, type ApiUser } from "@/lib/client";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "@/components/icons";
import { Badge, Dot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/* ---------------- session ---------------- */

export function useSession() {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    getSession()
      .then(({ user }) => {
        if (!cancelled) setUser(user);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { user, loading };
}

/** Redirects to /login when there is no session. Returns the user once known. */
export function useRequireAuth() {
  const router = useRouter();
  const { user, loading } = useSession();
  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);
  return { user, loading };
}

/* ---------------- forms ---------------- */

/**
 * Label + control + hint/error, with the a11y wiring done once: the single
 * control child receives `aria-describedby` and `aria-invalid`, so every field
 * in the app announces its hint and its validation message.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  const describedBy = [hint && `${htmlFor}-hint`, error && `${htmlFor}-error`].filter(Boolean).join(" ");
  const control =
    React.isValidElement(children) && describedBy
      ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
          "aria-describedby": describedBy,
          "aria-invalid": error ? true : undefined,
        })
      : children;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="ml-0.5 text-destructive" aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="sr-only">(required)</span>}
      </Label>
      {control}
      {hint && !error && (
        <p id={`${htmlFor}-hint`} className="text-[12px] text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="flex items-start gap-1.5 text-[12px] font-medium text-destructive">
          <Icon name="alert" className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

/** Groups related fields under a small heading inside a form or card. */
export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3.5", className)}>
      <div>
        <h2 className="text-[13px] font-bold tracking-tight text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/* ---------------- page furniture ---------------- */

export function PageHeader({
  title,
  description,
  action,
  meta,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  meta?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[21px] leading-tight font-bold tracking-[-0.01em] text-foreground">{title}</h1>
          {meta}
        </div>
        {description && <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

export function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn("text-[13px] font-bold tracking-tight text-foreground", className)}>{children}</h2>;
}

/** Label/value row for detail rails. */
export function KeyValueRow({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3 border-b border-border/70 py-2 last:border-0", className)}>
      <dt className="shrink-0 text-[12px] font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right text-[13px] font-semibold text-foreground">{children}</dd>
    </div>
  );
}

/** Removable chip for an active filter, e.g. "Status: Review ×". */
export function FilterChip({ label, value, onClear }: { label: string; value: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card py-0.5 pr-1 pl-2 text-[12px] font-medium">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-semibold text-foreground">{value}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear ${label.toLowerCase()} filter ${value}`}
        className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Icon name="x" className="size-3" />
      </button>
    </span>
  );
}

/* ---------------- state ---------------- */

type StatusVariant = "open" | "progress" | "review" | "done" | "cancelled";

const STATUS_VARIANT: Record<string, StatusVariant> = {
  OPEN: "open",
  IN_PROGRESS: "progress",
  REVIEW: "review",
  DONE: "done",
  CANCELLED: "cancelled",
};

/** Dot colour for a status badge — same hue as the badge text, full strength. */
const STATUS_DOT: Record<StatusVariant, string> = {
  open: "bg-status-open",
  progress: "bg-status-progress",
  review: "bg-status-review",
  done: "bg-status-done",
  cancelled: "bg-status-cancelled",
};

/** Priority is a bare label in its own tone, never a filled pill. */
const PRIORITY_TEXT: Record<string, string> = {
  LOW: "text-priority-low",
  MEDIUM: "text-priority-medium",
  HIGH: "text-priority-high",
  URGENT: "text-priority-urgent",
};

/** Workflow state: tinted pill + dot + words. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const variant = STATUS_VARIANT[status] ?? "open";
  return (
    <Badge variant={variant} className={className}>
      <Dot className={STATUS_DOT[variant]} />
      {status.replace("_", " ")}
    </Badge>
  );
}

/**
 * Priority deliberately uses a different SHAPE from status — a bare uppercase
 * label, no pill and no dot — so the two dimensions stay separable at a glance
 * in dense tables.
 */
export function PriorityBadge({ priority, className }: { priority: string; className?: string }) {
  return (
    <span
      className={cn(
        "text-[11px] font-bold tracking-[0.04em] uppercase",
        PRIORITY_TEXT[priority] ?? "text-priority-medium",
        className,
      )}
    >
      {priority}
    </span>
  );
}

export function TeamBadge({ name }: { name: string }) {
  return (
    <Badge variant="open">
      <Icon name="users" className="size-3" />
      {name}
    </Badge>
  );
}

export function RoleBadge({ role }: { role: "LEAD" | "MEMBER" | null }) {
  if (!role) return <Badge variant="outline">Not a member</Badge>;
  return <Badge variant={role === "LEAD" ? "progress" : "open"}>{role === "LEAD" ? "Lead" : "Member"}</Badge>;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cn("animate-spin", className ?? "size-4")} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function LoadingPanel({ label, className }: { label: string; className?: string }) {
  return (
    <Card className={cn("flex items-center justify-center px-6 py-14", className)}>
      <p className="flex items-center gap-2 text-[13px] text-muted-foreground" role="status">
        <Spinner className="size-3.5" />
        {label}
      </p>
    </Card>
  );
}

/** Empty state: dashed frame so it reads as "nothing here yet", not a broken card. */
export function EmptyState({
  icon,
  title,
  body,
  action,
  compact,
}: {
  icon: IconName;
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-border-strong bg-card/60 px-6 text-center",
        compact ? "py-8" : "py-14",
      )}
    >
      <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon name={icon} className="size-4.5" />
      </span>
      <h2 className="mt-3 text-sm font-bold text-foreground">{title}</h2>
      {body && <div className="mt-1 max-w-sm text-[13px] text-muted-foreground">{body}</div>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-lg border border-destructive/25 bg-destructive/[0.04] px-6 py-12 text-center"
    >
      <span className="flex size-9 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
        <Icon name="alert" className="size-4.5" />
      </span>
      <h2 className="mt-3 text-sm font-bold text-foreground">{title}</h2>
      {body && <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Dashboard placeholder tiles. */
export function CardSkeleton() {
  return (
    <Card className="p-4">
      <Skeleton className="h-3 w-1/3" />
      <Skeleton className="mt-3 h-7 w-16" />
    </Card>
  );
}

/** Table placeholder that mirrors the real row rhythm, so nothing jumps on load. */
export function TableSkeleton({ rows = 5, cols = 7 }: { rows?: number; cols?: number }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border bg-subtle/70 px-4 py-2.5">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-full" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-3 border-b border-border/70 px-4 py-3 last:border-0">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn("h-3.5", c === 0 ? "w-full" : "w-16")} />
          ))}
        </div>
      ))}
    </Card>
  );
}

export function Pagination({
  page,
  hasMore,
  onPrev,
  onNext,
}: {
  page: number;
  hasMore: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between">
      <Button variant="secondary" size="sm" onClick={onPrev} disabled={page === 0}>
        <Icon name="chevLeft" />
        Previous
      </Button>
      <span className="text-[12px] font-medium text-muted-foreground" aria-live="polite">
        Page {page + 1}
      </span>
      <Button variant="secondary" size="sm" onClick={onNext} disabled={!hasMore}>
        Next
        <Icon name="chevRight" />
      </Button>
    </nav>
  );
}

/* ---------------- confirmation ---------------- */

/**
 * Destructive/terminal confirmation, composed on Radix AlertDialog so focus is
 * trapped and Escape works.
 *
 * Both footer buttons are plain Buttons, not AlertDialogAction/Cancel: Radix's
 * action primitive closes the dialog on click, which would swallow server
 * errors (e.g. 409 TEAM_IN_USE, or a rejected transition) before the user can
 * read them. Open state stays owned by the caller, so the dialog only closes
 * when the operation actually succeeded.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger,
  pending,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  // Deterministic initial focus on Cancel: destructive confirms must not start
  // with the destructive action under the user's Enter key.
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && !pending && onClose()}>
      <AlertDialogContent onOpenAutoFocus={(e) => { e.preventDefault(); cancelRef.current?.focus(); }}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">{body}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button ref={cancelRef} variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button variant={danger ? "destructive" : "default"} disabled={pending} onClick={onConfirm}>
            {pending && <Spinner />}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ---------------- toast ---------------- */

type ToastKind = "success" | "error";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

let toastId = 0;

/** Existing app-wide notification bus — kept; sonner would be a new dependency
 *  for behaviour this app already has. */
export function notify(message: string, kind: ToastKind = "success") {
  window.dispatchEvent(new CustomEvent<ToastItem>("opsflow-toast", { detail: { id: ++toastId, kind, message } }));
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const remove = React.useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const onToast = (e: Event) => {
      const item = (e as CustomEvent<ToastItem>).detail;
      setItems((prev) => [...prev.slice(-2), item]);
      window.setTimeout(() => remove(item.id), 4200);
    };
    window.addEventListener("opsflow-toast", onToast);
    return () => window.removeEventListener("opsflow-toast", onToast);
  }, [remove]);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-88 max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-border bg-popover px-3.5 py-2.5 text-[13px] font-medium text-popover-foreground shadow-pop"
        >
          <span
            className={cn(
              "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full",
              t.kind === "success" ? "bg-status-done-surface text-status-done" : "bg-status-cancelled-surface text-status-cancelled",
            )}
          >
            <Icon name={t.kind === "success" ? "check" : "alert"} className="size-2.5" />
          </span>
          <span className="flex-1">{t.message}</span>
          <button
            onClick={() => remove(t.id)}
            aria-label="Dismiss notification"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <Icon name="x" className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}