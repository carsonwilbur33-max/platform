import Link from "next/link";
import { logout } from "@/app/actions/auth";
import { requireCoach } from "@/server/auth";

export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  const user = await requireCoach();
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-[1600px] items-center gap-6 px-4">
          <Link href="/coach" className="font-semibold tracking-tight">
            Platform<span className="text-accent">.</span>
          </Link>
          <nav className="flex gap-4 text-sm text-muted">
            <Link href="/coach" className="hover:text-text">
              Athletes
            </Link>
            <Link href="/coach/templates" className="hover:text-text">
              Templates
            </Link>
            <Link href="/coach/exercises" className="hover:text-text">
              Exercises
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-muted">
            <span className="hidden sm:inline">{user.email}</span>
            <form action={logout}>
              <button className="hover:text-text">Log out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-4 py-6">{children}</main>
    </div>
  );
}
