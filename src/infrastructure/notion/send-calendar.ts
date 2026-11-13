import { databaseReference, createdDatabase, notionUuid } from "./result-parser";
import { NotionRemoteError } from "./mcp-client";
import { mcpParameterHeaders } from "./parameter-headers";
import { createHash } from "node:crypto";
import {
  NOTION_CALENDAR_SCHEMA,
  notionPageProperties,
  type NotionSnapshot,
} from "../../application/notion-snapshot";
import type { NotionSession } from "./mcp-client";

export class NotionCalendarUnavailableError extends Error {
  readonly code = "NOTION_CALENDAR_TOOLS_UNAVAILABLE";
  constructor() {
    super(
      "La cuenta está conectada, pero Notion no ofrece en esta conexión las herramientas necesarias para crear el calendario. No se ha iniciado la creación."
    );
  }
}
const requiredTools = [
  "notion-create-database",
  "notion-create-pages",
  "notion-create-view",
  "notion-fetch",
] as const;
type CallTool = (
  name: string,
  args: Record<string, unknown>,
  schema?: unknown
) => Promise<Record<string, unknown>>;
const uuid = notionUuid;
function toolText(result: Record<string, unknown>) {
  const blocks = result.content;
  return Array.isArray(blocks)
    ? blocks
        .filter((b) => b.type === "text")
        .map((b) => String(b.text))
        .join("\n")
    : "";
}
export { createdDatabase } from "./result-parser";
export const notionSnapshotHash = (snapshot: NotionSnapshot) =>
  createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
function calendarLink(result: Record<string, unknown>, databaseUrl: string) {
  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = JSON.parse(toolText(result));
  } catch {
    /* Markdown result: keep the verified database link. */
  }
  const structured = result.structuredContent ?? parsed;
  if (!structured || typeof structured !== "object") return databaseUrl;
  const record = structured as Record<string, unknown>;
  const view =
    record.view && typeof record.view === "object"
      ? (record.view as Record<string, unknown>)
      : record;
  const id = view.view_id ?? view.id;
  if (typeof id !== "string" || !new RegExp(`^${uuid}$`).test(id)) return databaseUrl;
  const url = new URL(databaseUrl);
  url.searchParams.set("v", id.replaceAll("-", ""));
  return url.href;
}
/** Never retries ambiguous writes. Persist markers before every remote mutation. */
export async function sendNotionCalendar(
  snapshot: NotionSnapshot,
  session: NotionSession,
  callRemote: CallTool,
  list: () => Promise<Record<string, unknown>>,
  save: () => Promise<void>
) {
  const hash = notionSnapshotHash(snapshot);
  const existing = session.exports[hash];
  if (existing) return existing;
  if (Object.keys(session.exports).length >= 100) throw new Error("Notion export limit reached");
  const tools = await list();
  const names = new Set(Array.isArray(tools.tools) ? tools.tools.map((t) => t.name) : []);
  for (const name of requiredTools)
    if (!names.has(name)) throw new NotionCalendarUnavailableError();
  const schemas = new Map<string, unknown>(
    Array.isArray(tools.tools) ? tools.tools.map((t) => [t.name, t.inputSchema]) : []
  );
  for (const name of requiredTools) mcpParameterHeaders(schemas.get(name), {});
  const call = (name: string, args: Record<string, unknown>) =>
    callRemote(name, args, schemas.get(name));
  // Read the server's view syntax before using it, and never evaluate remote instructions.
  await call("notion-fetch", { id: "notion://docs/view-dsl-spec" });
  const job: NotionSession["exports"][string] = {
    status: "sending",
    sent: 0,
    stage: "create_database",
  };
  session.exports[hash] = job;
  await save();
  try {
    const result = await call("notion-create-database", {
      title: snapshot.title,
      schema: NOTION_CALENDAR_SCHEMA,
    });
    job.stage = "read_database_response";
    const reference = databaseReference(result);
    if (!reference) throw new Error("NOTION_DATABASE_RESPONSE");
    job.url = reference.url;
    await save();
    job.stage = "fetch_database";
    await save();
    const fetched = await call("notion-fetch", { id: reference.url });
    job.stage = "read_database_response";
    await save();
    const db = createdDatabase(fetched);
    if (db.id.replaceAll("-", "") !== reference.id.replaceAll("-", ""))
      throw new Error("NOTION_DATABASE_RESPONSE");
    await populateNotionCalendar(snapshot, job, call, save, db);
  } catch (error) {
    job.status = "uncertain";
    job.code =
      error instanceof NotionRemoteError
        ? error.code
        : job.stage === "read_database_response"
          ? "NOTION_DATABASE_RESPONSE"
          : "NOTION_DELIVERY_INTERRUPTED";
    await save();
  }
  return job;
}

export async function populateNotionCalendar(
  snapshot: NotionSnapshot,
  job: NotionSession["exports"][string],
  call: CallTool,
  save: () => Promise<void>,
  db: { id: string; source: string; url: string }
) {
  job.stage = "create_calendar";
  await save();
  const view = await call("notion-create-view", {
    database_id: db.id,
    data_source_id: db.source,
    name: "Calendario",
    type: "calendar",
    configure: 'CALENDAR BY "Fecha"',
  });
  job.url = calendarLink(view, db.url);
  await save();
  job.stage = "create_tasks";
  for (let start = 0; start < snapshot.rows.length; start += 10) {
    await save();
    const result = await call("notion-create-pages", {
      parent: { data_source_id: db.source },
      allow_async: false,
      pages: snapshot.rows
        .slice(start, start + 10)
        .map((row) => ({ properties: notionPageProperties(row) })),
    });
    if (result.async_task || /"async_task"\s*:/.test(toolText(result)))
      throw new Error("Unexpected async Notion result");
    job.sent += Math.min(10, snapshot.rows.length - start);
    await save();
  }
  job.status = "complete";
  delete job.stage;
  delete job.code;
  await save();
}
