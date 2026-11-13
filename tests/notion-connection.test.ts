import { afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createNotionHandler } from "../src/server/notion-handler";
import {
  NotionMcpClient,
  NOTION_ISSUER,
  type NotionSession,
} from "../src/infrastructure/notion/mcp-client";
import { NotionConnectionStore } from "../src/infrastructure/notion/connection-store";
import {
  notionPageProperties,
  NotionSnapshotSchema,
  type NotionSnapshot,
} from "../src/application/notion-snapshot";

const dbId = "a1111111-1111-4111-8111-111111111111";
const dsId = "b2222222-2222-4222-8222-222222222222";
const snapshot: NotionSnapshot = {
  title: "Conscious Tech · 2026-11-16",
  rows: [
    {
      name: "Lógica, práctica",
      date: "2026-11-16",
      deadline: "2026-11-20",
      status: "Completada",
      hours: 2,
      remaining: null,
      kind: "Reparto diario",
      week: "2026-11-16 – 2026-11-22",
      time: "",
      taskId: "week/a",
    },
    {
      name: "Lógica, práctica",
      date: "2026-11-18",
      deadline: "2026-11-20",
      status: "Completada",
      hours: 3,
      remaining: null,
      kind: "Reparto diario",
      week: "2026-11-16 – 2026-11-22",
      time: "",
      taskId: "week/a",
    },
    {
      name: "Sin estimar",
      date: "",
      deadline: "",
      status: "Pendiente",
      hours: null,
      remaining: null,
      kind: "Sin día",
      week: "2026-11-16 – 2026-11-22",
      time: "",
      taskId: "week/b",
    },
  ],
};
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function harness(
  options: {
    failPages?: boolean;
    expiresIn?: number;
    sse?: boolean;
    toolMissing?: boolean;
    rejectRefresh?: boolean;
    rejectAuthorization?: boolean;
    viewLink?: boolean;
  } = {}
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ct-notion-test-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const grants: URLSearchParams[] = [];
  let registrations = 0;
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("oauth-authorization-server"))
      return Response.json({
        issuer: NOTION_ISSUER,
        authorization_endpoint: NOTION_ISSUER + "/authorize",
        token_endpoint: NOTION_ISSUER + "/token",
        registration_endpoint: NOTION_ISSUER + "/register",
        code_challenge_methods_supported: ["S256"],
      });
    if (url.endsWith("/register")) {
      registrations++;
      return Response.json({ client_id: "ct-client" });
    }
    if (url.endsWith("/token")) {
      const grant = new URLSearchParams(String(init?.body));
      grants.push(grant);
      if (options.rejectAuthorization && grant.get("grant_type") === "authorization_code")
        return Response.json(
          { error: "invalid_grant", private_detail: "SECRET_ACCESS" },
          { status: 400 }
        );
      if (options.rejectRefresh && grant.get("grant_type") === "refresh_token")
        return Response.json({ error: "invalid_grant" }, { status: 401 });
      return Response.json({
        access_token: "SECRET_ACCESS",
        token_type: "Bearer",
        refresh_token: "SECRET_REFRESH",
        expires_in: options.expiresIn ?? 3600,
        workspace_name: "Mi espacio",
      });
    }
    if (url.endsWith("/mcp")) {
      const request = JSON.parse(String(init?.body));
      const headers = new Headers(init?.headers);
      expect(headers.get("MCP-Protocol-Version")).toBe("2026-07-28");
      expect(headers.get("Authorization")).toBe("Bearer SECRET_ACCESS");
      let result: Record<string, unknown>;
      if (request.method === "tools/list")
        result = {
          tools: [
            "notion-create-database",
            "notion-create-pages",
            "notion-create-view",
            ...(options.toolMissing ? [] : ["notion-fetch"]),
          ].map((name) => ({ name })),
        };
      else {
        expect(headers.get("Mcp-Name")).toBe(request.params.name);
        calls.push({ name: request.params.name, args: request.params.arguments });
        if (request.params.name === "notion-create-database")
          result = {
            content: [
              {
                type: "text",
                text: `<database url="https://www.notion.so/${dbId}"><data-source url="collection://${dsId}"></data-source></database>`,
              },
            ],
          };
        else if (request.params.name === "notion-create-view" && options.viewLink)
          result = { structuredContent: { view: { id: "c3333333-3333-4333-8333-333333333333" } } };
        else if (request.params.name === "notion-create-pages" && options.failPages)
          throw new Error("Unknown network outcome SECRET_ACCESS");
        else
          result = { content: [{ type: "text", text: JSON.stringify({ pages: [{ id: dbId }] }) }] };
      }
      const envelope = { jsonrpc: "2.0", id: request.id, result };
      if (options.sse)
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  `: keepalive\r\n\r\ndata: ${JSON.stringify(envelope)}\r\n\r\n`
                )
              );
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } }
        );
      return Response.json(envelope);
    }
    throw new Error("Unexpected destination");
  }) as typeof fetch;
  const client = new NotionMcpClient(fetcher);
  let handle: ReturnType<typeof createNotionHandler>;
  const server = http.createServer((req, res) => {
    void handle(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      })
  );
  const origin = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  const restart = () => {
    handle = createNotionHandler({ origin, directory, client });
  };
  restart();
  const req = async (
    route: string,
    body?: unknown,
    cookie = "",
    extraHeaders: Record<string, string> = {}
  ) =>
    fetch(origin + "/api/notion" + route, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { Origin: origin, "Content-Type": "application/json" }),
        Cookie: cookie,
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const connect = async (existingCookie = "") => {
    const start = await req("/connect", {}, existingCookie);
    expect(start.status).toBe(200);
    const cookie = start.headers.get("set-cookie")?.split(";")[0] ?? existingCookie;
    if (start.headers.has("set-cookie"))
      expect(start.headers.get("set-cookie")).toContain("HttpOnly");
    const url = new URL((await start.json()).authorizationUrl);
    const callback = `/callback?code=CODE&state=${url.searchParams.get("state")}&iss=${encodeURIComponent(NOTION_ISSUER)}`;
    return { cookie, url, callback };
  };
  return {
    req,
    connect,
    restart,
    directory,
    calls,
    grants,
    fetcher,
    registrations: () => registrations,
  };
}

