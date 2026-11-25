"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LibraryExercise } from "@/server/editor-data";

const MAIN = ["Squat", "Bench Press", "Deadlift"];

/** Rank library matches: every word must appear; prefix matches and main lifts first. */
export function searchExercises(library: LibraryExercise[], query: string, limit = 8): LibraryExercise[] {
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  return library
    .filter((e) => !e.archived && words.every((w) => e.name.toLowerCase().includes(w)))
    .map((e) => {
      const n = e.name.toLowerCase();
      const score = (n === q ? 0 : n.startsWith(q) ? 1 : 2) * 10 + (MAIN.includes(e.name) ? 0 : 1);
      return { e, score };
    })
    .sort((a, b) => a.score - b.score || a.e.name.localeCompare(b.e.name))
    .slice(0, limit)
    .map((x) => x.e);
}

export function ExercisePicker({
  library,
  initialQuery = "",
  onPick,
  onCreate,
  onCancel,
  placeholder = "Search exercises…",
}: {
  library: LibraryExercise[];
  initialQuery?: string;
  onPick: (e: LibraryExercise) => void;
  onCreate: (name: string) => Promise<LibraryExercise | null>;
  onCancel: () => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => searchExercises(library, query), [library, query]);
  const exact = matches.some((m) => m.name.toLowerCase() === query.trim().toLowerCase());
  const options = [...matches.map((m) => ({ kind: "pick" as const, m })), ...(query.trim() && !exact ? [{ kind: "create" as const }] : [])];

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useEffect(() => setActive(0), [query]);

  const choose = async (i: number) => {
    const o = options[i];
    if (!o || busy) return;
    if (o.kind === "pick") return onPick(o.m);
    setBusy(true);
    const created = await onCreate(query.trim());
    setBusy(false);
    if (created) onPick(created);
  };

  return (
    <div
      className="absolute left-0 top-0 z-40 w-72 rounded-md border border-border-strong bg-surface shadow-lg"
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        className="w-full rounded-t-md border-b border-border bg-surface px-3 py-2 text-sm outline-none"
        value={query}
        placeholder={placeholder}
        aria-label="Exercise"
        role="combobox"
        aria-expanded="true"
        aria-controls="exercise-options"
        onChange={(e) => setQuery(e.target.value)}
        onBlur={() => setTimeout(onCancel, 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(options.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            void choose(active);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <ul id="exercise-options" role="listbox" className="max-h-72 overflow-auto py-1 text-sm">
        {options.length === 0 && <li className="px-3 py-2 text-muted">Type to search</li>}
        {options.map((o, i) => (
          <li
            key={o.kind === "pick" ? o.m.id : "create"}
            role="option"
            aria-selected={i === active}
            className={`cursor-pointer px-3 py-1.5 ${i === active ? "bg-accent-soft" : ""}`}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              void choose(i);
            }}
          >
            {o.kind === "pick" ? (
              <span className="flex justify-between gap-2">
                <span>{o.m.name}</span>
                {o.m.parentId && <span className="text-xs text-muted">variation</span>}
              </span>
            ) : (
              <span className="text-accent">{busy ? "Creating…" : `+ Create “${query.trim()}”`}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
