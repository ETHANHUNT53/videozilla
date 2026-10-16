"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { cx } from "./ui";

const LINKS = [
  { href: "/library", label: "Library", mono: "01" },
  { href: "/settings", label: "Settings", mono: "02" },
];

/** Nav with the current page highlighted. Reads the URL, so render it inside <Suspense> with NavLinksStatic as fallback. */
export function NavLinks({ compact = false }: { compact?: boolean }) {
  return <NavList compact={compact} pathname={usePathname()} />;
}

/** Same nav without the highlight, for the static shell. */
export function NavLinksStatic({ compact = false }: { compact?: boolean }) {
  return <NavList compact={compact} pathname="" />;
}

function NavList({ compact, pathname }: { compact: boolean; pathname: string }) {
  return (
    <nav className={cx("flex gap-1", compact ? "flex-row" : "mt-8 flex-col")}>
      {LINKS.map((l) => {
        const active = pathname === l.href || pathname.startsWith(`${l.href}/`) || (l.href === "/library" && pathname.startsWith("/projects"));
        return (
          <Link
            key={l.href}
            href={l.href}
            className={cx(
              "flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors",
              active ? "bg-surface-hover text-fg" : "text-muted hover:bg-surface hover:text-fg",
            )}
          >
            {compact ? null : <span className={cx("font-mono text-xs", active ? "text-cyan" : "text-dim")}>{l.mono}</span>}
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function UserMenu({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{name || "Creator"}</p>
        <p className="truncate font-mono text-xs text-dim">{email}</p>
      </div>
      <button
        className="self-start text-xs text-muted hover:text-fg"
        onClick={async () => {
          await authClient.signOut();
          router.push("/sign-in");
          router.refresh();
        }}
      >
        Sign out
      </button>
    </div>
  );
}
