/** Decode MCP structured output and JSON-wrapped text without evaluating remote content. */
export function notionResultParts(result: Record<string, unknown>) {
  const texts: string[] = [];
  const objects: Record<string, unknown>[] = [];
  let visited = 0;
  function visit(value: unknown, depth: number) {
    if (depth > 7 || ++visited > 500) return;
    if (typeof value === "string") {
      texts.push(value);
      if (/^[\s]*[\[{\"]/.test(value))
        try {
          visit(JSON.parse(value), depth + 1);
        } catch {
          /* Plain Markdown. */
        }
    } else if (Array.isArray(value)) {
      for (const child of value) visit(child, depth + 1);
    } else if (value && typeof value === "object") {
      const object = value as Record<string, unknown>;
      objects.push(object);
      for (const [key, child] of Object.entries(object))
        if (key !== "_meta") visit(child, depth + 1);
    }
  }
  visit(result.structuredContent, 0);
  visit(result.content, 0);
  return { texts, objects };
}
export const notionUuid =
  "[a-fA-F0-9]{8}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{12}";
export function notionLink(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !["www.notion.so", "notion.so", "app.notion.com"].includes(url.hostname) ||
      url.port ||
      url.username ||
      url.password
    )
      return null;
    if (url.hostname === "app.notion.com" && !/^\/p\/[a-fA-F0-9-]+$/.test(url.pathname))
      return null;
    const id = url.pathname.match(new RegExp(`(${notionUuid})$`))?.[1];
    return id ? { id, url: url.href } : null;
  } catch {
    return null;
  }
}
export function databaseReference(result: Record<string, unknown>) {
  const { texts, objects } = notionResultParts(result);
  for (const object of objects) {
    const link = notionLink(object.url);
    const metadata = object.metadata as { type?: unknown } | undefined;
    if (
      link &&
      (object.object === "database" ||
        Array.isArray(object.data_sources) ||
        metadata?.type === "database")
    )
      return link;
  }
  for (const text of texts) {
    const url = text.match(
      /<database\b[^>]*\burl=["'](?:\{\{)?(https:\/\/(?:(?:www\.)?notion\.so\/|app\.notion\.com\/p\/)[^"'\s}]+)/
    )?.[1];
    const link = notionLink(url);
    if (link) return link;
  }
  return null;
}
export function createdDatabase(result: Record<string, unknown>) {
  const reference = databaseReference(result);
  if (!reference) throw new Error("NOTION_DATABASE_RESPONSE");
  const { texts, objects } = notionResultParts(result);
  let source: string | undefined;
  for (const object of objects) {
    if (
      object.object === "database" &&
      object.id &&
      String(object.id).replaceAll("-", "") !== reference.id.replaceAll("-", "")
    )
      continue;
    if (Array.isArray(object.data_sources) && object.data_sources.length === 1) {
      const candidate = object.data_sources[0]?.id;
      if (typeof candidate === "string" && new RegExp(`^${notionUuid}$`).test(candidate))
        source = candidate;
    }
  }
  source ??= texts
    .map(
      (text) =>
        text.match(
          new RegExp(`<data-source\\b[^>]*\\burl=["'](?:\\{\\{)?collection://(${notionUuid})`)
        )?.[1]
    )
    .find(Boolean);
  if (!source) throw new Error("NOTION_DATABASE_RESPONSE");
  return { ...reference, source };
}
