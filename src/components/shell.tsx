"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type ApiUser } from "@/lib/client";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Toaster } from "@/components/kit";
import { Icon, type IconName } from "@/components/icons";

type NavItem = { href: string; label: string; icon: IconName; exact?: boolean };

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Workspace",
    items: [
      { href: "/", label: "Overview", icon: "overview", exact: true },
      { href: "/work-items", label: "Work items", icon: "items" },
      { href: "/my-work", label: "My work", icon: "user" },
    ],
  },
  { section: "Teams", items: [{ href: "/teams", label: "All teams", icon: "users" }] },
  { section: "Create", items: [{ href: "/work-items/new", label: "New work item", icon: "plus" }] },
];

/** Header label per route; falls back to the section name. */
const TITLES: { match: (p: string) => boolean; label: string; section: string }[] = [
  { match: (p) => p === "/", label: "Overview", section: "Workspace" },
  { match: (p) => p === "/my-work", label: "My work", section: "Workspace" },
  { match: (p) => p === "/work-items", label: "Work items", section: "Workspace" },
  { match: (p) => p === "/work-items/new", label: "New work item", section: "Create" },
  { match: (p) => p.startsWith("/work-items/"), label: "Work item", section: "Workspace" },
  { match: (p) => p === "/teams", label: "Teams", section: "Teams" },
  { match: (p) => p.startsWith("/teams/"), label: "Team", section: "Teams" },
  { match: (p) => p === "/login", label: "Log in", section: "" },
];

export function pageTitle(pathname: string): string {
  return TITLES.find((t) => t.match(pathname))?.label ?? "OpsFlow";
}

function sectionFor(pathname: string): string {
  return TITLES.find((t) => t.match(pathname))?.section ?? "Workspace";
}

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  if (href === "/work-items") return pathname === "/work-items" || pathname.startsWith("/work-items/");
  return pathname === href || pathname.startsWith(href + "/");
}

function BrandMark() {
  return (
    <span className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary text-white">
      <Icon name="items" className="size-[18px]" />
    </span>
  );
}

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Primary" className="flex-1 space-y-5 overflow-y-auto px-2.5 py-4">
      {NAV.map((group) => (
        <div key={group.section}>
          <p className="px-2.5 pb-1.5 text-[10px] font-bold tracking-[0.1em] text-sidebar-muted/80 uppercase">
            {group.section}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item.href, item.exact);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={onNavigate}
                    className={cn(
                      "group relative flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium transition-colors duration-150",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/85 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                    )}
                  >
                    {active && (
                      <span
                        className="absolute inset-y-1.5 -left-2.5 w-[3px] rounded-r-full bg-sidebar-primary"
                        aria-hidden="true"
                      />
                    )}
                    <Icon name={item.icon} className="size-4 shrink-0" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function AccountPanel({ user, onLogout }: { user: ApiUser; onLogout: () => void }) {
  return (
    <div className="border-t border-sidebar-border p-2.5">
      <div className="flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-sidebar-accent/50">
        <Avatar name={user.name} className="size-8 text-[11px]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-sidebar-accent-foreground">{user.name}</p>
          <p className="truncate text-[11px] text-sidebar-muted">{user.email}</p>
        </div>
        <button
          onClick={onLogout}
          title="Log out"
          aria-label={`Log out ${user.name}`}
          className="rounded p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <Icon name="logout" className="size-4" />
        </button>
      </div>
    </div>
  );
}

export function AppShell({ user, children }: { user: ApiUser | null; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);

  // Close transient UI on navigation (render-adjustment pattern: no effect needed).
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setDrawer(false);
  }

  async function logout() {
    await api("/api/auth/session", { method: "DELETE" }).catch(() => {});
    router.replace("/login");
    router.refresh();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawer(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Logged-out screens (login) render without the workspace chrome.
  if (!user) {
    return (
      <div className="min-h-screen">
        {children}
        <Toaster />
      </div>
    );
  }

  const section = sectionFor(pathname);
  const label = pageTitle(pathname);

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex items-center gap-2.5 px-5 py-4">
          <BrandMark />
          <div className="min-w-0">
            <p className="text-[15px] leading-none font-bold tracking-tight text-sidebar-accent-foreground">OpsFlow</p>
            <p className="mt-1 truncate text-[11px] text-sidebar-muted">Operations workspace</p>
          </div>
        </div>
        <Separator orientation="horizontal" className="bg-sidebar-border" />
        <NavList pathname={pathname} />
        <AccountPanel user={user} onLogout={logout} />
      </aside>

      {/* Mobile drawer */}
      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent>
          <div className="flex items-center gap-2.5 px-5 py-4">
            <BrandMark />
            <div className="min-w-0">
              <p className="text-[15px] leading-none font-bold tracking-tight text-sidebar-accent-foreground">OpsFlow</p>
              <p className="mt-1 truncate text-[11px] text-sidebar-muted">Operations workspace</p>
            </div>
          </div>
          <Separator orientation="horizontal" className="bg-sidebar-border" />
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Move around the OpsFlow workspace</SheetDescription>
          <NavList pathname={pathname} onNavigate={() => setDrawer(false)} />
          <AccountPanel user={user} onLogout={logout} />
        </SheetContent>
      </Sheet>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-sm">
          <div className="mx-auto flex h-13 w-full max-w-[1400px] items-center gap-3 px-4 py-2.5 sm:px-6">
            <Button
              variant="ghost"
              size="icon"
              className="-ml-1.5 lg:hidden"
              onClick={() => setDrawer(true)}
              aria-label="Open navigation"
            >
              <Icon name="menu" />
            </Button>
            <nav aria-label="Breadcrumb" className="min-w-0">
              <ol className="flex items-center gap-1.5 text-[13px]">
                {section !== label && (
                  <>
                    <li className="hidden text-muted-foreground sm:block">{section}</li>
                    <li aria-hidden="true" className="hidden text-muted-foreground/60 sm:block">
                      <Icon name="chevRight" className="size-3.5" />
                    </li>
                  </>
                )}
                <li className="truncate font-semibold text-foreground" aria-current="page">
                  {label}
                </li>
              </ol>
            </nav>
            <div className="ml-auto flex items-center gap-1.5">
              <Button asChild size="sm" aria-label="New work item">
                <Link href="/work-items/new">
                  <Icon name="plus" />
                  <span className="hidden sm:inline">New item</span>
                </Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label="Account menu"
                    className="ml-0.5 flex items-center gap-1 rounded-md p-1 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    <Avatar name={user.name} className="size-7 text-[11px]" />
                    <Icon name="chevDown" className="hidden size-3.5 text-muted-foreground sm:block" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-56">
                  <DropdownMenuLabel className="font-normal">
                    <p className="truncate text-[13px] font-semibold text-foreground">{user.name}</p>
                    <p className="truncate text-[12px] font-normal text-muted-foreground">
                      {user.email}
                      {user.role === "ADMIN" ? " · Admin" : ""}
                    </p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={logout}>
                    <Icon name="logout" />
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:py-7">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}