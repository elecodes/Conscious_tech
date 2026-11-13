/** July 2026 MCP mirrors annotated primitive arguments into Mcp-Param-* headers. */
export function mcpParameterHeaders(schema: unknown, args: Record<string, unknown>) {
  const headers: Record<string, string> = {};
  const seen = new Set<string>();
  const object = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);
  const encode = (value: string) =>
    /[^\x20-\x7e\t]/.test(value) ||
    value.trim() !== value ||
    (value.startsWith("=?base64?") && value.endsWith("?="))
      ? `=?base64?${Buffer.from(value, "utf8").toString("base64")}?=`
      : value;
  function visit(node: unknown, value: unknown, reachable: boolean) {
    if (!object(node)) return;
    if ("x-mcp-header" in node) {
      const name = node["x-mcp-header"];
      const types = Array.isArray(node.type) ? node.type : [node.type];
      if (
        !reachable ||
        typeof name !== "string" ||
        !/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name) ||
        seen.has(name.toLowerCase()) ||
        !types.every((t) => ["string", "integer", "boolean", "null"].includes(String(t)))
      )
        throw new Error("Invalid MCP header schema");
      seen.add(name.toLowerCase());
      if (value !== null && value !== undefined) {
        if (
          !["string", "boolean", "number"].includes(typeof value) ||
          (typeof value === "number" && !Number.isSafeInteger(value))
        )
          throw new Error("Invalid MCP header value");
        headers[`Mcp-Param-${name}`] = encode(String(value));
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === "properties" && object(child))
        for (const [property, definition] of Object.entries(child))
          visit(
            definition,
            object(value) ? value[property] : undefined,
            reachable || node === schema
          );
      else if (Array.isArray(child))
        for (const definition of child) visit(definition, undefined, false);
      else if (object(child)) visit(child, undefined, false);
    }
  }
  visit(schema, args, false);
  // The root itself may not carry an annotation; its properties are reachable.
  return headers;
}
