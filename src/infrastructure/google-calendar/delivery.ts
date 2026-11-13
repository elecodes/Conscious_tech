import { createHash, createHmac } from "node:crypto";
import {
  googleCalendarRows,
  type GoogleCalendarExport,
  type GoogleEventBody,
} from "../../application/google-calendar-export";
import { GoogleCalendarClient, GoogleCalendarError } from "./client";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function eventFields(event: Record<string, unknown>) {
  const time = (field: unknown) => {
    const data = field as Record<string, unknown> | undefined;
    if (data?.date) return { date: data.date };
    if (data?.dateTime) {
      const zone =
        (event.extendedProperties as { private?: Record<string, string> } | undefined)?.private
          ?.ctZone ?? data.timeZone;
      const raw = String(data.dateTime);
      let wall = raw.slice(0, 19);
      if (zone && /(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) {
        const parts = new Intl.DateTimeFormat("sv-SE", {
          timeZone: String(zone),
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
        }).formatToParts(new Date(raw));
        const value = (type: string) => parts.find((part) => part.type === type)!.value;
        wall = `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}:${value("second")}`;
      }
      return { dateTime: wall, timeZone: zone };
    }
    return null;
  };
  return {
    summary: event.summary ?? "",
    description: event.description ?? "",
    start: time(event.start),
    end: time(event.end),
    transparency: event.transparency ?? "opaque",
  };
}
export const googleEventHash = (event: Record<string, unknown>) => hash(eventFields(event));
export async function previewGoogleDelivery(
  input: GoogleCalendarExport,
  installation: string,
  client: GoogleCalendarClient,
  token: string
) {
  await client.assertOwner(token, input.calendarId);
  const scope = createHmac("sha256", installation)
    .update(input.notebookId + "\n" + input.calendarId + "\n" + input.planId)
    .digest("hex");
  const desired = googleCalendarRows(input).map((row) => {
    const id =
      "ct" +
      createHmac("sha256", installation)
        .update(scope + "\n" + row.key)
        .digest("hex");
    const body: GoogleEventBody = row.body;
    body.extendedProperties.private = {
      ...(body.start.dateTime ? { ctZone: input.timeZone } : {}),
      ctSource: "conscious-tech",
      ctPlan: scope,
      ctHash: googleEventHash(body),
    };
    return { id, body };
  });
  const current = await client.events(token, input.calendarId, scope);
  const remoteHash = hash(
    current
      .map((event) => [event.id, event.etag, event.status])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  );
  const expected = new Map(desired.map((event) => [event.id, event]));
  const existing = new Map(current.map((event) => [event.id, event]));
  const conflicts: string[] = [];
  for (const event of current) {
    const privateFields = (
      event.extendedProperties as { private?: Record<string, string> } | undefined
    )?.private;
    if (event.status === "cancelled" && !expected.has(event.id)) continue;
    if (
      event.status === "cancelled" ||
      !event.etag ||
      privateFields?.ctSource !== "conscious-tech" ||
      privateFields.ctPlan !== scope ||
      privateFields.ctHash !== googleEventHash(event) ||
      event.recurrence ||
      event.location ||
      event.colorId ||
      event.conferenceData ||
      (Array.isArray(event.attachments) && event.attachments.length) ||
      (event.reminders as { useDefault?: boolean } | undefined)?.useDefault === false ||
      (event.visibility && event.visibility !== "default") ||
      (Array.isArray(event.attendees) && event.attendees.length)
    )
      conflicts.push(event.id);
  }
  const creates = desired.filter((event) => !existing.has(event.id));
  const updates = desired.filter(
    (event) =>
      existing.has(event.id) &&
      googleEventHash(existing.get(event.id)!) !== googleEventHash(event.body)
  );
  const removes = current.filter(
    (event) => event.status !== "cancelled" && !expected.has(event.id)
  );
  return {
    scope,
    desired,
    current,
    remoteHash,
    creates,
    updates,
    removes,
    conflicts,
    hash: hash(input),
    undated: input.snapshot.rows.filter((row) => !row.date).length,
  };
}
export type GoogleDeliveryPreview = Awaited<ReturnType<typeof previewGoogleDelivery>>;
export function googlePreviewCounts(preview: GoogleDeliveryPreview) {
  return {
    create: preview.creates.length,
    update: preview.updates.length,
    remove: preview.removes.length,
    unchanged: preview.desired.length - preview.creates.length - preview.updates.length,
    undated: preview.undated,
    conflicts: preview.conflicts.length,
  };
}
export async function sendGoogleDelivery(
  input: GoogleCalendarExport,
  preview: GoogleDeliveryPreview,
  client: GoogleCalendarClient,
  token: string
) {
  if (preview.conflicts.length) throw new GoogleCalendarError(409, "GOOGLE_MANUAL_CHANGES");
  const base = `calendars/${encodeURIComponent(input.calendarId)}/events`;
  for (const event of preview.creates) {
    try {
      await client.api(token, base + "?sendUpdates=none", "POST", { id: event.id, ...event.body });
    } catch (error) {
      if (!(error instanceof GoogleCalendarError) || error.status !== 409) throw error;
      const existing = await client.api(token, base + "/" + event.id);
      if (
        existing?.extendedProperties?.private?.ctPlan !== preview.scope ||
        googleEventHash(existing) !== googleEventHash(event.body)
      )
        throw new GoogleCalendarError(409, "GOOGLE_EVENT_COLLISION");
    }
  }
  for (const event of preview.updates) {
    const previous = preview.current.find((row) => row.id === event.id)!;
    await client.api(
      token,
      base + "/" + event.id + "?sendUpdates=none",
      "PATCH",
      event.body,
      previous.etag
    );
  }
  for (const event of preview.removes)
    await client.api(
      token,
      base + "/" + event.id + "?sendUpdates=none",
      "DELETE",
      undefined,
      event.etag
    );
  const actual = await client.events(token, input.calendarId, preview.scope);
  const active = actual.filter((event) => event.status !== "cancelled");
  if (
    active.length !== preview.desired.length ||
    !preview.desired.every((event) =>
      active.some(
        (saved) => saved.id === event.id && googleEventHash(saved) === googleEventHash(event.body)
      )
    )
  )
    throw new GoogleCalendarError(502, "GOOGLE_DELIVERY_NOT_VERIFIED");
  const candidate = active.find((event) => event.id === preview.desired[0]?.id)?.htmlLink;
  let openUrl = "https://calendar.google.com/";
  if (typeof candidate === "string")
    try {
      const link = new URL(candidate);
      if (
        link.protocol === "https:" &&
        !link.username &&
        !link.password &&
        !link.port &&
        (link.hostname === "calendar.google.com" ||
          (link.hostname === "www.google.com" && link.pathname.startsWith("/calendar/")))
      )
        openUrl = link.href;
    } catch {
      /* Keep the safe Calendar home URL. */
    }
  return {
    verified: active.length,
    ...googlePreviewCounts(preview),
    url: openUrl,
  };
}
