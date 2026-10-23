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
/**
 * Normalizes fused words like "quieroavanzar" -> "quiero avanzar" or "voyahacer" -> "voy a hacer".
 */
export function normalizeFusedWords(text: string): string {
  let res = text;
  // Handle periphrastic fusions: "voyahacer" -> "voy a hacer"
  res = res.replace(/\bvoy\s*a([a-záéíóúñ]+(?:ar|er|ir)\b)/gi, "voy a $1");
  // Handle "tengo que" fused: "tengoquehacer" -> "tengo que hacer"
  res = res.replace(/\btengo\s*que([a-záéíóúñ]+(?:ar|er|ir)\b)/gi, "tengo que $1");
  // Handle modals fused directly with infinitive: "quieroavanzar" -> "quiero avanzar"
  res = res.replace(
    /\b(quiero|puedo|debo|vamos|hayque)([a-záéíóúñ]+(?:ar|er|ir)\b)/gi,
    "$1 $2"
  );
  return res;
}

const NON_VERB_EXCEPTIONS = new Set([
  "lugar", "mujer", "placer", "militar", "titular", "celular", "particular",
  "familiar", "regular", "similar", "popular", "solar", "polar", "bar", "par",
  "mar", "ayer", "primer", "tercer", "dólar", "dolar", "hogar", "radar",
  "collar", "pulgar", "azúcar", "azucar", "líder", "lider", "chofer", "taller",
  "cáncer", "cancer", "carácter", "caracter", "suéter", "sueter", "elixir",
  "mártir", "martir", "solid", "solid.", "solid,", "react", "vue"
]);

const COMMON_ENGLISH_ACTION_VERBS = new Set([
  "do", "look", "make", "get", "prepare", "study", "learn", "review",
  "build", "apply", "send", "call", "write", "finish", "complete", "read",
  "update", "check", "test", "fix", "deploy", "design", "create", "practice",
  "search", "find", "watch", "start", "continue", "organize", "plan", "clean",
  "think", "open", "close", "set", "setup", "configure", "audit", "draft"
]);

export function isActionVerb(word: string): boolean {
  const w = word.toLowerCase().trim();
  if (NON_VERB_EXCEPTIONS.has(w)) return false;
  if (COMMON_ENGLISH_ACTION_VERBS.has(w)) return true;
  if (w === "ir" || w === "ver" || w === "dar" || w === "do") return true;
  if (w.length < 3) return false;

  // Infinitive endings (including clitic pronouns attached)
  const infinitiveRegex =
    /^[a-záéíóúñ]+(?:ar|er|ir|arlo|arla|arlos|arlas|arme|arte|arse|arnos|erlo|erla|erlos|erlas|erme|erte|erse|ernos|irlo|irla|irlos|irlas|irme|irte|irse|irnos|ír)\b/i;
  return infinitiveRegex.test(w);
}

export function stripLeadingParticles(text: string): string {
  return text
    .trim()
    .replace(/^[,\s;]+/, "")
    .replace(
      /^(?:para\s+esta\s+semana\s+|esta\s+semana\s+|tambi[eé]n\s+|adem[aá]s\s+|luego\s+|despu[eé]s\s+|finalmente\s+|also\s+|then\s+|later\s+|finally\s+)+/i,
      ""
    )
    .replace(
      /^(?:tengo\s+que\s+|quiero\s+|necesito\s+|hay\s+que\s+|debo\s+|deber[ií]a\s+|voy\s+a\s+|vamos\s+a\s+|quisiera\s+|me\s+gustar[ií]a\s+|pensando\s+en\s+|tratar\s+de\s+|i\s+want\s+to\s+|i\s+need\s+to\s+|i\s+have\s+to\s+|need\s+to\s+|want\s+to\s+)+/i,
      ""
    )
    .trim();
}

export function startsWithActionVerb(clause: string): boolean {
  const stripped = stripLeadingParticles(clause);
  const match = stripped.match(/^([a-záéíóúñ]+)/i);
  if (!match) return false;
  return isActionVerb(match[1]!);
}

