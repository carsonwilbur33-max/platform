/**
 * Prescription shorthand: what the coach types into a grid cell.
 *
 *   3x5 @7-7.5 [175-180kg]        RPE target, load hard bound
 *   top 1 @8; 4x4 -8%             top single then backoffs
 *   4 -8% until @9 max6           repeat until RPE 9, max 6 sets
 *   1xAMRAP 80% @9                AMRAP at 80% TM, stop at RPE 9
 *
 * See docs/PLAN.md for the full table.
 */
import type { Intensity, NumRange, SetGroup } from "./prescription";
import { clean, fmtNum, fromKg, toKg, type Unit } from "./units";

export type ParseResult =
  | { ok: true; groups: SetGroup[] }
  | { ok: false; error: string; group: number };

const NUM = String.raw`\d+(?:\.\d+)?`;
const RANGE = String.raw`(${NUM})(?:-(${NUM}))?`;

const RE = {
  setsReps: new RegExp(String.raw`^(\d+)(?:-(\d+))?x(\d+(?:-\d+)?|amrap)$`),
  reps: /^(\d+)(?:-(\d+))?$/,
  rpe: new RegExp(String.raw`^@${RANGE}$`),
  rirPrefix: new RegExp(String.raw`^rir${RANGE}$`),
  rirSuffix: new RegExp(String.raw`^${RANGE}rir$`),
  pctE1rm: new RegExp(String.raw`^${RANGE}%e1rm$`),
  pct: new RegExp(String.raw`^${RANGE}%$`),
  drop: new RegExp(String.raw`^-${RANGE}%$`),
  load: new RegExp(String.raw`^${RANGE}(kg|lbs?)$`),
  max: /^(?:max|cap)(\d+)$/,
};

class ParseError extends Error {}

function fail(msg: string): never {
  throw new ParseError(msg);
}

function range(minStr: string, maxStr: string | undefined): NumRange {
  const min = Number(minStr);
  const max = maxStr === undefined ? min : Number(maxStr);
  if (max < min) fail(`Range ${minStr}-${maxStr} goes backwards.`);
  return { min, max };
}

function checkRpe(r: NumRange, label = "RPE"): void {
  for (const v of [r.min, r.max]) {
    if (v < 1 || v > 10) fail(`${label} ${v} must be between 1 and 10.`);
    if (Math.round(v * 2) !== v * 2) fail(`${label} ${v} must be in 0.5 steps.`);
  }
}

function checkInt(r: NumRange, label: string): void {
  if (!Number.isInteger(r.min) || !Number.isInteger(r.max) || r.min < 1) fail(`${label} must be whole numbers of 1 or more.`);
}

/** Normalize typing variations before tokenizing. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/×/g, "x")
    .replace(/(\d)\s*x\s*(?=\d|amrap)/g, "$1x")
    .replace(/@\s+/g, "@")
    .replace(/\brir\s+(\d)/g, "rir$1")
    .replace(/(\d)\s+(kg|lbs?|rir)\b/g, "$1$2")
    .replace(/(\d)\s+%/g, "$1%")
    .replace(/%\s*e1rm/g, "%e1rm")
    .replace(/\b(max|cap)\s+(\d)/g, "$1$2")
    .trim();
}

/** Parse a single intensity token, or null if the token isn't one. */
export function parseIntensity(tok: string): Intensity | null {
  let m: RegExpMatchArray | null;
  if ((m = tok.match(RE.rpe))) {
    const r = range(m[1], m[2]);
    checkRpe(r);
    return { kind: "rpe", ...r };
  }
  if ((m = tok.match(RE.rirPrefix) ?? tok.match(RE.rirSuffix))) {
    const r = range(m[1], m[2]);
    if (r.min < 0 || r.max > 9) fail("RIR must be between 0 and 9.");
    if (Math.round(r.min * 2) !== r.min * 2 || Math.round(r.max * 2) !== r.max * 2) fail("RIR must be in 0.5 steps.");
    return { kind: "rir", ...r };
  }
  if ((m = tok.match(RE.pctE1rm))) {
    const r = range(m[1], m[2]);
    if (r.min <= 0 || r.max > 110) fail(`${tok}: % of e1RM must be between 0 and 110.`);
    return { kind: "pctE1rm", ...r };
  }
  if ((m = tok.match(RE.drop))) {
    const r = range(m[1], m[2]);
    if (r.min <= 0 || r.max >= 60) fail(`${tok}: a backoff drop must be between 0 and 60%.`);
    return { kind: "drop", ...r };
  }
  if ((m = tok.match(RE.pct))) {
    const r = range(m[1], m[2]);
    if (r.min <= 0 || r.max > 120) fail(`${tok}: % of training max must be between 0 and 120.`);
    return { kind: "pct1rm", ...r };
  }
  if ((m = tok.match(RE.load))) {
    const r = range(m[1], m[2]);
    const unit: Unit = m[3] === "kg" ? "kg" : "lb";
    if (r.min <= 0) fail(`${tok}: load must be above 0.`);
    return { kind: "load", minKg: toKg(r.min, unit), maxKg: toKg(r.max, unit), unit };
  }
  return null;
}

