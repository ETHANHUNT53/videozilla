import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/ui";
import { NavLinks, NavLinksStatic, UserMenu } from "@/components/app-shell";
import { getSession } from "@/server/dal";

/** Signed-in shell. The layout itself stays static; only the user menu reads the session, behind Suspense. */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-1">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line px-4 py-5 md:flex">
        <Link href="/library" className="px-2 text-lg">
          <Logo />
        </Link>
        <Suspense fallback={<NavLinksStatic />}>
          <NavLinks />
        </Suspense>
        <div className="mt-auto">
          <Suspense fallback={<div className="h-12" />}>
            <CurrentUser />
          </Suspense>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line px-5 py-3 md:hidden">
          <Link href="/library">
            <Logo />
          </Link>
          <Suspense fallback={<NavLinksStatic compact />}>
            <NavLinks compact />
          </Suspense>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 md:px-10">{children}</main>
      </div>
    </div>
  );
}

async function CurrentUser() {
  const session = await getSession();
  if (!session) return null;
  return <UserMenu name={session.user.name} email={session.user.email} />;
}
