import {
  ExtractedItem,
  ExtractedItems,
  ItemType,
  ItemStatus,
  CommitmentType,
  DateReference,
  Effort,
} from "../domain/items";

/**
 * Splits freeform text into distinct thought or task segments.
 * Recognizes newlines, bullet points, numbered lists, and sentence terminators.
 */
export function splitNotesIntoSegments(text: string): string[] {
  const lines = text.split(/\r?\n+/);
  const segments: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // Split on sentence boundaries: period, exclamation, question mark, or semicolon
    // followed by whitespace and a letter, digit, inverted mark, or bullet.
    // Avoids splitting on decimal numbers (e.g. 6.5) or mid-word periods.
    const sentenceBoundaryRegex = /(?<=[.!?;\n])\s+(?=[A-ZÁÉÍÓÚÑa-záéíóúñ¿¡0-9\-\*])/g;
    const parts = trimmedLine.split(sentenceBoundaryRegex);

    for (const part of parts) {
      const clean = part
        .trim()
        .replace(/^[-*•]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .trim();
      if (clean) {
        segments.push(clean);
      }
    }
  }

  return segments.length > 0 ? segments : [text.trim()];
}

/**
 * Resolves day of week in Spanish relative to currentDate (YYYY-MM-DD).
 */
export function resolveDayOfWeek(currentDateStr: string, targetDayName: string): string | null {
  const dayMap: Record<string, number> = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    miércoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
    sábado: 6,
  };
  const targetDay = dayMap[targetDayName.toLowerCase()];
  if (targetDay === undefined) return null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(currentDateStr)) return null;
  const [y, m, d] = currentDateStr.split("-").map(Number);
  const cur = new Date(Date.UTC(y!, m! - 1, d!));
  const curDay = cur.getUTCDay();

  let diff = targetDay - curDay;
  if (diff <= 0) {
    diff += 7;
  }
  const resolved = new Date(Date.UTC(y!, m! - 1, d! + diff));
  const ry = resolved.getUTCFullYear();
  const rm = String(resolved.getUTCMonth() + 1).padStart(2, "0");
  const rd = String(resolved.getUTCDate()).padStart(2, "0");
  return `${ry}-${rm}-${rd}`;
}

function addDaysToDate(dateStr: string, days: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! + days));
  const ry = date.getUTCFullYear();
  const rm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const rd = String(date.getUTCDate()).padStart(2, "0");
  return `${ry}-${rm}-${rd}`;
}

/**
 * Extracts date reference or deadline from text snippet.
 */
export function extractDeadline(text: string, currentDate: string): DateReference | undefined {
  // 1. Explicit ISO date (YYYY-MM-DD)
  const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) {
    return {
      raw: isoMatch[1]!,
      resolved: isoMatch[1]!,
      confidence: "high",
    };
  }

  // 2. Relative "antes del [dia]", "para el [dia]", "hasta el [dia]", "el [dia] a las [hora]"
  const dayPattern = /\b(?:antes del|para el|hasta el|el)?\s*(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)(?:\s+a las\s+\d{1,2}(?::\d{2})?)?\b/i;
  const dayMatch = text.match(dayPattern);
  if (dayMatch) {
    const raw = dayMatch[0].trim();
    const dayName = dayMatch[1]!.toLowerCase();
    const resolved = resolveDayOfWeek(currentDate, dayName);
    return {
      raw,
      resolved,
      confidence: "high",
    };
  }

  // 3. "mañana" / "hoy"
  const tomorrowMatch = text.match(/\bmañana(?:\s+a las\s+\d{1,2}(?::\d{2})?)?\b/i);
  if (tomorrowMatch) {
    return {
      raw: tomorrowMatch[0].trim(),
      resolved: addDaysToDate(currentDate, 1),
      confidence: "high",
    };
  }

  const todayMatch = text.match(/\bhoy(?:\s+a las\s+\d{1,2}(?::\d{2})?)?\b/i);
  if (todayMatch) {
    return {
      raw: todayMatch[0].trim(),
      resolved: currentDate,
      confidence: "high",
    };
  }

  // 4. "este finde", "fin de semana"
  const weekendMatch = text.match(/\b(?:este\s+)?(?:finde|fin de semana)\b/i);
  if (weekendMatch) {
    return {
      raw: weekendMatch[0].trim(),
      confidence: "medium",
    };
  }

  return undefined;
}

