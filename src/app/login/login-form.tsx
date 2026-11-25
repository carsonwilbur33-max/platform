"use client";

import { useActionState } from "react";
import { login, type FormState } from "@/app/actions/auth";
import { FormError, SubmitButton } from "@/components/forms";

export function LoginForm() {
  const [state, action] = useActionState<FormState, FormData>(login, {});
  return (
    <form action={action} className="card space-y-4 p-5">
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input className="input" id="email" name="email" type="email" autoComplete="email" defaultValue={state.values?.email} required autoFocus={!state.values?.email} />
      </div>
      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input className="input" id="password" name="password" type="password" autoComplete="current-password" required autoFocus={!!state.values?.email} />
      </div>
      <FormError error={state.error} />
      <SubmitButton className="btn-primary w-full" pendingText="Logging in…">
        Log in
      </SubmitButton>
    </form>
  );
}
