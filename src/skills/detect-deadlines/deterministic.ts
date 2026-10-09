import { ExtractedItem } from "../../domain/items";
import {
  DetectedDeadline,
  DetectedDeadlines,
  DeadlineKind,
} from "../../domain/deadlines";

export interface DeadlinesValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Checks if a string is a strictly valid calendar date formatted as YYYY-MM-DD.
 */
export function isValidIsoDate(str: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return false;
  }
  const [yearStr, monthStr, dayStr] = str.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

/**
 * Phrases that explicitly express vague desires, future wishes, or calm exploration,
 * and must NEVER be treated as actionable deadlines.
 */
const VAGUE_NON_DEADLINE_PATTERNS = [
  /^alg[uú]n d[ií]a/i,
  /^m[aá]s adelante/i,
  /^cuando estemos m[aá]s tranquilos/i,
  /^cuando pueda/i,
  /^en alg[uú]n momento/i,
  /^en el futuro/i,
  /^si sobra tiempo/i,
  /^si me da tiempo/i,
  /^no corre prisa/i,
];

export function isVagueNonDeadline(rawText: string): boolean {
  const trimmed = rawText.trim();
  return VAGUE_NON_DEADLINE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Formats a UTC Date instance as YYYY-MM-DD.
 */
export function formatIsoDate(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Parses YYYY-MM-DD into a UTC Date instance.
 */
export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

/**
 * Deterministically resolves common relative and calendar expressions
 * against an explicit currentDate (YYYY-MM-DD) anchor.
 */
export function resolveDateDeterministically(
  raw: string,
  currentDate: string
): { resolvedStart?: string; resolvedEnd?: string; kind?: DeadlineKind } | null {
  if (!isValidIsoDate(currentDate)) {
    return null;
  }

  const norm = raw.trim().toLowerCase();
  const anchor = parseIsoDate(currentDate);

  // 1. "hoy" / "hoy mismo"
  if (norm === "hoy" || norm === "hoy mismo" || norm.startsWith("hoy ")) {
    return {
      resolvedStart: formatIsoDate(anchor),
      kind: "relative_date",
    };
  }

  // 2. "mañana" / "para mañana"
  if (norm === "mañana" || norm === "para mañana" || norm.startsWith("mañana ")) {
    const d = new Date(anchor);
    d.setUTCDate(d.getUTCDate() + 1);
    return {
      resolvedStart: formatIsoDate(d),
      kind: "relative_date",
    };
  }

  // 3. "pasado mañana"
  if (norm === "pasado mañana" || norm === "para pasado mañana") {
    const d = new Date(anchor);
    d.setUTCDate(d.getUTCDate() + 2);
    return {
      resolvedStart: formatIsoDate(d),
      kind: "relative_date",
    };
  }

  // 4. Day of week mapping
  const dayOfWeekMap: Record<string, number> = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miércoles: 3,
    miercoles: 3,
    jueves: 4,
    viernes: 5,
    sábado: 6,
    sabado: 6,
  };

  // "este fin de semana" / "el finde" / "durante este fin de semana"
  if (norm.includes("fin de semana") || norm.includes("finde")) {
    const currentDay = anchor.getUTCDay(); // 0 (Sun) - 6 (Sat)
    const daysUntilSaturday = (6 - currentDay + 7) % 7;
    const sat = new Date(anchor);
    sat.setUTCDate(sat.getUTCDate() + daysUntilSaturday);
    const sun = new Date(sat);
    sun.setUTCDate(sun.getUTCDate() + 1);
    return {
      resolvedStart: formatIsoDate(sat),
      resolvedEnd: formatIsoDate(sun),
      kind: "date_range",
    };
  }

  // Single weekday relative target: "este viernes", "el martes", "el próximo lunes"
  for (const [dayName, targetDayNum] of Object.entries(dayOfWeekMap)) {
    const regex = new RegExp(`(?:el|este|para el|antes del)?\\s*${dayName}\\b`, "i");
    if (regex.test(norm)) {
      const currentDay = anchor.getUTCDay();
      let diff = targetDayNum - currentDay;
      if (diff <= 0) {
        diff += 7; // next occurrence
      }
      const targetDate = new Date(anchor);
      targetDate.setUTCDate(targetDate.getUTCDate() + diff);
      return {
        resolvedStart: formatIsoDate(targetDate),
        kind: "relative_date",
      };
    }
  }

  return null;
}

/**
 * Validates domain invariants for detected deadlines:
 * - All itemIds exist in items.
 * - Non-empty raw string.
 * - Valid ISO dates (if present).
 * - resolvedStart <= resolvedEnd (if both present).
 * - No duplicate deadlines for same item and same raw.
 */
export function validateDeadlinesInvariants(
  result: DetectedDeadlines,
  items: ExtractedItem[]
): DeadlinesValidationResult {
  const errors: string[] = [];
  const validIds = new Set(items.map((i) => i.id));
  const seenKeys = new Set<string>();

  for (let i = 0; i < result.deadlines.length; i++) {
    const d = result.deadlines[i]!;

    if (!validIds.has(d.itemId)) {
      errors.push(`Deadline references unknown/phantom itemId: "${d.itemId}"`);
    }

    if (!d.raw || d.raw.trim() === "") {
      errors.push(`Deadline for item "${d.itemId}" has empty raw expression`);
    }

    if (d.resolvedStart && !isValidIsoDate(d.resolvedStart)) {
      errors.push(
        `Deadline for item "${d.itemId}" has invalid resolvedStart ISO date: "${d.resolvedStart}"`
      );
    }

    if (d.resolvedEnd && !isValidIsoDate(d.resolvedEnd)) {
      errors.push(
        `Deadline for item "${d.itemId}" has invalid resolvedEnd ISO date: "${d.resolvedEnd}"`
      );
    }

    if (d.resolvedStart && d.resolvedEnd) {
      if (isValidIsoDate(d.resolvedStart) && isValidIsoDate(d.resolvedEnd)) {
        if (d.resolvedStart > d.resolvedEnd) {
          errors.push(
            `Deadline for item "${d.itemId}" has resolvedStart ("${d.resolvedStart}") after resolvedEnd ("${d.resolvedEnd}")`
          );
        }
      }
    }

    const key = `${d.itemId}::${d.raw.trim().toLowerCase()}`;
    if (seenKeys.has(key)) {
      errors.push(`Duplicate deadline detected for item "${d.itemId}" and raw "${d.raw}"`);
    }
    seenKeys.add(key);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Deterministically cleans, normalizes, and validates detected deadlines:
 * 1. Drops phantom item IDs.
 * 2. Filters out vague non-deadlines ("cuando pueda", "más adelante", etc.).
 * 3. Normalizes and validates ISO dates (swapping if start > end).
 * 4. Refines relative dates using deterministic calendar logic if missing.
 * 5. Deduplicates identical raw references per item.
 */
export function cleanAndValidateDeadlines(
  rawDeadlines: DetectedDeadline[],
  items: ExtractedItem[],
  currentDate: string
): DetectedDeadlines {
  if (items.length === 0) {
    return { deadlines: [] };
  }

  const validIds = new Set(items.map((i) => i.id));
  const seenKeys = new Set<string>();
  const cleaned: DetectedDeadline[] = [];

  for (const rawDeadline of rawDeadlines) {
    // 1. Must reference an existing item
    if (!validIds.has(rawDeadline.itemId)) {
      continue;
    }

    const raw = rawDeadline.raw?.trim() ?? "";
    if (!raw) {
      continue;
    }

    // 2. Reject vague non-deadlines without concrete dates
    if (isVagueNonDeadline(raw) && !rawDeadline.resolvedStart) {
      continue;
    }

    let resolvedStart = rawDeadline.resolvedStart?.trim() || null;
    let resolvedEnd = rawDeadline.resolvedEnd?.trim() || null;
    let kind = rawDeadline.kind;

    // Validate ISO dates, strip if invalid
    if (resolvedStart && !isValidIsoDate(resolvedStart)) {
      resolvedStart = null;
    }
    if (resolvedEnd && !isValidIsoDate(resolvedEnd)) {
      resolvedEnd = null;
    }

    // Attempt deterministic resolution if missing and anchor is valid
    if (!resolvedStart && !resolvedEnd && isValidIsoDate(currentDate)) {
      const deterministicRes = resolveDateDeterministically(raw, currentDate);
      if (deterministicRes) {
        if (deterministicRes.resolvedStart) resolvedStart = deterministicRes.resolvedStart;
        if (deterministicRes.resolvedEnd) resolvedEnd = deterministicRes.resolvedEnd;
        if (deterministicRes.kind) kind = deterministicRes.kind;
      }
    }

    // Ensure resolvedStart <= resolvedEnd
    if (resolvedStart && resolvedEnd && resolvedStart > resolvedEnd) {
      const temp = resolvedStart;
      resolvedStart = resolvedEnd;
      resolvedEnd = temp;
    }

    // Deduplicate per item + normalized raw string
    const key = `${rawDeadline.itemId}::${raw.toLowerCase()}`;
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);

    cleaned.push({
      itemId: rawDeadline.itemId,
      raw,
      kind,
      resolvedStart: resolvedStart || null,
      resolvedEnd: resolvedEnd || null,
      confidence: rawDeadline.confidence,
    });
  }

  return { deadlines: cleaned };
}