/**
 * Extracts effort estimation from text snippet.
 */
export function extractEffort(text: string): Effort | undefined {
  const effortRegex = /\(?\b(\d+(?:[.,]\d+)?)\s*(horas?|hs?|h|minutos?|mins?|m|d[ií]as?|d)\b\)?/i;
  const match = text.match(effortRegex);
  if (!match) return undefined;

  const numStr = match[1]!.replace(",", ".");
  const val = parseFloat(numStr);
  if (isNaN(val) || val <= 0) return undefined;

  const rawUnit = match[2]!.toLowerCase();
  let unit: "hours" | "minutes" | "days" = "hours";
  if (/^m(in(uto)?s?)?$/.test(rawUnit)) {
    unit = "minutes";
  } else if (/^d([ií]as?)?$/.test(rawUnit)) {
    unit = "days";
  }

  return {
    value: val,
    unit,
    source: "user",
  };
}

/**
 * Cleans the title by removing leading bullets and parenthesized effort.
 */
export function cleanTitle(rawSegment: string): string {
  let title = rawSegment.trim();
  title = title.replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, "").trim();
  title = title
    .replace(
      /\s*\(\s*\d+(?:[.,]\d+)?\s*(?:horas?|hs?|h|minutos?|mins?|m|d[ií]as?|d)\s*\)/i,
      ""
    )
    .trim();
  title = title.replace(/[.;!?,]+$/, "").trim();

  return title.length > 0 ? title : rawSegment.trim();
}

/**
 * Classifies an item into its semantic domain type.
 */
export function classifyItem(segment: string): {
  type: ItemType;
  status: ItemStatus;
  commitment: CommitmentType;
} {
  const lower = segment.toLowerCase();

  const isMeeting =
    /\b(reuni[oó]n|sync|alineaci[oó]n|llamada|call|meet|1:1|cita|meetup|clase|charla|presentar|demo)\b/i.test(
      lower
    );
  const mentionsExternalStakeholder =
    /\b(equipo|cliente|direcci[oó]n|directorio|inversores|gestor[ií]a|hacienda|jefe|socios?)\b/i.test(
      lower
    );

  if (isMeeting) {
    return {
      type: "commitment",
      status: "pending",
      commitment: mentionsExternalStakeholder ? "external" : "personal",
    };
  }

  if (
    /\b(preocupa|agobia|miedo|estr[eé]s|angustia|duermo\s+mal|cansad[ao])\b/i.test(
      lower
    )
  ) {
    return {
      type: "concern",
      status: "pending",
      commitment: "none",
    };
  }

  if (
    /\b(se\s+me\s+ocurri[oó]|quiz[aá]s?|capaz|estar[ií]a\s+bueno|explorar|investigar|chusmear|pensando\s+si|no\s+s[eé]\s+si|duda)\b/i.test(
      lower
    )
  ) {
    return {
      type: "idea",
      status: "exploring",
      commitment: "none",
    };
  }

  if (
    /\b(proyecto|rediseño|rediseno|migraci[oó]n|refactor(ing)?|lanzar\s+la\s+beta|lanzamiento)\b/i.test(
      lower
    )
  ) {
    return {
      type: "project",
      status: "started",
      commitment: mentionsExternalStakeholder ? "external" : "personal",
    };
  }

  return {
    type: "task",
    status: "pending",
    commitment: mentionsExternalStakeholder ? "external" : "personal",
  };
}

/**
 * Deterministically parses arbitrary user text into ExtractedItems.
 */
export function extractItemsDeterministically(
  text: string,
  currentDate: string
): ExtractedItems {
  const segments = splitNotesIntoSegments(text);

  const items: ExtractedItem[] = segments.map((seg, idx) => {
    const effort = extractEffort(seg);
    const deadline = extractDeadline(seg, currentDate);
    const classification = classifyItem(seg);
    const title = cleanTitle(seg);

    return {
      id: `item-mock-${idx + 1}`,
      rawText: seg,
      title,
      type: classification.type,
      status: classification.status,
      commitment: classification.commitment,
      deadline: deadline ?? null,
      estimatedEffort: effort ?? null,
    };
  });

  return { items };
}
