import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { cookies } from "next/headers";
import { AppShell } from "@/components/shell";
import { getSessionUserByToken, SESSION_COOKIE } from "@/lib/auth";

// Geist ships with Next (fetched at build time by next/font, no runtime request
// and no extra dependency). Exposed as the --font-geist-* vars the theme uses.
const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "OpsFlow — Operations workspace",
  description: "Coordinate operational work, track ownership, and manage workflow states.",
};

// Session lookup streams in behind Suspense so the static shell (and the
// special /_not-found route) still prerenders under Cache Components.
async function Workspace() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = await getSessionUserByToken(token);
  return user;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full ${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-full">
        <Suspense>
          <ShellLoader>{children}</ShellLoader>
        </Suspense>
      </body>
    </html>
  );
}

async function ShellLoader({ children }: { children: React.ReactNode }) {
  const user = await Workspace();
  return <AppShell user={user}>{children}</AppShell>;
}