describe("Notion account connection and calendar delivery", () => {
  it("connects via PKCE, binds state to the browser, persists encrypted credentials and sends exactly once across restart", async () => {
    const h = await harness({ sse: true });
    expect((await (await h.req("/status")).json()).connected).toBe(false);
    expect(h.fetcher).not.toHaveBeenCalled();
    const { cookie, url, callback } = await h.connect();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("resource")).toBe("https://mcp.notion.com/mcp");
    expect((await h.req(callback, undefined, "")).status).toBe(400);
    expect((await h.req(callback.replace("state=", "state=wrong"), undefined, cookie)).status).toBe(
      400
    );
    expect((await h.req(callback, undefined, cookie)).status).toBe(200);
    expect((await h.req(callback, undefined, cookie)).status).toBe(400);
    expect(
      createHash("sha256").update(h.grants[0]!.get("code_verifier")!).digest("base64url")
    ).toBe(url.searchParams.get("code_challenge"));
    h.restart();
    const status = await (await h.req("/status", undefined, cookie)).json();
    expect(status).toMatchObject({ connected: true, workspace: "Mi espacio" });
    expect(JSON.stringify(status)).not.toContain("SECRET");
    const sent = await h.req("/send", snapshot, cookie);
    expect(await sent.json()).toMatchObject({
      status: "complete",
      sent: 3,
      url: `https://www.notion.so/${dbId}`,
    });
    const pageCall = h.calls.find((c) => c.name === "notion-create-pages")!;
    const pages = pageCall.args.pages as { properties: Record<string, unknown> }[];
    expect(pages.map((p) => p.properties["Horas asignadas"])).toEqual([2, 3, undefined]);
    expect(pages.map((p) => p.properties["date:Fecha:start"])).toEqual([
      "2026-11-16",
      "2026-11-18",
      undefined,
    ]);
    expect(h.calls.find((c) => c.name === "notion-create-view")!.args.configure).toBe(
      'CALENDAR BY "Fecha"'
    );
    const count = h.calls.length;
    h.restart();
    await h.req("/send", snapshot, cookie);
    expect(h.calls).toHaveLength(count);
    const files = await readdir(h.directory);
    for (const file of files) {
      const bytes = await readFile(path.join(h.directory, file));
      expect(bytes.toString()).not.toContain("SECRET");
      expect((await stat(path.join(h.directory, file))).mode & 0o777).toBe(0o600);
    }
    const disconnect = await h.req("/disconnect", {}, cookie);
    expect(disconnect.status).toBe(200);
    expect((await (await h.req("/status", undefined, cookie)).json()).connected).toBe(false);
    expect((await h.req("/send", snapshot, cookie)).status).toBe(401);
  });
  it("does not duplicate a partial export after a lost write response or server restart", async () => {
    const h = await harness({ failPages: true });
    const { cookie, callback } = await h.connect();
    await h.req(callback, undefined, cookie);
    const first = await (await h.req("/send", snapshot, cookie)).json();
    expect(first).toMatchObject({
      status: "uncertain",
      url: `https://www.notion.so/${dbId}`,
      sent: 0,
    });
    expect(JSON.stringify(first)).not.toContain("SECRET");
    const count = h.calls.length;
    h.restart();
    await h.req("/send", snapshot, cookie);
    expect(h.calls).toHaveLength(count);
  });
  it("rejects cross-origin requests, bad callbacks and oversized snapshots without remote writes", async () => {
    const h = await harness();
    expect((await h.req("/connect", {}, "", { Origin: "https://evil.test" })).status).toBe(403);
    expect(h.fetcher).not.toHaveBeenCalled();
    const { cookie, callback } = await h.connect();
    expect(
      (
        await h.req(
          callback.replace(
            encodeURIComponent(NOTION_ISSUER),
            encodeURIComponent("https://evil.test")
          ),
          undefined,
          cookie
        )
      ).status
    ).toBe(400);
    await h.req(callback, undefined, cookie);
    expect(
      (await h.req("/send", { ...snapshot, rows: Array(301).fill(snapshot.rows[0]) }, cookie))
        .status
    ).toBe(400);
    expect(h.calls).toHaveLength(0);
    expect((await h.req("/send", snapshot)).status).toBe(401);
  });
  it("rotates expired tokens and checks required tools before creating anything", async () => {
    const h = await harness({ expiresIn: 1, toolMissing: true });
    const { cookie, callback } = await h.connect();
    await h.req(callback, undefined, cookie);
    expect((await h.req("/send", snapshot, cookie)).status).toBe(502);
    expect(h.grants.map((p) => p.get("grant_type"))).toEqual([
      "authorization_code",
      "refresh_token",
    ]);
    expect(h.calls).toHaveLength(0);
  });
  it("renews authorization and creates a fresh copy instead of reusing a previous account result", async () => {
    const h = await harness({ viewLink: true });
    let connection = await h.connect();
    await h.req(connection.callback, undefined, connection.cookie);
    const first = await (await h.req("/send", snapshot, connection.cookie)).json();
    expect(first.url).toBe(`https://www.notion.so/${dbId}?v=c3333333333343338333333333333333`);
    connection = await h.connect(connection.cookie);
    const authorized = await h.req(connection.callback, undefined, connection.cookie);
    expect(authorized.headers.get("set-cookie")).toContain("Max-Age=604800");
    await h.req("/send", snapshot, connection.cookie);
    expect(h.calls.filter((call) => call.name === "notion-create-database")).toHaveLength(2);
    expect(h.registrations()).toBe(1);
  });
  it("clears a revoked connection and rejects expired authorization state", async () => {
    const h = await harness({ expiresIn: 1, rejectRefresh: true });
    const { cookie, callback } = await h.connect();
    await h.req(callback, undefined, cookie);
    expect((await h.req("/send", snapshot, cookie)).status).toBe(401);
    expect((await (await h.req("/status", undefined, cookie)).json()).connected).toBe(false);
    const pending = await h.connect(cookie);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60_000);
    try {
      expect((await h.req(pending.callback, undefined, cookie)).status).toBe(400);
    } finally {
      clock.mockRestore();
    }
    expect(h.calls).toHaveLength(0);
  });
  it("shows an actionable callback failure in the popup and app without leaking provider details", async () => {
    const h = await harness({ rejectAuthorization: true });
    const { cookie, callback } = await h.connect();
    const response = await h.req(callback, undefined, cookie);
    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toContain("text/html");
    const text = await response.text();
    expect(text).toContain("NOTION_AUTH_HTTP_400");
    expect(text).toContain("Volver a Conscious Tech");
    expect(text).not.toContain("SECRET_ACCESS");
    const status = await (await h.req("/status", undefined, cookie)).json();
    expect(status).toMatchObject({ connected: false, code: "NOTION_AUTH_HTTP_400" });
    expect(status.message).toContain("No se ha creado");
    expect(h.calls).toHaveLength(0);
  });
  it("keeps undated work and zero hours distinct, validates dates and authenticates vault ciphertext", async () => {
    expect(notionPageProperties({ ...snapshot.rows[2]!, hours: 0 })).toMatchObject({
      "Horas asignadas": 0,
    });
    expect(notionPageProperties(snapshot.rows[2]!)).not.toHaveProperty("date:Fecha:start");
    expect(
      NotionSnapshotSchema.safeParse({
        ...snapshot,
        rows: [{ ...snapshot.rows[0], date: "2026-02-30" }],
      }).success
    ).toBe(false);
    const directory = await mkdtemp(path.join(os.tmpdir(), "ct-vault-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const store = new NotionConnectionStore(directory);
    const session: NotionSession = { expiresAt: Date.now() + 1000, exports: {} };
    await store.write("a", session);
    expect(await store.read("a")).toEqual(session);
    const { writeFile } = await import("node:fs/promises");
    const file = (await readdir(directory)).find((f) => f.endsWith(".enc"))!;
    const bytes = await readFile(path.join(directory, file));
    bytes[30] = bytes[30]! ^ 1;
    await writeFile(path.join(directory, file), bytes);
    await expect(store.read("a")).rejects.toThrow();
  });
});