function parseGroup(raw: string): SetGroup {
  let text = normalize(raw);

  // Pull out [bounds] first; they may contain spaces.
  const bounds: Intensity[] = [];
  text = text.replace(/\[([^\]]*)\]/g, (_, inner: string) => {
    const toks = normalize(inner).split(/\s+/).filter(Boolean);
    if (toks.length === 0) fail("Empty [ ] bound.");
    for (const t of toks) {
      const i = parseIntensity(t);
      if (!i) fail(`"${t}" inside [ ] is not an RPE, RIR, %, or load.`);
      bounds.push(i);
    }
    return " ";
  });
  if (/[[\]]/.test(text)) fail("Unmatched [ or ].");

  const toks = text.split(/\s+/).filter(Boolean);
  if (toks.length === 0) fail("Empty set group.");

  let mode: SetGroup["mode"] = "straight";
  let sets: NumRange | null = null;
  let reps: SetGroup["reps"] | null = null;
  let repeatUntilRpe: number | undefined;
  let maxSets: number | undefined;
  const free: Intensity[] = [];

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    let m: RegExpMatchArray | null;
    if (t === "top") {
      if (mode !== "straight") fail('"top" can only appear once.');
      mode = "workUp";
      continue;
    }
    if (t === "until") {
      const next = toks[++i];
      const r = next?.match(RE.rpe);
      if (!r || r[2] !== undefined) fail('"until" must be followed by a single RPE, e.g. "until @9".');
      repeatUntilRpe = Number(r[1]);
      checkRpe({ min: repeatUntilRpe, max: repeatUntilRpe });
      if (mode === "workUp") fail('"top" and "until" cannot be combined.');
      mode = "repeatUntil";
      continue;
    }
    if (t.startsWith("until@")) {
      toks.splice(i + 1, 0, t.slice(5));
      toks[i] = "until";
      i--;
      continue;
    }
    if ((m = t.match(RE.max))) {
      maxSets = Number(m[1]);
      if (maxSets < 1) fail("max sets must be at least 1.");
      continue;
    }
    if (reps === null && (m = t.match(RE.setsReps))) {
      sets = range(m[1], m[2]);
      checkInt(sets, "Sets");
      if (m[3] === "amrap") reps = "amrap";
      else {
        const [a, b] = m[3].split("-");
        reps = range(a, b);
        checkInt(reps, "Reps");
      }
      continue;
    }
    if (reps === null && t === "amrap") {
      reps = "amrap";
      continue;
    }
    if (reps === null && (m = t.match(RE.reps))) {
      reps = range(m[1], m[2]);
      checkInt(reps, "Reps");
      continue;
    }
    const intensity = parseIntensity(t);
    if (intensity) {
      free.push(intensity);
      continue;
    }
    fail(`Don't understand "${t}".`);
  }

  if (reps === null) fail('Missing sets×reps (e.g. "3x5") or reps.');

  if (mode === "repeatUntil") {
    if (sets !== null) fail('"until" sets are open-ended; write reps only, e.g. "4 -8% until @9".');
    if (reps === "amrap") fail("Repeat-until sets need a rep count.");
  } else {
    if (sets === null) sets = { min: 1, max: 1 };
    if (maxSets !== undefined) fail('"max" only applies to "until" sets.');
  }

  // With AMRAP, an RPE outside brackets is the stop cap, not the target.
  let amrapRpeCap: number | undefined;
  if (reps === "amrap") {
    const rpeIdx = free.findIndex((x) => x.kind === "rpe");
    if (rpeIdx >= 0) {
      const r = free[rpeIdx];
      if (r.kind === "rpe" && r.min !== r.max) fail("AMRAP RPE cap must be a single value.");
      amrapRpeCap = r.kind === "rpe" ? r.min : undefined;
      free.splice(rpeIdx, 1);
    }
  }

  if (free.length > 1) fail("Only one target per set group. Put hard bounds in [brackets], e.g. 3x5 @7 [175-180kg].");
  const target = free[0] ?? null;

  if (mode === "repeatUntil" && !target && !bounds.some((b) => b.kind !== "rpe" && b.kind !== "rir")) {
    fail('Repeat-until sets need a load, e.g. "4 -8% until @9" or "3 150kg until @8".');
  }

  const sg: SetGroup = { mode, sets, reps, target, bounds };
  if (amrapRpeCap !== undefined) sg.amrapRpeCap = amrapRpeCap;
  if (repeatUntilRpe !== undefined) sg.repeatUntilRpe = repeatUntilRpe;
  if (maxSets !== undefined) sg.maxSets = maxSets;
  return sg;
}

