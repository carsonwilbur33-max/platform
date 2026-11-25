import Link from "next/link";
import { logout } from "@/app/actions/auth";
import { requireAthlete } from "@/server/auth";
import { AthleteNav } from "./nav";

export default async function AthleteLayout({ children }: { children: React.ReactNode }) {
  await requireAthlete();
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-lg items-center gap-4 px-4">
          <Link href="/athlete" className="font-semibold tracking-tight">
            Platform<span className="text-accent">.</span>
          </Link>
          <AthleteNav />
          <form action={logout} className="ml-auto">
            <button className="text-sm text-muted">Log out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-4">{children}</main>
    </div>
  );
}
