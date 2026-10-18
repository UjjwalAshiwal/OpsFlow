"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Spinner, useSession } from "@/components/kit";
import { Icon } from "@/components/icons";

export default function RegisterPage() {
  const router = useRouter();
  const { user, loading: sessionLoading } = useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!sessionLoading && user) router.replace("/");
  }, [sessionLoading, user, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (password !== confirm) {
      setFormError("Passwords do not match.");
      return;
    }
    setPending(true);
    try {
      await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, email, password }),
      });
      router.replace("/");
      router.refresh();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-xl border border-border bg-card shadow-card md:grid-cols-[1.05fr_1fr]">
        {/* Brand panel */}
        <div className="hidden flex-col justify-between bg-sidebar p-8 md:flex">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-sidebar-primary text-white">
              <Icon name="items" className="size-5" />
            </span>
            <div>
              <p className="text-[15px] leading-none font-bold tracking-tight text-sidebar-accent-foreground">OpsFlow</p>
              <p className="mt-1 text-[11px] text-sidebar-muted">Operations workspace</p>
            </div>
          </div>

          <div>
            <h1 className="text-[22px] leading-snug font-bold tracking-tight text-white">
              Every operational item,
              <br />
              owned and on track.
            </h1>
            <ul className="mt-5 space-y-2.5 text-[13px] text-sidebar-foreground">
              {[
                "A controlled workflow with real transitions",
                "Teams, roles, and scoped visibility",
                "A full history of who changed what",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-status-done/15">
                    <Icon name="check" className="size-2.5 text-status-done" />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <p className="text-[11px] text-sidebar-muted">Internal operations workspace</p>
        </div>

        {/* Form panel */}
        <div className="p-7 sm:p-8">
          <div className="flex items-center gap-2.5 md:hidden">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-white">
              <Icon name="items" className="size-5" />
            </span>
            <p className="text-[15px] font-bold tracking-tight text-foreground">OpsFlow</p>
          </div>

          <h2 className="text-[19px] font-bold tracking-tight text-foreground">Create your account</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Use at least 12 characters for your password.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <Field label="Name" htmlFor="name" required>
              <Input
                id="name"
                type="text"
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ada Lovelace"
                disabled={pending}
              />
            </Field>
            <Field label="Email" htmlFor="email" required>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                disabled={pending}
              />
            </Field>
            <Field label="Password" htmlFor="password" hint="12–256 characters." required>
              <Input
                id="password"
                type="password"
                required
                minLength={12}
                maxLength={256}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                disabled={pending}
              />
            </Field>
            <Field label="Confirm password" htmlFor="confirm" required>
              <Input
                id="confirm"
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••••••"
                disabled={pending}
              />
            </Field>
            {formError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/[0.05] px-3 py-2.5 text-[13px] font-medium text-destructive"
              >
                <Icon name="alert" className="mt-px size-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}
            <Button type="submit" disabled={pending} className="h-10 w-full">
              {pending && <Spinner />}
              {pending ? "Creating account…" : "Create account"}
            </Button>
          </form>

          <p className="mt-6 text-center text-[13px] text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}