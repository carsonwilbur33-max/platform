import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Log in" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <div className="mb-8">
        <div className="text-2xl font-semibold tracking-tight">
          Platform<span className="text-accent">.</span>
        </div>
        <p className="mt-1 text-sm text-muted">Log in to your training.</p>
      </div>
      <LoginForm />
      <p className="mt-6 text-xs text-muted">Athletes: use the invite link from your coach to create your account.</p>
    </main>
  );
}
