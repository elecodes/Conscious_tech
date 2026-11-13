import type { NotionSnapshot } from "../../application/notion-snapshot";
import { NotionRemoteError, type NotionSession } from "./mcp-client";
import { notionLink, createdDatabase, notionResultParts, notionUuid } from "./result-parser";
import { notionSnapshotHash, populateNotionCalendar } from "./send-calendar";

type Call = (
  name: string,
  args: Record<string, unknown>,
  schema?: unknown
) => Promise<Record<string, unknown>>;
export class NotionRecoveryError extends Error {
  readonly code = "NOTION_RECOVERY_NOT_VERIFIED";
}
const requiredSchema: Record<string, string> = {
  Nombre: "title",
  Fecha: "date",
  Estado: "text",
  "Horas asignadas": "number",
  "Horas sin asignar": "number",
  Tipo: "text",
  Semana: "text",
  "Fecha límite": "date",
  Horario: "text",
  "ID de tarea": "text",
};
/** Only fills a verified empty, unfiltered original table after explicit user confirmation. */
export async function recoverNotionCalendar(
  snapshot: NotionSnapshot,
  url: string,
  session: NotionSession,
  list: () => Promise<Record<string, unknown>>,
  callRemote: Call,
  save: () => Promise<void>
) {
  const link = notionLink(url);
  if (!link) throw new NotionRecoveryError("El enlace de la copia no es válido.");
  const hash = notionSnapshotHash(snapshot);
  const previous = session.exports[hash];
  if (previous?.status === "complete" || previous?.recoveryAttempted) return previous;
  if (
    previous?.url &&
    notionLink(previous.url)?.id.replaceAll("-", "") !== link.id.replaceAll("-", "")
  )
    throw new NotionRecoveryError("Selecciona la copia que corresponde al envío guardado.");
  const catalog = await list();
  const tools = Array.isArray(catalog.tools)
    ? (catalog.tools as { name: string; inputSchema?: unknown }[])
    : [];
  const query = tools.find((tool) =>
    ["notion-query-data-sources", "query-data-sources", "query_data_sources"].includes(tool.name)
  );
  if (
    !query ||
    !["notion-fetch", "notion-create-view", "notion-create-pages"].every((name) =>
      tools.some((tool) => tool.name === name)
    )
  )
    throw new NotionRecoveryError(
      "Esta conexión no permite comprobar que la copia está vacía. No se ha modificado nada."
    );
  const call = (name: string, args: Record<string, unknown>) =>
    callRemote(name, args, tools.find((tool) => tool.name === name)?.inputSchema);
  const fetched = await call("notion-fetch", { id: link.url });
  const db = createdDatabase(fetched);
  if (db.id.replaceAll("-", "") !== link.id.replaceAll("-", ""))
    throw new NotionRecoveryError("No se ha podido verificar la base seleccionada.");
  const texts = notionResultParts(fetched).texts;
  let state: Record<string, unknown> | undefined;
  const views: { url: string; config: Record<string, unknown> }[] = [];
  for (const text of texts) {
    const stateText = text.match(/<data-source-state>\s*([\s\S]*?)\s*<\/data-source-state>/)?.[1];
    if (stateText)
      try {
        const candidate = JSON.parse(stateText);
        if (candidate.url === `collection://${db.source}`) state = candidate;
      } catch {
        /* No writes on an unverifiable schema. */
      }
    const pattern = new RegExp(
      `<view\\b[^>]*url=["'](?:\\{\\{)?(view://${notionUuid})(?:\\}\\})?["'][^>]*>\\s*([\\s\\S]*?)\\s*</view>`,
      "g"
    );
    // Avoid duplicates caused by JSON-wrapped copies of the same document.
    for (const match of text.matchAll(pattern))
      try {
        if (!views.some((view) => view.url === match[1]))
          views.push({ url: match[1]!, config: JSON.parse(match[2]!) });
      } catch {
        /* Stop below if no valid view is found. */
      }
  }
  const schema = state?.schema as Record<string, { type?: unknown }> | undefined;
  if (
    state?.name !== snapshot.title ||
    !schema ||
    !Object.entries(requiredSchema).every(([name, type]) => schema[name]?.type === type)
  )
    throw new NotionRecoveryError(
      "La base no coincide con la semana o con el formato de tareas esperado. No se ha modificado nada."
    );
  const view = views[0];
  if (
    views.length !== 1 ||
    !view ||
    view.config.type !== "table" ||
    "filter" in view.config ||
    "filters" in view.config ||
    String(view.config.dataSourceUrl).replaceAll("{{", "").replaceAll("}}", "") !==
      `collection://${db.source}`
  )
    throw new NotionRecoveryError(
      "La copia ya tiene vistas o filtros que requieren revisión manual. No se ha modificado nada."
    );
  for (const is_archived of [false, true]) {
    const result = await call(query.name, {
      data: { mode: "view", view_url: view.url, page_size: 1, is_archived },
    });
    const rows = notionResultParts(result).objects.find(
      (object) => Array.isArray(object.results) && typeof object.has_more === "boolean"
    );
    if (!rows || (rows.results as unknown[]).length || rows.has_more)
      throw new NotionRecoveryError(
        "La copia contiene tareas o no se ha podido confirmar que esté vacía. No se ha modificado nada."
      );
  }
  await call("notion-fetch", { id: "notion://docs/view-dsl-spec" });
  const job: NotionSession["exports"][string] = {
    status: "sending",
    sent: 0,
    url: db.url,
    stage: "create_calendar",
    recoveryAttempted: true,
  };
  session.exports[hash] = job;
  await save();
  try {
    await populateNotionCalendar(snapshot, job, call, save, db);
  } catch (error) {
    job.status = "uncertain";
    job.code = error instanceof NotionRemoteError ? error.code : "NOTION_DELIVERY_INTERRUPTED";
    await save();
  }
  return job;
}
