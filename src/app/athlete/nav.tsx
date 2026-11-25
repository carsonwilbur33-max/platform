"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function AthleteNav() {
  const path = usePathname();
  const link = (href: string, label: string, active: boolean) => (
    <Link href={href} aria-current={active ? "page" : undefined} className={`text-sm ${active ? "font-medium text-text" : "text-muted"}`}>
      {label}
    </Link>
  );
  return (
    <nav className="flex gap-4">
      {link("/athlete", "Today", path === "/athlete")}
      {link("/athlete/program", "Program", path.startsWith("/athlete/program") || path.startsWith("/athlete/session"))}
    </nav>
  );
}
