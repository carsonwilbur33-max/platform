"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createBlock } from "@/app/actions/programs";

/** Assign a template to an athlete: an independent copy, into one of their programs or a new one. */
export function AssignTemplate({
  templateBlockId,
  templateName,
  athletes,
  programs,
  defaultStart,
}: {
  templateBlockId: string;
  templateName: string;
  athletes: { id: string; name: string }[];
  programs: { id: string; name: string; athleteId: string }[];
  defaultStart: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [athleteId, setAthleteId] = useState(athletes[0]?.id ?? "");
  const theirs = programs.filter((p) => p.athleteId === athleteId);
  const [programId, setProgramId] = useState<string>("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const effectiveProgram = programId && theirs.some((p) => p.id === programId) ? programId : (theirs[0]?.id ?? "new");

  if (!open)
    return (
      <button className="btn-primary py-1 text-sm" onClick={() => setOpen(true)} disabled={athletes.length === 0}>
        Assign…
      </button>
    );

  return (
    <form
      className="flex w-full flex-wrap items-end gap-2 rounded-md bg-surface-2 p-3 text-sm"
      action={(fd) =>
        start(async () => {
          setError(undefined);
          const r = await createBlock(fd);
          if (!r.ok) return setError(r.error);
          router.push(`/coach/blocks/${r.blockId}`);
        })
      }
    >
      <input type="hidden" name="source" value="template" />
      <input type="hidden" name="sourceBlockId" value={templateBlockId} />
      <input type="hidden" name="name" value={templateName} />
      <label className="grow">
        <span className="label">Athlete</span>
        <select name="athleteId" className="input" value={athleteId} onChange={(e) => setAthleteId(e.target.value)}>
          {athletes.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grow">
        <span className="label">Program</span>
        <select name="programId" className="input" value={effectiveProgram} onChange={(e) => setProgramId(e.target.value)}>
          {theirs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="new">New program</option>
        </select>
      </label>
      {effectiveProgram === "new" && <input type="hidden" name="programName" value={templateName} />}
      <label>
        <span className="label">Starts</span>
        <input name="startDate" type="date" className="input" defaultValue={defaultStart} />
      </label>
      <button className="btn-primary" disabled={pending}>
        {pending ? "Assigning…" : "Assign"}
      </button>
      <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {error && <p className="w-full text-bad">{error}</p>}
    </form>
  );
}