function splitTopLevelCoordinated(text: string): string[] {
  const parts: string[] = [];
  let current = "";
  let parenDepth = 0;
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    if (char === "(" || char === "[" || char === "{") {
      parenDepth++;
      current += char;
      i++;
    } else if (char === ")" || char === "]" || char === "}") {
      if (parenDepth > 0) parenDepth--;
      current += char;
      i++;
    } else if (parenDepth === 0) {
      const slice = text.slice(i);
      const delimMatch = slice.match(
        /^(?:,\s*(?:y|e|además de|ademas de|and)\s+|;\s*|,(?!\d)\s+|\s+(?:y|e|además de|ademas de|and)\s+)/i
      );
      if (delimMatch) {
        if (current.trim()) {
          parts.push(current.trim());
        }
        current = "";
        i += delimMatch[0].length;
      } else {
        current += char;
        i++;
      }
    } else {
      current += char;
      i++;
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function isEffortClause(text: string): boolean {
  const trimmed = text.trim();
  const effortIntroRegex =
    /^(?:(?:que\s+)?me\s+(?:llevar[aá]|tomar[aá]|lleva|toma|costar[aá]|exigir[aá])|unas?|alrededor\s+de|aprox(?:imadamente)?(?:\.)?|c[aá]lculo|it\s+will\s+take|approx(?:\.)?|about)(?:\s+|$)/i;
  if (effortIntroRegex.test(trimmed)) {
    return true;
  }
  const bareEffortRegex =
    /^\(?\s*\d+(?:[.,]\d+)?\s*(?:horas?|hs?|h|minutos?|mins?|m|d[ií]as?|d|hours?|hrs?|minutes?|days?)\s*\)?$/i;
  return bareEffortRegex.test(trimmed);
}

export function splitCoordinatedActions(segment: string): string[] {
  const normalized = normalizeFusedWords(segment);

  // Guard against splitting emotional or concern expressions into fragmented items
  // (e.g. "Me preocupa no llegar a tiempo con la entrega, siento mucho estrés").
  if (
    /\b(preocupa|agobia|miedo|estr[eé]s|angustia|duermo\s+mal|cansad[ao])\b/i.test(
      normalized
    )
  ) {
    return [normalized];
  }

  const rawParts = splitTopLevelCoordinated(normalized);
  if (rawParts.length <= 1) {
    return [normalized];
  }

  // Merge trailing effort/duration clauses back into the preceding part
  // e.g. ["Tengo que preparar la presentación para el cliente el jueves", "me llevará 2 horas"]
  const parts: string[] = [];
  for (const part of rawParts) {
    if (parts.length > 0 && isEffortClause(part)) {
      parts[parts.length - 1] = `${parts[parts.length - 1]}, ${part}`;
    } else {
      parts.push(part);
    }
  }

  if (parts.length <= 1) {
    return [normalized];
  }

  const token0IsAction = startsWithActionVerb(parts[0]!);

  // Guard against splitting single-verb object enumerations (e.g. "Comprar manzanas, peras y plátanos"
  // or "Hablar con Juan, María y Pedro"):
  // Token 0 starts with a verb, and ALL subsequent parts are simple 1-2 word noun tokens without action verbs.
  const isSingleVerbObjectEnumeration =
    token0IsAction &&
    parts.slice(1).every((p) => {
      const words = p.trim().split(/\s+/);
      return words.length <= 2 && !startsWithActionVerb(p);
    });

  if (isSingleVerbObjectEnumeration) {
    return [normalized];
  }

  return parts;
}

/**
 * Splits freeform text into distinct thought or task segments.
 * Recognizes newlines, bullet points, numbered lists, sentence terminators,
 * and coordinated action clauses.
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
        const subSegments = splitCoordinatedActions(clean);
        for (const sub of subSegments) {
          segments.push(sub);
        }
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
      /\s*\(\s*\d+(?:[.,]\d+)?\s*(?:horas?|hs?|h|minutos?|mins?|m|d[ií]as?|d|hours?|hrs?|minutes?|days?)\s*\)/i,
      ""
    )
    .trim();
  title = title
    .replace(
      /,\s*(?:(?:que\s+)?me\s+(?:llevar[aá]|tomar[aá]|lleva|toma|costar[aá]|exigir[aá])|unas?|alrededor\s+de|aprox(?:imadamente)?(?:\.)?|c[aá]lculo|it\s+will\s+take|approx(?:\.)?|about)?\s*\d+(?:[.,]\d+)?\s*(?:horas?|hs?|h|minutos?|mins?|m|d[ií]as?|d|hours?|hrs?|minutes?|days?)\s*$/i,
      ""
    )
    .trim();
  title = title.replace(/[.;!?,]+$/, "").trim();

  const stripped = stripLeadingParticles(title);
  if (stripped.length > 0 && startsWithActionVerb(title)) {
    title = stripped;
  }

  if (title.length > 0) {
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }

  return title.length > 0 ? title : rawSegment.trim();
}

/**
 * Extracts a project reference if present in the text segment.
 */
export function extractProject(text: string): string | null {
  const tagMatch = text.match(/(?:#|\[)([a-zA-ZáéíóúñÁÉÍÓÚÑ0-9_-]+)\]?/);
  if (tagMatch && tagMatch[1]) {
    return tagMatch[1];
  }

  if (/Tecnolog[ií]a\s+Consciente/i.test(text)) {
    return "Tecnología Consciente";
  }
  if (/ArchitectAI/i.test(text)) {
    return "ArchitectAI";
  }
  if (/Conscious\s*Tech/i.test(text)) {
    return "Conscious Tech";
  }

  const projectPattern =
    /\bproyecto\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñA-Z0-9_-]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñA-Z0-9_-]+)?)/i;
  const projectMatch = text.match(projectPattern);
  if (projectMatch && projectMatch[1]) {
    return projectMatch[1].trim();
  }

  return null;
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
    /\b(se\s+me\s+(?:ha\s+)?ocurri(?:[oó]|d[ao])|quiz[aá]s?|capaz|estar[ií]a\s+bueno|explorar|investigar|chusmear|pensando\s+si|no\s+s[eé]\s+si|duda|podcast|think|explore|research)\b/i.test(
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
    const project = extractProject(seg);

    return {
      id: `item-mock-${idx + 1}`,
      rawText: seg,
      title,
      project,
      type: classification.type,
      status: classification.status,
      commitment: classification.commitment,
      deadline: deadline ?? null,
      estimatedEffort: effort ?? null,
    };
  });

  return { items };
}
