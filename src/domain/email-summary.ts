export interface EmailSummaryItem {
  title: string;
  day?: string;
  startTime?: string;
  source?: string;
  isCompleted?: boolean;
}

export interface EmailSummaryReflections {
  notes?: string;
  learned?: string[];
}

export interface EmailSummaryInput {
  targetWeek: {
    startDate: string;
    endDate: string;
  };
  items: EmailSummaryItem[];
  reflections?: EmailSummaryReflections;
}

export interface EmailSummaryResult {
  subject: string;
  fullBody: string;
  truncatedBody: string;
  gmailUrl: string;
  mailtoUrl: string;
  isTruncated: boolean;
}

const MAX_URL_BODY_LENGTH = 1500;
const TRUNCATION_INDICATOR = "\n\n… (ver el resto en la app)";

/**
 * Builds deterministic plain-text email summary and URLs for Gmail compose and mailto.
 *
 * Privacy Invariants:
 * - The recipient is completely empty (no `to=` query parameter).
 * - No internal IDs, database UUIDs, or JSON payloads are included in the text.
 * - Text is capped at ~1,500 characters to prevent link breakages in email clients.
 */
export function buildEmailSummary(input: EmailSummaryInput): EmailSummaryResult {
  const { targetWeek, items, reflections } = input;
  const subject = `Mi semana · ${targetWeek.startDate} al ${targetWeek.endDate}`;

  const lines: string[] = [];
  lines.push(`Mi semana (${targetWeek.startDate} al ${targetWeek.endDate})`);
  lines.push("");

  if (items.length > 0) {
    lines.push("Prioridades y compromisos:");
    for (const item of items) {
      const timePart = item.day
        ? item.startTime
          ? ` (${item.day} ${item.startTime})`
          : ` (${item.day})`
        : "";
      const sourcePart = item.source ? ` [${item.source}]` : "";
      lines.push(`• ${item.title}${timePart}${sourcePart}`);
    }
  } else {
    lines.push("Sin compromisos ni tareas programadas.");
  }

  if (reflections) {
    const hasLearned = reflections.learned && reflections.learned.length > 0;
    const hasNotes = Boolean(reflections.notes && reflections.notes.trim().length > 0);

    if (hasLearned || hasNotes) {
      lines.push("");
      lines.push("Lo que he aprendido:");
      if (hasLearned) {
        for (const learning of reflections.learned!) {
          lines.push(`• ${learning}`);
        }
      }
      if (hasNotes) {
        lines.push(`Reflexión personal: ${reflections.notes!.trim()}`);
      }
    }
  }

  lines.push("");
  lines.push("— Generado desde tu cuaderno local con Conscious Tech");

  const fullBody = lines.join("\n");

  let truncatedBody = fullBody;
  let isTruncated = false;

  if (fullBody.length > MAX_URL_BODY_LENGTH) {
    isTruncated = true;
    const allowedChars = MAX_URL_BODY_LENGTH - TRUNCATION_INDICATOR.length;
    // Slice and trim at end
    truncatedBody = fullBody.slice(0, Math.max(0, allowedChars)).trimEnd() + TRUNCATION_INDICATOR;
  }

  // Gmail compose link (no recipient: the user inputs their own destination)
  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(truncatedBody)}`;

  // Default mailto link (no recipient)
  const mailtoUrl = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
    truncatedBody
  )}`;

  return {
    subject,
    fullBody,
    truncatedBody,
    gmailUrl,
    mailtoUrl,
    isTruncated,
  };
}
