"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/actions/auth";
import { createAthlete } from "@/app/actions/coach";
import { FormError, SubmitButton } from "@/components/forms";

export function NewAthleteForm() {
  const [state, action] = useActionState<FormState, FormData>(createAthlete, {});
  return (
    <form action={action} className="card space-y-3 p-4">
      <div>
        <label className="label" htmlFor="name">
          Name
        </label>
        <input className="input" id="name" name="name" required />
      </div>
      <div>
        <label className="label" htmlFor="email">
          Email (optional)
        </label>
        <input className="input" id="email" name="email" type="email" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="unit">
            Unit
          </label>
          <select className="input" id="unit" name="unit" defaultValue="kg">
            <option value="kg">kg</option>
            <option value="lb">lb</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="bodyweight">
            Bodyweight
          </label>
          <input className="input" id="bodyweight" name="bodyweight" type="number" step="0.1" inputMode="decimal" />
        </div>
      </div>
      <FormError error={state.error} />
      <SubmitButton className="btn-primary w-full">Add athlete</SubmitButton>
    </form>
  );
}
