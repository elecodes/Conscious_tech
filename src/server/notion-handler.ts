import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { NotionConnectionStore } from "../infrastructure/notion/connection-store";
import {
  NotionMcpClient,
  NotionRemoteError,
  NOTION_ISSUER,
  type NotionSession,
} from "../infrastructure/notion/mcp-client";
import { sendNotionCalendar } from "../infrastructure/notion/send-calendar";
import { NotionSnapshotSchema } from "../application/notion-snapshot";
import { SimpleRateLimiter } from "./rate-limiter";

export function createNotionHandler(
  options: { origin?: string; directory?: string; client?: NotionMcpClient } = {}
) {
  const origin = new URL(options.origin ?? process.env.NOTION_APP_ORIGIN ?? "http://localhost:5181")
    .origin;
  const originUrl = new URL(origin);
  if (
    originUrl.protocol !== "https:" &&
    !(
      originUrl.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(originUrl.hostname)
    )
  )
    throw new Error("Notion requires HTTPS or loopback");
  const store = new NotionConnectionStore(
    options.directory ?? process.env.NOTION_STORAGE_DIR ?? path.join(process.cwd(), ".notion-local")
  );
  const client = options.client ?? new NotionMcpClient();
  const cookieName = "ct_notion_" + createHash("sha256").update(origin).digest("hex").slice(0, 12);
  const redirectUri = origin + "/api/notion/callback";
  const busy = new Set<string>();
  const limiter = new SimpleRateLimiter({ windowMs: 60_000, maxRequests: 30 });
  let registration: Promise<string> | undefined;
  async function clientId(metadata: Awaited<ReturnType<NotionMcpClient["metadata"]>>) {
    const key = "client:" + origin;
    if (!registration)
      registration = (async () => {
        const cached = await store.read<{ id: string }>(key);
        if (cached) return cached.id;
        const id = await client.register(metadata, redirectUri);
        await store.write(key, { id });
        return id;
      })().catch((error) => {
        registration = undefined;
        throw error;
      });
    return registration;
  }
  return async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const json = (status: number, data: unknown) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data));
    };
    let url: URL;
    try {
      url = new URL(req.url ?? "/", origin);
    } catch {
      json(400, { message: "Dirección no válida." });
      return;
    }
    const route = url.pathname.replace(/^\/api\/notion/, "");
    if (req.headers.host !== originUrl.host) {
      json(route === "/status" ? 200 : 403, {
        available: false,
        connected: false,
        message: "La conexión Notion está configurada para otra dirección de la app.",
      });
      return;
    }
    const methods: Record<string, string> = {
      "/status": "GET",
      "/callback": "GET",
      "/connect": "POST",
      "/send": "POST",
      "/disconnect": "POST",
    };
    if (!methods[route] || req.method !== methods[route]) {
      json(405, { message: "Método no permitido." });
      return;
    }
    const callback = route === "/callback" && req.method === "GET";
    if (
      !callback &&
      ((req.headers.origin && req.headers.origin !== origin) ||
        req.headers["sec-fetch-site"] === "cross-site")
    ) {
      json(403, { message: "Origen no permitido." });
      return;
    }
    if (
      req.method !== "GET" &&
      (req.method !== "POST" ||
        req.headers.origin !== origin ||
        req.headers["content-type"] !== "application/json")
    ) {
      json(403, { message: "Petición no permitida." });
      return;
    }
    if (!limiter.check(req.socket.remoteAddress ?? "local").allowed) {
      json(429, { message: "Espera un momento antes de volver a intentarlo." });
      return;
    }
    let sid = req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
    if (sid && !/^[a-f0-9]{64}$/.test(sid)) sid = undefined;
    if (!sid && route !== "/connect") {
      json(callback ? 400 : route === "/send" ? 401 : 200, {
        available: true,
        connected: false,
        message: callback
          ? "La autorización ha caducado. Conecta de nuevo."
          : route === "/send"
            ? "Conecta tu cuenta de Notion primero."
            : undefined,
      });
      return;
    }
    if (!sid) {
      sid = randomBytes(32).toString("hex");
      res.setHeader(
        "Set-Cookie",
        `${cookieName}=${sid}; HttpOnly; SameSite=Lax; Path=/api/notion; Max-Age=604800${originUrl.protocol === "https:" ? "; Secure" : ""}`
      );
    }
    const key = "session:" + sid;
    if (busy.has(key)) {
      json(409, { message: "Hay otra operación de Notion en curso." });
      return;
    }
    busy.add(key);
    try {
      let session = await store.read<NotionSession>(key);
      if (session && session.expiresAt < Date.now()) {
        await store.remove(key);
        session = null;
      }
      if (route === "/status" && req.method === "GET") {
        json(200, {
          available: true,
          connected: !!session?.tokens,
          workspace: session?.tokens?.workspace_name,
        });
        return;
      }
      if (route === "/disconnect" && req.method === "POST") {
        await store.remove(key);
        res.setHeader(
          "Set-Cookie",
          `${cookieName}=; HttpOnly; SameSite=Lax; Path=/api/notion; Max-Age=0`
        );
        json(200, { connected: false });
        return;
      }
      if (route === "/connect" && req.method === "POST") {
        session ??= { expiresAt: Date.now() + 7 * 86400_000, exports: {} };
        const metadata = await client.metadata();
        const authorizationUrl = client.authorize(
          metadata,
          await clientId(metadata),
          redirectUri,
          session
        );
        await store.write(key, session);
        json(200, { authorizationUrl });
        return;
      }
      if (callback) {
        const pending = session?.pending;
        if (
          !session ||
          !pending ||
          pending.expiresAt < Date.now() ||
          url.searchParams.get("state") !== pending.state ||
          url.searchParams.get("iss") !== NOTION_ISSUER
        ) {
          json(400, { message: "La autorización no es válida o ha caducado. Conecta de nuevo." });
          return;
        }
        delete session.pending;
        await store.write(key, session);
        let success = false;
        if (!url.searchParams.has("error") && url.searchParams.get("code")) {
          const metadata = await client.metadata();
          session.tokens = await client.token(metadata, await clientId(metadata), {
            grant_type: "authorization_code",
            code: url.searchParams.get("code")!,
            code_verifier: pending.verifier,
            redirect_uri: redirectUri,
          });
          // A new authorization may belong to a different account/workspace.
          session.exports = {};
          session.expiresAt = Date.now() + 7 * 86400_000;
          res.setHeader(
            "Set-Cookie",
            `${cookieName}=${sid}; HttpOnly; SameSite=Lax; Path=/api/notion; Max-Age=604800${originUrl.protocol === "https:" ? "; Secure" : ""}`
          );
          await store.write(key, session);
          success = true;
        }
        const nonce = randomBytes(16).toString("hex");
        res.setHeader("Content-Type", "text/html;charset=utf-8");
        res.setHeader(
          "Content-Security-Policy",
          `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`
        );
        res.end(
          `<!doctype html><meta charset="utf-8"><title>Conscious Tech · Notion</title><p>${success ? "Notion conectado. Puedes volver a Conscious Tech." : "Conexión cancelada. Puedes volver a Conscious Tech."}</p><script nonce="${nonce}">if(window.opener){window.opener.postMessage({type:"conscious-notion-connected"},${JSON.stringify(origin)});window.close();}</script>`
        );
        return;
      }
      if (route !== "/send" || req.method !== "POST") {
        json(404, { message: "Ruta no encontrada." });
        return;
      }
      if (!session?.tokens) {
        json(401, { message: "Conecta tu cuenta de Notion primero." });
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        const buffer = Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > 256 * 1024) {
          json(413, { message: "La semana es demasiado grande para este envío." });
          return;
        }
        chunks.push(buffer);
      }
      const parsed = NotionSnapshotSchema.safeParse(
        JSON.parse(Buffer.concat(chunks).toString("utf8"))
      );
      if (!parsed.success) {
        json(400, { message: "Revisa los datos de la semana antes de enviarla." });
        return;
      }
      const save = () => store.write(key, session);
      const refresh = async () => {
        if (!session.tokens?.refresh_token) {
          delete session.tokens;
          await save();
          throw new NotionRemoteError(401);
        }
        const metadata = await client.metadata();
        try {
          const previous = session.tokens;
          const tokens = await client.token(metadata, await clientId(metadata), {
            grant_type: "refresh_token",
            refresh_token: previous.refresh_token!,
          });
          session.tokens = {
            ...tokens,
            workspace_name: previous.workspace_name,
            refresh_token: tokens.refresh_token ?? previous.refresh_token,
          };
          await save();
        } catch (error) {
          if (error instanceof NotionRemoteError && [400, 401].includes(error.status)) {
            delete session.tokens;
            await save();
          }
          throw error;
        }
      };
      if (session.tokens.expiresAt < Date.now() + 60_000) await refresh();
      // Only retry reads after a definitive 401; writes never retry automatically.
      const call = (name: string, args: Record<string, unknown>, schema?: unknown) =>
        client.call(session.tokens!.access_token, name, args, schema);
      const list = async () => {
        const tools: unknown[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < 20; page++) {
          let result: Record<string, unknown>;
          try {
            result = await client.rpc(
              session.tokens!.access_token,
              "tools/list",
              cursor ? { cursor } : {}
            );
          } catch (error) {
            if (error instanceof NotionRemoteError && error.status === 401) {
              await refresh();
              result = await client.rpc(
                session.tokens!.access_token,
                "tools/list",
                cursor ? { cursor } : {}
              );
            } else throw error;
          }
          if (!Array.isArray(result.tools)) throw new NotionRemoteError();
          tools.push(...result.tools);
          if (typeof result.nextCursor !== "string") return { tools };
          cursor = result.nextCursor;
        }
        throw new NotionRemoteError();
      };
      const job = await sendNotionCalendar(parsed.data, session, call, list, save);
      json(200, {
        ...job,
        message:
          job.status === "complete"
            ? "Calendario enviado a Notion. Si se abre la tabla, elige la vista «Calendario»."
            : "El envío no se ha podido confirmar completo. Revisa la copia en Notion antes de volver a enviar; no se repetirá automáticamente.",
      });
    } catch (error) {
      if (error instanceof SyntaxError) {
        json(400, { message: "Los datos no son válidos." });
        return;
      }
      json(error instanceof NotionRemoteError && error.status === 401 ? 401 : 502, {
        message:
          "No se pudo completar la conexión con Notion. Tus datos locales se conservan. Revisa la conexión o vuelve a conectar tu cuenta.",
      });
    } finally {
      busy.delete(key);
    }
  };
}
