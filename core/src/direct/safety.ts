import { DirectLimits } from "../projects.js";

export function pctChange(current: number, proposed: number): number {
  if (current === 0) return proposed === 0 ? 0 : Infinity;
  return Math.abs((proposed - current) / current) * 100;
}

export interface MoneyDelta {
  field: string;
  kind: "budget" | "bid";
  current: number;
  proposed: number;
}

export interface Violation {
  field: string;
  kind: string;
  changePct: number;
  limitPct: number;
}

export function checkLimits(deltas: MoneyDelta[], limits: DirectLimits): Violation[] {
  const out: Violation[] = [];
  for (const d of deltas) {
    const limitPct = d.kind === "budget" ? limits.max_budget_change_pct : limits.max_bid_change_pct;
    const changePct = pctChange(d.current, d.proposed);
    if (changePct > limitPct) out.push({ field: d.field, kind: d.kind, changePct, limitPct });
  }
  return out;
}

export interface DiffEntry {
  field: string;
  current: unknown;
  proposed: unknown;
}

export function buildDiff(current: Record<string, unknown>, proposed: Record<string, unknown>): DiffEntry[] {
  const keys = [...new Set([...Object.keys(current), ...Object.keys(proposed)])];
  const out: DiffEntry[] = [];
  for (const k of keys) {
    if (JSON.stringify(current[k]) !== JSON.stringify(proposed[k])) {
      out.push({ field: k, current: current[k], proposed: proposed[k] });
    }
  }
  return out;
}

// Playbook rule M3: Direct recalculates the weekly budget over the remaining
// days of the calendar week, ignoring what was already spent, and tries to
// burn it before Sunday night. Budget changes on Fri-Sun are therefore unsafe.
export function weekendWarning(now: Date, timeZone = "Europe/Moscow"): string | null {
  const day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(now);
  if (day === "Fri" || day === "Sat" || day === "Sun") {
    return (
      `It is ${day} in ${timeZone}: significant budget changes and campaign launches ` +
      `on Fri-Sun make Direct spend the weekly budget over the remaining days. ` +
      `Prefer Mon-Thu, or pass force:true to proceed anyway.`
    );
  }
  return null;
}

export interface ItemError {
  index: number;
  errors: { Code?: number; Message?: string; Details?: string }[];
}

export interface ResultsSummary {
  operation: string;
  total: number;
  succeeded: number;
  failed: number;
  warnings: number;
  itemErrors: ItemError[];
}

// Direct write methods return result.{Add,Update,...}Results[] aligned with the
// input array; a failed item carries Errors instead of Id while HTTP stays 200.
export function summarizeResults(response: unknown): ResultsSummary | null {
  const result = (response as { result?: Record<string, unknown> } | null)?.result;
  if (!result || typeof result !== "object") return null;
  const key = Object.keys(result).find((k) => k.endsWith("Results") && Array.isArray(result[k]));
  if (!key) return null;
  const items = result[key] as { Errors?: ItemError["errors"]; Warnings?: unknown[] }[];
  const itemErrors: ItemError[] = [];
  let warnings = 0;
  items.forEach((item, index) => {
    if (item?.Errors?.length) itemErrors.push({ index, errors: item.Errors });
    if (Array.isArray(item?.Warnings) && item.Warnings.length) warnings += 1;
  });
  return {
    operation: key,
    total: items.length,
    succeeded: items.length - itemErrors.length,
    failed: itemErrors.length,
    warnings,
    itemErrors,
  };
}
