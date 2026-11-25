import { findValidInvite } from "@/server/auth";
import { InviteForm } from "./invite-form";

export const metadata = { title: "Create your account" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await findValidInvite(token);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <div className="mb-6 text-2xl font-semibold tracking-tight">
        Platform<span className="text-accent">.</span>
      </div>
      {!found || found.athlete.userId ? (
        <div className="card p-5 text-sm">
          <p className="font-medium">This invite link isn&apos;t valid.</p>
          <p className="mt-1 text-muted">It may have expired or already been used. Ask your coach for a new link.</p>
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted">
            Hi {found.athlete.name.split(" ")[0]} — set up your login to see your program and log your training.
          </p>
          <InviteForm token={token} defaultEmail={found.athlete.email ?? ""} />
        </>
      )}
    </main>
  );
}
