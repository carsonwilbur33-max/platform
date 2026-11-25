"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createBlock } from "@/app/actions/programs";
import { FormError } from "@/components/forms";
import { WEEKDAY_SHORT } from "@/lib/dates";

export interface BlockOption {
  blockId: string;
  label: string;
}

export function NewBlockForm({
  athleteId,
  programs,
  templates,
  ownBlocks,
  defaultStart,
  defaultSource = "blank",
  defaultTemplateId,
}: {
  /** Null to create a new template. */
  athleteId: string | null;
  programs: { id: string; name: string }[];
  templates: BlockOption[];
  ownBlocks: BlockOption[];
  defaultStart: string;
  defaultSource?: "blank" | "template" | "copy";
  defaultTemplateId?: string;
}) {
  const router = useRouter();
  const [source, setSource] = useState<"blank" | "template" | "copy">(defaultSource);
  const [programId, setProgramId] = useState(programs[0]?.id ?? "new");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const forTemplate = athleteId === null;

  return (
    <form
      className="space-y-3"
      action={(fd) =>
        start(async () => {
          setError(undefined);
          const r = await createBlock(fd);
          if (!r.ok) return setError(r.error);
          router.push(`/coach/blocks/${r.blockId}`);
        })
      }
    >
      <input type="hidden" name="athleteId" value={athleteId ?? ""} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="nb-name">
            {forTemplate ? "Template name" : "Block name"}
          </label>
          <input id="nb-name" name="name" className="input" required placeholder={forTemplate ? "e.g. 4-week strength" : "e.g. Strength 2"} />
        </div>
        <div>
          <label className="label" htmlFor="nb-kind">
            Type
          </label>
          <select id="nb-kind" name="kind" className="input" defaultValue="strength">
            {["hypertrophy", "strength", "peak", "pivot", "taper", "other"].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </div>
        {!forTemplate && (
          <>
            <div>
              <label className="label" htmlFor="nb-program">
                Program
              </label>
              <select id="nb-program" name="programId" className="input" value={programId} onChange={(e) => setProgramId(e.target.value)}>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value="new">New program…</option>
              </select>
              {programId === "new" && <input name="programName" className="input mt-2" placeholder="Program name, e.g. Spring Classic prep" />}
            </div>
            <div>
              <label className="label" htmlFor="nb-start">
                Starts
              </label>
              <input id="nb-start" name="startDate" type="date" className="input" defaultValue={defaultStart} />
            </div>
          </>
        )}
      </div>

      <fieldset>
        <legend className="label">Start from</legend>
        <div className="flex flex-wrap gap-3 text-sm">
          {(["blank", "template", "copy"] as const)
            .filter((s) => !(forTemplate && s === "template"))
            .map((s) => (
              <label key={s} className="flex items-center gap-1.5">
                <input type="radio" name="source" value={s} checked={source === s} onChange={() => setSource(s)} />
                {{ blank: "Blank", template: "A template", copy: forTemplate ? "An existing block" : "Another of this athlete's blocks" }[s]}
              </label>
            ))}
        </div>
      </fieldset>

      {source === "blank" && (
        <div className="grid gap-3 sm:grid-cols-[100px_1fr]">
          <div>
            <label className="label" htmlFor="nb-weeks">
              Weeks
            </label>
            <input id="nb-weeks" name="weeks" type="number" min={1} max={26} defaultValue={4} className="input" />
          </div>
          <div>
            <span className="label">Training days</span>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_SHORT.map((d, i) => (
                <label key={d} className="flex cursor-pointer items-center gap-1 rounded border border-border px-2 py-1.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                  <input type="checkbox" name="weekdays" value={i} defaultChecked={[0, 2, 4].includes(i)} className="sr-only" />
                  {d}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">One day per checked weekday. You can rename, reorder and add days in the editor.</p>
          </div>
        </div>
      )}
      {source === "template" && (
        <div>
          <label className="label" htmlFor="nb-template">
            Template
          </label>
          <select id="nb-template" name="sourceBlockId" className="input" defaultValue={defaultTemplateId} required>
            {templates.length === 0 && <option value="">No templates yet</option>}
            {templates.map((t) => (
              <option key={t.blockId} value={t.blockId}>
                {t.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted">Creates an independent copy: editing it never changes the template.</p>
        </div>
      )}
      {source === "copy" && (
        <div>
          <label className="label" htmlFor="nb-copy">
            Block to copy
          </label>
          <select id="nb-copy" name="sourceBlockId" className="input" required>
            {ownBlocks.length === 0 && <option value="">No blocks yet</option>}
            {ownBlocks.map((b) => (
              <option key={b.blockId} value={b.blockId}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <FormError error={error} />
      <button className="btn-primary" disabled={pending}>
        {pending ? "Creating…" : forTemplate ? "Create template" : "Create block"}
      </button>
    </form>
  );
}
