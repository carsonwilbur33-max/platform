"use client";

import { useActionState, useState, useTransition } from "react";
import type { FormState } from "@/app/actions/auth";
import { addTrainingMax, generateInviteLink, updateAthlete, upsertExerciseOverride } from "@/app/actions/coach";
import { FormError, SubmitButton } from "@/components/forms";

type Option = { id: string; name: string };

export function InviteButton({ athleteId, active }: { athleteId: string; active: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="max-w-md text-right">
      {active ? (
        <span className="rounded bg-accent-soft px-2 py-1 text-xs font-medium text-accent">Account active</span>
      ) : (
        <button
          className="btn-primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await generateInviteLink(athleteId);
              setUrl(r.url);
              setCopied(false);
            })
          }
        >
          {pending ? "Creating…" : url ? "New invite link" : "Create invite link"}
        </button>
      )}
      {url && (
        <div className="mt-2 flex items-center gap-2">
          <input className="input font-mono text-xs" readOnly value={url} onFocus={(e) => e.target.select()} />
          <button
            className="btn-secondary shrink-0"
            onClick={async () => {
              await navigator.clipboard.writeText(url);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {url && <p className="mt-1 text-xs text-muted">Single use, expires in 7 days. Send it to the athlete yourself.</p>}
    </div>
  );
}

export function DeleteButton({ action, label }: { action: () => Promise<void>; label: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={pending}
      className="rounded px-1.5 text-muted hover:bg-bad-soft hover:text-bad"
      onClick={() => {
        if (confirm(`${label}?`)) start(() => action());
      }}
    >
      ×
    </button>
  );
}

export function TmForm({ athleteId, unit, exercises, today }: { athleteId: string; unit: string; exercises: Option[]; today: string }) {
  const [state, action] = useActionState<FormState, FormData>(addTrainingMax.bind(null, athleteId), {});
  return (
    <form action={action} className="space-y-2">
      <div className="grid grid-cols-[1fr_90px_70px_130px] gap-2">
        <select name="exerciseId" className="input" required defaultValue="">
          <option value="" disabled>
            Exercise…
          </option>
          {exercises.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <input name="weight" className="input" type="number" step="0.5" inputMode="decimal" placeholder="TM" required />
        <select name="unit" className="input" defaultValue={unit}>
          <option value="kg">kg</option>
          <option value="lb">lb</option>
        </select>
        <input name="effectiveDate" className="input" type="date" defaultValue={today} required />
      </div>
      <div className="flex gap-2">
        <input name="note" className="input" placeholder="Note (optional)" />
        <SubmitButton className="btn-secondary shrink-0">Add TM</SubmitButton>
      </div>
      <FormError error={state.error} />
    </form>
  );
}

export function OverrideForm({ athleteId, exercises }: { athleteId: string; exercises: Option[] }) {
  const [state, action] = useActionState<FormState, FormData>(upsertExerciseOverride.bind(null, athleteId), {});
  return (
    <form action={action} className="space-y-2">
      <div className="grid grid-cols-[1fr_80px_90px_90px_auto] gap-2">
        <select name="exerciseId" className="input" required defaultValue="">
          <option value="" disabled>
            Exercise…
          </option>
          {exercises.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <select name="unit" className="input" defaultValue="">
          <option value="">unit</option>
          <option value="kg">kg</option>
          <option value="lb">lb</option>
        </select>
        <input name="rounding" className="input" type="number" step="0.25" placeholder="round" inputMode="decimal" />
        <input name="tmRatio" className="input" type="number" step="0.5" placeholder="ratio %" inputMode="decimal" />
        <SubmitButton className="btn-secondary">Save</SubmitButton>
      </div>
      <FormError error={state.error} />
    </form>
  );
}

interface SettingsDefaults {
  name: string;
  email: string;
  unit: string;
  roundingKg: number;
  roundingLb: number;
  bodyweight: string;
  e1rmFormula: string;
  notes: string;
}

export function AthleteSettingsForm({ athleteId, defaults: d }: { athleteId: string; defaults: SettingsDefaults }) {
  const [state, action] = useActionState<FormState, FormData>(updateAthlete.bind(null, athleteId), {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <label className="label">Name</label>
        <input className="input" name="name" defaultValue={d.name} required />
      </div>
      <div>
        <label className="label">Email</label>
        <input className="input" name="email" type="email" defaultValue={d.email} />
      </div>
      <div>
        <label className="label">Display unit</label>
        <select className="input" name="unit" defaultValue={d.unit}>
          <option value="kg">kg</option>
          <option value="lb">lb</option>
        </select>
      </div>
      <div>
        <label className="label">Bodyweight ({d.unit})</label>
        <input className="input" name="bodyweight" type="number" step="0.1" defaultValue={d.bodyweight} />
      </div>
      <div>
        <label className="label">Rounding (kg)</label>
        <input className="input" name="roundingKg" type="number" step="0.25" defaultValue={d.roundingKg} required />
      </div>
      <div>
        <label className="label">Rounding (lb)</label>
        <input className="input" name="roundingLb" type="number" step="0.5" defaultValue={d.roundingLb} required />
      </div>
      <div>
        <label className="label">e1RM formula (no RPE)</label>
        <select className="input" name="e1rmFormula" defaultValue={d.e1rmFormula}>
          <option value="epley">Epley</option>
          <option value="brzycki">Brzycki</option>
        </select>
      </div>
      <div className="sm:col-span-2 lg:col-span-4">
        <label className="label">Coach notes</label>
        <textarea className="input min-h-20" name="notes" defaultValue={d.notes} />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
        <SubmitButton className="btn-primary">Save settings</SubmitButton>
        <FormError error={state.error} />
      </div>
    </form>
  );
}
