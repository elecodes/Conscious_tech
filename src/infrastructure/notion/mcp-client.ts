import { mcpParameterHeaders } from "./parameter-headers";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const NOTION_MCP = "https://mcp.notion.com/mcp";
export const NOTION_ISSUER = "https://mcp.notion.com";
export type NotionTokens = {
  access_token: string;
  refresh_token?: string;
  expiresAt: number;
  workspace_name?: string;
};
const metadataSchema = z.object({
  issuer: z.literal(NOTION_ISSUER),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  registration_endpoint: z.url(),
  code_challenge_methods_supported: z.array(z.string()),
});
export type NotionMetadata = z.infer<typeof metadataSchema>;
export type NotionSession = {
  expiresAt: number;
  pending?: { state: string; verifier: string; expiresAt: number };
  tokens?: NotionTokens;
  connectionError?: { message: string; code: string };
  exports: Record<
    string,
    { status: "sending" | "complete" | "uncertain"; url?: string; sent: number }
  >;
};
export class NotionRemoteError extends Error {
  constructor(public status = 502) {
    super("Notion request failed");
  }
}
// Bound response sizes, forbid redirects, and never interpolate remote errors into logs/UI.
async function readText(response: Response, limit = 2 * 1024 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) throw new NotionRemoteError();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new NotionRemoteError();
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await reader.cancel();
  }
}
export class NotionMcpClient {
  constructor(private fetcher: typeof fetch = fetch) {}
  private async request(url: string, init?: RequestInit) {
    const u = new URL(url);
    if (u.origin !== NOTION_ISSUER || u.username || u.password) throw new NotionRemoteError();
    const response = await this.fetcher(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new NotionRemoteError(response.status);
    return response;
  }
  async metadata() {
    const response = await this.request(`${NOTION_ISSUER}/.well-known/oauth-authorization-server`);
    const metadata = metadataSchema.parse(JSON.parse(await readText(response)));
    for (const endpoint of [
      metadata.authorization_endpoint,
      metadata.token_endpoint,
      metadata.registration_endpoint,
    ])
      if (new URL(endpoint).origin !== NOTION_ISSUER) throw new NotionRemoteError();
    if (!metadata.code_challenge_methods_supported.includes("S256")) throw new NotionRemoteError();
    return metadata;
  }
  async register(metadata: NotionMetadata, redirectUri: string) {
    const response = await this.request(metadata.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Conscious Tech",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    });
    return z.object({ client_id: z.string().min(1) }).parse(JSON.parse(await readText(response)))
      .client_id;
  }
  authorize(
    metadata: NotionMetadata,
    clientId: string,
    redirectUri: string,
    session: NotionSession
  ) {
    const verifier = randomBytes(32).toString("base64url");
    const state = randomBytes(32).toString("base64url");
    session.pending = { verifier, state, expiresAt: Date.now() + 10 * 60_000 };
    const url = new URL(metadata.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      resource: NOTION_MCP,
      scope: "default",
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      prompt: "consent",
    }).toString();
    return url.href;
  }
  async token(metadata: NotionMetadata, clientId: string, parameters: Record<string, string>) {
    const response = await this.request(metadata.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        resource: NOTION_MCP,
        ...parameters,
      }).toString(),
    });
    const data = z
      .object({
        access_token: z.string().min(1),
        token_type: z.string().refine((value) => /^bearer$/i.test(value)),
        refresh_token: z.string().optional(),
        expires_in: z.number().positive().optional(),
        workspace_name: z.string().nullish(),
      })
      .parse(JSON.parse(await readText(response)));
    return {
      ...data,
      workspace_name: data.workspace_name ?? undefined,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    } satisfies NotionTokens;
  }
  async rpc(
    token: string,
    method: "tools/list" | "tools/call",
    params: Record<string, unknown> = {},
    parameterHeaders: Record<string, string> = {}
  ) {
    const id = randomBytes(12).toString("hex");
    const response = await this.request(NOTION_MCP, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": method,
        ...parameterHeaders,
        ...(method === "tools/call" ? { "Mcp-Name": String(params.name) } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": { name: "conscious-tech", version: "0.25.1" },
          },
        },
      }),
    });
    // Request-scoped SSE may keep the connection open after the JSON-RPC response.
    let message: unknown;
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let size = 0;
      try {
        outer: while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 2 * 1024 * 1024) throw new NotionRemoteError();
          buffer += decoder.decode(value, { stream: true });
          buffer = buffer.replace(/\r\n/g, "\n");
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const event = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = event
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");
            if (!data) continue;
            const candidate = JSON.parse(data);
            if (candidate.id === id) {
              message = candidate;
              break outer;
            }
          }
        }
      } finally {
        await reader.cancel();
      }
    } else message = JSON.parse(await readText(response));
    const envelope = z
      .object({
        id: z.literal(id),
        error: z.unknown().optional(),
        result: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(message);
    if (
      envelope.error ||
      !envelope.result ||
      envelope.result.isError ||
      envelope.result.inputRequests ||
      (method === "tools/call" &&
        !Array.isArray(envelope.result.content) &&
        !envelope.result.structuredContent)
    )
      throw new NotionRemoteError();
    return envelope.result;
  }
  call(token: string, name: string, args: Record<string, unknown>, schema?: unknown) {
    return this.rpc(
      token,
      "tools/call",
      { name, arguments: args },
      mcpParameterHeaders(schema, args)
    );
  }
}
