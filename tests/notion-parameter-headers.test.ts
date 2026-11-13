import { describe, expect, it } from "vitest";
import { mcpParameterHeaders } from "../src/infrastructure/notion/parameter-headers";
describe("Notion MCP July parameter headers", () => {
  it("mirrors annotated nested primitives with safe encoding and omits missing/null values", () => {
    const schema = {
      type: "object",
      properties: {
        id: { type: "string", "x-mcp-header": "Page" },
        parent: {
          type: "object",
          properties: {
            active: { type: "boolean", "x-mcp-header": "Active" },
            count: { type: ["integer", "null"], "x-mcp-header": "Count" },
          },
        },
      },
    };
    expect(
      mcpParameterHeaders(schema, { id: "lógica\n", parent: { active: false, count: null } })
    ).toEqual({
      "Mcp-Param-Page": `=?base64?${Buffer.from("lógica\n").toString("base64")}?=`,
      "Mcp-Param-Active": "false",
    });
    expect(mcpParameterHeaders(schema, {})).toEqual({});
  });
  it("rejects unsafe or ambiguous annotations before a write", () => {
    for (const schema of [
      { properties: { id: { type: "string", "x-mcp-header": "bad\r\n" } } },
      {
        properties: {
          one: { type: "string", "x-mcp-header": "ID" },
          two: { type: "string", "x-mcp-header": "id" },
        },
      },
      { items: { type: "string", "x-mcp-header": "ID" } },
      { properties: { one: { type: "number", "x-mcp-header": "ID" } } },
    ])
      expect(() => mcpParameterHeaders(schema, {})).toThrow();
  });
});
