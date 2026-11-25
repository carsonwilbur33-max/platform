"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { reloadBlockState, saveBlockOps } from "@/app/actions/editor";
import type { Op } from "@/lib/editor/ops";
import { applyOps, EditorError, type EdState } from "@/lib/editor/state";

export type SaveStatus = "saved" | "saving" | "error";

interface HistoryEntry {
  ops: Op[];
  inverse: Op[];
  label: string;
}

/**
 * Local editor state with optimistic updates, undo/redo, and a sequential
 * save queue. If the server rejects a batch, local state is replaced with
 * the saved version (history is cleared, since it no longer applies).
 */
export function useEditor(initial: EdState, notify: (msg: string) => void) {
  const [state, setState] = useState(initial);
  const stateRef = useRef(initial);
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  const [, bump] = useState(0); // re-render when stacks change
  const [status, setStatus] = useState<SaveStatus>("saved");
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const failed = useRef(false);

  const set = (s: EdState) => {
    stateRef.current = s;
    setState(s);
  };

  const resync = useCallback(async () => {
    const r = await reloadBlockState(initial.blockId);
    if (r.ok) set(r.state);
    undoStack.current = [];
    redoStack.current = [];
    bump((n) => n + 1);
  }, [initial.blockId]);

  const enqueue = useCallback(
    (ops: Op[]) => {
      if (ops.length === 0) return;
      pending.current++;
      setStatus("saving");
      queue.current = queue.current.then(async () => {
        if (failed.current) return; // a previous batch failed; resync is under way
        let result: Awaited<ReturnType<typeof saveBlockOps>>;
        try {
          result = await saveBlockOps(initial.blockId, ops);
        } catch {
          result = { ok: false, error: "Couldn't reach the server." };
        }
        if (!result.ok) {
          failed.current = true;
          setStatus("error");
          notify(`Not saved: ${result.error} Showing the last saved version.`);
          await resync();
          failed.current = false;
        }
        pending.current--;
        if (pending.current === 0 && !failed.current) setStatus((s) => (s === "error" ? s : "saved"));
      });
    },
    [initial.blockId, notify, resync],
  );

  /** Apply ops locally (validated by the reducer), record undo, and save. Returns false if rejected. */
  const commit = useCallback(
    (ops: Op[], label: string): boolean => {
      if (ops.length === 0) return true;
      try {
        const { state: next, inverse } = applyOps(stateRef.current, ops);
        set(next);
        undoStack.current.push({ ops, inverse, label });
        if (undoStack.current.length > 200) undoStack.current.shift();
        redoStack.current = [];
        bump((n) => n + 1);
        enqueue(ops);
        return true;
      } catch (e) {
        if (e instanceof EditorError) {
          notify(e.message);
          return false;
        }
        throw e;
      }
    },
    [enqueue, notify],
  );

  const undo = useCallback(() => {
    const entry = undoStack.current.pop();
    if (!entry) return;
    try {
      set(applyOps(stateRef.current, entry.inverse).state);
      redoStack.current.push(entry);
      enqueue(entry.inverse);
      notify(`Undid: ${entry.label}`);
    } catch (e) {
      notify(e instanceof EditorError ? e.message : "Couldn't undo.");
    }
    bump((n) => n + 1);
  }, [enqueue, notify]);

  const redo = useCallback(() => {
    const entry = redoStack.current.pop();
    if (!entry) return;
    try {
      set(applyOps(stateRef.current, entry.ops).state);
      undoStack.current.push(entry);
      enqueue(entry.ops);
      notify(`Redid: ${entry.label}`);
    } catch (e) {
      notify(e instanceof EditorError ? e.message : "Couldn't redo.");
    }
    bump((n) => n + 1);
  }, [enqueue, notify]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (pending.current > 0) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  return {
    state,
    stateRef,
    /** Replace state from the server (e.g. after changing the start date). Clears history. */
    replace: (s: EdState) => {
      set(s);
      undoStack.current = [];
      redoStack.current = [];
      bump((n) => n + 1);
    },
    commit,
    undo,
    redo,
    /** Resolves once every queued save has finished. */
    flush: () => queue.current,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    undoLabel: undoStack.current.at(-1)?.label,
    redoLabel: redoStack.current.at(-1)?.label,
    status,
  };
}
