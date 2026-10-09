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

export interface DeterministicDateResolution {
  resolvedStart?: string | null;
  resolvedEnd?: string | null;
  kind?: DeadlineKind;
  confidence?: "high" | "medium" | "low";
}

const MONTH_NAMES_MAP: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

const DAY_OF_WEEK_MAP: Record<string, number> = {
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

/**
 * Deterministically resolves common relative and calendar expressions
 * against an explicit currentDate (YYYY-MM-DD) anchor.
 */
export function resolveDateDeterministically(
  raw: string,
  currentDate: string
): DeterministicDateResolution | null {
  if (!isValidIsoDate(currentDate)) {
    return null;
  }

  const norm = raw.trim().toLowerCase();
  const anchor = parseIsoDate(currentDate);
  const anchorYear = anchor.getUTCFullYear();
  const anchorMonth = anchor.getUTCMonth(); // 0-indexed

  // 1. "hoy" / "hoy mismo" / "para hoy"
  if (norm === "hoy" || norm === "hoy mismo" || norm === "para hoy" || norm.startsWith("hoy ")) {
    return {
      resolvedStart: formatIsoDate(anchor),
      resolvedEnd: null,
      kind: "relative_date",
      confidence: "high",
    };
  }

  // 2. "mañana" / "para mañana" / "mañana después de..."
  if (norm === "mañana" || norm === "para mañana" || norm.startsWith("mañana ")) {
    const d = new Date(anchor);
    d.setUTCDate(d.getUTCDate() + 1);
    return {
      resolvedStart: formatIsoDate(d),
      resolvedEnd: null,
      kind: "relative_date",
      confidence: "high",
    };
  }

  // 3. "pasado mañana" / "para pasado mañana"
  if (norm === "pasado mañana" || norm === "para pasado mañana") {
    const d = new Date(anchor);
    d.setUTCDate(d.getUTCDate() + 2);
    return {
      resolvedStart: formatIsoDate(d),
      resolvedEnd: null,
      kind: "relative_date",
      confidence: "high",
    };
  }

  // 4. "este fin de semana" / "este finde" / "el finde"
  if (norm.includes("fin de semana") || norm.includes("finde")) {
    const currentDay = anchor.getUTCDay(); // 0 (Sun) - 6 (Sat)
    if (currentDay === 0) {
      // Today is Sunday: current weekend is today
      return {
        resolvedStart: formatIsoDate(anchor),
        resolvedEnd: formatIsoDate(anchor),
        kind: "date_range",
        confidence: "high",
      };
    } else if (currentDay === 6) {
      // Today is Saturday: Saturday to Sunday
      const sun = new Date(anchor);
      sun.setUTCDate(sun.getUTCDate() + 1);
      return {
        resolvedStart: formatIsoDate(anchor),
        resolvedEnd: formatIsoDate(sun),
        kind: "date_range",
        confidence: "high",
      };
    } else {
      // Mon - Fri: upcoming Saturday and Sunday of this week
      const daysUntilSaturday = 6 - currentDay;
      const sat = new Date(anchor);
      sat.setUTCDate(sat.getUTCDate() + daysUntilSaturday);
      const sun = new Date(sat);
      sun.setUTCDate(sun.getUTCDate() + 1);
      return {
        resolvedStart: formatIsoDate(sat),
        resolvedEnd: formatIsoDate(sun),
        kind: "date_range",
        confidence: "high",
      };
    }
  }

  // 5. Explicit date range with month: "del 10 al 12 de noviembre"
  const rangeWithMonthRegex = /^del\s+(\d{1,2})\s+al\s+(\d{1,2})\s+de\s+([a-záéíóú]+)/i;
  const rangeMatch = norm.match(rangeWithMonthRegex);
  if (rangeMatch && rangeMatch[1] && rangeMatch[2] && rangeMatch[3]) {
    const startDay = Number(rangeMatch[1]);
    const endDay = Number(rangeMatch[2]);
    const monthNum = MONTH_NAMES_MAP[rangeMatch[3]];
    if (monthNum) {
      const year = monthNum < anchorMonth + 1 ? anchorYear + 1 : anchorYear;
      const startIso = `${year}-${String(monthNum).padStart(2, "0")}-${String(startDay).padStart(2, "0")}`;
      const endIso = `${year}-${String(monthNum).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;
      if (isValidIsoDate(startIso) && isValidIsoDate(endIso)) {
        return {
          resolvedStart: startIso,
          resolvedEnd: endIso,
          kind: "date_range",
          confidence: "high",
        };
      }
    }
  }

  // 6. Explicit exact date with month: "el 15 de noviembre", "24 de octubre", "el 24 de octubre sin falta"
  const exactWithMonthRegex = /(?:el\s+)?(\d{1,2})\s+de\s+([a-záéíóú]+)/i;
  const exactMatch = norm.match(exactWithMonthRegex);
  if (exactMatch && exactMatch[1] && exactMatch[2]) {
    const day = Number(exactMatch[1]);
    const monthNum = MONTH_NAMES_MAP[exactMatch[2]];
    if (monthNum) {
      const year = monthNum < anchorMonth + 1 ? anchorYear + 1 : anchorYear;
      const iso = `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (isValidIsoDate(iso)) {
        return {
          resolvedStart: iso,
          resolvedEnd: null,
          kind: "exact_date",
          confidence: "high",
        };
      }
    }
  }

  // 7. Month intervals: "este mes", "el mes que viene"
  if (norm === "este mes" || norm.includes("este mes")) {
    const firstDay = `${anchorYear}-${String(anchorMonth + 1).padStart(2, "0")}-01`;
    const lastDayDate = new Date(Date.UTC(anchorYear, anchorMonth + 1, 0));
    return {
      resolvedStart: firstDay,
      resolvedEnd: formatIsoDate(lastDayDate),
      kind: "relative_date",
      confidence: "medium",
    };
  }

  if (norm.includes("mes que viene") || norm.includes("el mes próximo") || norm.includes("mes proximo")) {
    const nextMonthAnchor = new Date(Date.UTC(anchorYear, anchorMonth + 1, 1));
    const nextY = nextMonthAnchor.getUTCFullYear();
    const nextM = nextMonthAnchor.getUTCMonth();
    const firstDay = `${nextY}-${String(nextM + 1).padStart(2, "0")}-01`;
    const lastDayDate = new Date(Date.UTC(nextY, nextM + 1, 0));
    return {
      resolvedStart: firstDay,
      resolvedEnd: formatIsoDate(lastDayDate),
      kind: "relative_date",
      confidence: "medium",
    };
  }

  // 8. "antes del [día número]" without explicit month: "antes del 20"
  const antesDelNumeroRegex = /^antes\s+del\s+(\d{1,2})$/i;
  const antesNumMatch = norm.match(antesDelNumeroRegex);
  if (antesNumMatch && antesNumMatch[1]) {
    const targetDay = Number(antesNumMatch[1]);
    if (targetDay >= 1 && targetDay <= 31) {
      // If target day has already passed in this month, project to next month
      let targetYear = anchorYear;
      let targetMonth = anchorMonth;
      if (targetDay <= anchor.getUTCDate()) {
        targetMonth += 1;
        if (targetMonth > 11) {
          targetMonth = 0;
          targetYear += 1;
        }
      }
      const iso = `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
      if (isValidIsoDate(iso)) {
        return {
          resolvedStart: null,
          resolvedEnd: iso,
          kind: "relative_date",
          confidence: "medium",
        };
      }
    }
  }

  // 9. Weekdays with semantic modifiers
  for (const [dayName, targetDayNum] of Object.entries(DAY_OF_WEEK_MAP)) {
    if (!norm.includes(dayName)) continue;

    const currentDay = anchor.getUTCDay();

    // Pattern A: "el próximo [día]" / "el [día] que viene" / "[día] próximo"
    const isNextWeek =
      norm.includes(`próximo ${dayName}`) ||
      norm.includes(`proximo ${dayName}`) ||
      norm.includes(`${dayName} que viene`) ||
      norm.includes(`${dayName} próximo`) ||
      norm.includes(`${dayName} proximo`);

    if (isNextWeek) {
      let diff = targetDayNum - currentDay;
      if (diff <= 0) {
        diff += 7;
      } else {
        diff += 7; // Specifically next week
      }
      const targetDate = new Date(anchor);
      targetDate.setUTCDate(targetDate.getUTCDate() + diff);
      return {
        resolvedStart: formatIsoDate(targetDate),
        resolvedEnd: null,
        kind: "relative_date",
        confidence: "high",
      };
    }

    // Pattern B: "antes del [día]" / "antes de que venza el [día]"
    const isBeforeDay =
      norm.includes(`antes del ${dayName}`) ||
      norm.includes(`antes de ${dayName}`) ||
      norm.includes(`antes de que venza el ${dayName}`);

    if (isBeforeDay) {
      let diff = targetDayNum - currentDay;
      let conf: "high" | "medium" = "high";
      if (diff <= 0) {
        diff += 7;
        conf = "medium";
      }
      const targetDate = new Date(anchor);
      targetDate.setUTCDate(targetDate.getUTCDate() + diff);
      return {
        resolvedStart: null,
        resolvedEnd: formatIsoDate(targetDate),
        kind: "relative_date",
        confidence: conf,
      };
    }

    // Pattern C: "este [día]"
    const isThisDay = norm.includes(`este ${dayName}`);
    if (isThisDay) {
      let diff = targetDayNum - currentDay;
      let conf: "high" | "medium" = "high";
      if (diff === 0) {
        // Today is this day
        diff = 0;
      } else if (diff < 0) {
        // Already passed in current week: project forward with medium confidence
        diff += 7;
        conf = "medium";
      }
      const targetDate = new Date(anchor);
      targetDate.setUTCDate(targetDate.getUTCDate() + diff);
      return {
        resolvedStart: formatIsoDate(targetDate),
        resolvedEnd: null,
        kind: "relative_date",
        confidence: conf,
      };
    }

    // Pattern D: "el [día]" / "para el [día]" / "[día] por la mañana"
    const isGenericDay = new RegExp(`(?:el|para el)?\\s*${dayName}\\b`, "i").test(norm);
    if (isGenericDay) {
      let diff = targetDayNum - currentDay;
      let conf: "high" | "medium" = "high";
      if (diff === 0) {
        // Today
        diff = 0;
      } else if (diff < 0) {
        // Already passed in current week: in a future plan, it means next occurrence, but medium confidence
        diff += 7;
        conf = "medium";
      }
      const targetDate = new Date(anchor);
      targetDate.setUTCDate(targetDate.getUTCDate() + diff);
      return {
        resolvedStart: formatIsoDate(targetDate),
        resolvedEnd: null,
        kind: "relative_date",
        confidence: conf,
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

    // 2. Reject vague non-deadlines unconditionally
    if (isVagueNonDeadline(raw)) {
      continue;
    }

    let resolvedStart = rawDeadline.resolvedStart?.trim() || null;
    let resolvedEnd = rawDeadline.resolvedEnd?.trim() || null;
    let kind = rawDeadline.kind;
    let confidence = rawDeadline.confidence;

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
        if (deterministicRes.resolvedStart !== undefined) resolvedStart = deterministicRes.resolvedStart;
        if (deterministicRes.resolvedEnd !== undefined) resolvedEnd = deterministicRes.resolvedEnd;
        if (deterministicRes.kind) kind = deterministicRes.kind;
        if (deterministicRes.confidence) confidence = deterministicRes.confidence;
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
      confidence,
    });
  }

  return { deadlines: cleaned };
}