/** Parse a full cell: set groups separated by ";" or new lines. */
export function parsePrescription(text: string): ParseResult {
  const parts = text
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const groups: SetGroup[] = [];
  for (let i = 0; i < parts.length; i++) {
    try {
      groups.push(parseGroup(parts[i]));
    } catch (e) {
      if (e instanceof ParseError) return { ok: false, error: e.message, group: i };
      throw e;
    }
  }
  return { ok: true, groups };
}

/** Throwing variant, for seeds and tests. */
export function rx(text: string): SetGroup[] {
  const r = parsePrescription(text);
  if (!r.ok) throw new Error(`Bad prescription "${text}": ${r.error}`);
  return r.groups;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function fmtRange(r: NumRange): string {
  return r.min === r.max ? fmtNum(r.min) : `${fmtNum(r.min)}-${fmtNum(r.max)}`;
}

export function formatIntensity(i: Intensity): string {
  switch (i.kind) {
    case "rpe":
      return `@${fmtRange(i)}`;
    case "rir":
      return `rir${fmtRange(i)}`;
    case "pct1rm":
      return `${fmtRange(i)}%`;
    case "drop":
      return `-${fmtRange(i)}%`;
    case "pctE1rm":
      return `${fmtRange(i)}%e1rm`;
    case "load": {
      const min = clean(fromKg(i.minKg, i.unit), 2);
      const max = clean(fromKg(i.maxKg, i.unit), 2);
      return `${fmtRange({ min, max })}${i.unit}`;
    }
  }
}

export function formatSetGroup(sg: SetGroup): string {
  const parts: string[] = [];
  const reps = sg.reps === "amrap" ? "AMRAP" : fmtRange(sg.reps);
  if (sg.mode === "repeatUntil") {
    parts.push(reps);
  } else if (sg.mode === "workUp") {
    parts.push("top");
    const s = sg.sets ?? { min: 1, max: 1 };
    parts.push(s.min === 1 && s.max === 1 ? reps : `${fmtRange(s)}x${reps}`);
  } else {
    parts.push(`${fmtRange(sg.sets ?? { min: 1, max: 1 })}x${reps}`);
  }
  if (sg.target) parts.push(formatIntensity(sg.target));
  if (sg.amrapRpeCap !== undefined) parts.push(`@${fmtNum(sg.amrapRpeCap)}`);
  if (sg.repeatUntilRpe !== undefined) parts.push(`until @${fmtNum(sg.repeatUntilRpe)}`);
  if (sg.maxSets !== undefined) parts.push(`max${sg.maxSets}`);
  for (const b of sg.bounds) parts.push(`[${formatIntensity(b)}]`);
  return parts.join(" ");
}

export function formatPrescription(groups: SetGroup[]): string {
  return groups.map(formatSetGroup).join("; ");
}
