import type { NotionSnapshot } from "../../application/notion-snapshot";
import { NotionRemoteError, type NotionSession } from "./mcp-client";
import { mcpParameterHeaders } from "./parameter-headers";
import { notionResultParts, notionLink } from "./result-parser";
import { notionSnapshotHash } from "./send-calendar";

type Call = (
  name: string,
  args: Record<string, unknown>,
  schema?: unknown
) => Promise<Record<string, unknown>>;
/** This diagnostic can list/search/fetch only. It never invokes a creation tool or clears a guard. */
export async function checkNotionDelivery(
  snapshot: NotionSnapshot,
  session: NotionSession,
  list: () => Promise<Record<string, unknown>>,
  call: Call
) {
  const job = session.exports[notionSnapshotHash(snapshot)];
  const catalog = await list();
  const tools = Array.isArray(catalog.tools)
    ? (catalog.tools as { name: string; inputSchema?: unknown }[])
    : [];
  const candidates: { url: string; title: string }[] = [];
  let code = job?.code ?? (job ? "NOTION_LEGACY_INCOMPLETE" : "NOTION_NO_SAVED_DELIVERY");
  let message =
    "La versión anterior no guardó la causa del fallo. Esta comprobación no crea ni repite el envío.";
  if (job?.url) {
    const tool = tools.find((tool) => tool.name === "notion-fetch");
    if (tool) {
      mcpParameterHeaders(tool.inputSchema, {});
      try {
        await call(tool.name, { id: job.url }, tool.inputSchema);
        candidates.push({ url: job.url, title: snapshot.title });
        message =
          "La copia guardada sigue accesible. Ábrela para revisar qué llegó a crearse; no se han enviado tareas nuevas.";
      } catch (error) {
        code = error instanceof NotionRemoteError ? error.code : "NOTION_CHECK_FAILED";
        message =
          "No se ha podido comprobar el acceso a la copia guardada. No se ha repetido el envío.";
      }
    }
  } else {
    const search =
      tools.find((tool) => ["notion-search", "search"].includes(tool.name)) ??
      tools.find((tool) => tool.name === "notion-ai-search");
    if (!search) {
      message =
        "Esta conexión no ofrece búsqueda para localizar la copia. No se ha repetido el envío.";
      code = "NOTION_SEARCH_UNAVAILABLE";
    } else {
      try {
        mcpParameterHeaders(search.inputSchema, {});
        const result = await call(search.name, { query: snapshot.title }, search.inputSchema);
        const { objects } = notionResultParts(result);
        const seen = new Set<string>();
        for (const object of objects) {
          const link = notionLink(object.url);
          if (object.title === snapshot.title && link && !seen.has(link.id.replaceAll("-", ""))) {
            seen.add(link.id.replaceAll("-", ""));
            candidates.push({ url: link.url, title: snapshot.title });
          }
          if (candidates.length === 5) break;
        }
        message = candidates.length
          ? "Se han encontrado posibles copias con el mismo título. Revísalas antes de crear otra; su presencia no confirma que el envío esté completo."
          : "La búsqueda no ha encontrado una copia identificable de esta semana. Esto no demuestra que no exista: Notion puede tardar en mostrarla. No se ha repetido el envío.";
      } catch (error) {
        code = error instanceof NotionRemoteError ? error.code : "NOTION_CHECK_FAILED";
        message = "No se ha podido buscar la copia en Notion. No se ha repetido el envío.";
      }
    }
  }
  return { code, stage: job?.stage, sent: job?.sent ?? 0, message, candidates };
}
