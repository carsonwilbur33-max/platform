"use client";

import { useActionState } from "react";
import { acceptInvite, type FormState } from "@/app/actions/auth";
import { FormError, SubmitButton } from "@/components/forms";

export function InviteForm({ token, defaultEmail }: { token: string; defaultEmail: string }) {
  const [state, action] = useActionState<FormState, FormData>(acceptInvite, {});
  return (
    <form action={action} className="card space-y-4 p-5">
      <input type="hidden" name="token" value={token} />
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input className="input" id="email" name="email" type="email" autoComplete="email" defaultValue={state.values?.email ?? defaultEmail} required />
      </div>
      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input className="input" id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
      </div>
      <div>
        <label className="label" htmlFor="confirm">
          Confirm password
        </label>
        <input className="input" id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
      </div>
      <FormError error={state.error} />
      <SubmitButton className="btn-primary w-full" pendingText="Creating account…">
        Create account
      </SubmitButton>
    </form>
  );
}
