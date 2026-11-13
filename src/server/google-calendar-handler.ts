import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import path from "node:path";
import { EncryptedConnectionStore } from "../infrastructure/connections/encrypted-store";
import {
  GoogleCalendarClient,
  GoogleCalendarError,
  type GoogleSession,
} from "../infrastructure/google-calendar/client";
import {
  previewGoogleDelivery,
  googlePreviewCounts,
  sendGoogleDelivery,
} from "../infrastructure/google-calendar/delivery";
import { GoogleCalendarExportSchema } from "../application/google-calendar-export";
import { SimpleRateLimiter } from "./rate-limiter";

export function createGoogleCalendarHandler(
  options: {
    origin?: string;
    directory?: string;
    clientId?: string;
    clientSecret?: string;
    fetcher?: typeof fetch;
  } = {}
) {
  const origin = new URL(options.origin ?? "http://localhost:5181");
  if (
    origin.protocol !== "https:" &&
    !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))
  )
    throw new Error("Google Calendar requires HTTPS or loopback");
  const configured = !!options.clientId && !!options.clientSecret;
  const redirectUri = origin.origin + "/api/google-calendar/callback";
  const client = new GoogleCalendarClient(
    { clientId: options.clientId ?? "", clientSecret: options.clientSecret ?? "", redirectUri },
    options.fetcher
  );
  const store = new EncryptedConnectionStore(
    options.directory ?? path.join(process.cwd(), ".google-calendar-local")
  );
  const cookie =
    "ct_google_" + createHash("sha256").update(origin.origin).digest("hex").slice(0, 12);
  const busy = new Set<string>();
  const scopeBusy = new Set<string>();
  const limiter = new SimpleRateLimiter({ windowMs: 60000, maxRequests: 40 });
  let installation: Promise<string> | undefined;
  const installationId = () =>
    (installation ??= (async () => {
      const existing = await store.read<{ id: string }>("installation:" + origin.origin);
      if (existing) return existing.id;
      const id = randomBytes(32).toString("hex");
      await store.write("installation:" + origin.origin, { id });
      return id;
    })());
  return async (req: IncomingMessage, res: ServerResponse) => {
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
    const route = url.pathname.replace(/^\/api\/google-calendar/, "");
    if (req.headers.host !== origin.host) {
      json(route === "/status" ? 200 : 403, {
        configured: false,
        connected: false,
        message: "Google Calendar está configurado para otra dirección de la app.",
      });
      return;
    }
    const methods: Record<string, string> = {
      "/status": "GET",
      "/connect": "POST",
      "/callback": "GET",
      "/calendars": "GET",
      "/preview": "POST",
      "/send": "POST",
      "/disconnect": "POST",
    };
    if (req.method !== methods[route]) {
      json(405, { message: "Método no permitido." });
      return;
    }
    const callback = route === "/callback";
    if (
      (!callback &&
        ((req.headers.origin && req.headers.origin !== origin.origin) ||
          req.headers["sec-fetch-site"] === "cross-site")) ||
      (req.method === "POST" &&
        (req.headers.origin !== origin.origin ||
          req.headers["content-type"] !== "application/json"))
    ) {
      json(403, { message: "Origen no permitido." });
      return;
    }
    if (!limiter.check(req.socket.remoteAddress ?? "local").allowed) {
      json(429, { message: "Espera unos segundos antes de volver a intentarlo." });
      return;
    }
    const callbackPage = (success: boolean, message: string) => {
      const nonce = randomBytes(16).toString("hex");
      res.setHeader("Content-Type", "text/html;charset=utf-8");
      res.setHeader(
        "Content-Security-Policy",
        `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`
      );
      res.end(
        `<!doctype html><html lang="es"><meta charset="utf-8"><title>Conscious Tech · Google Calendar</title><p>${message}</p><a href="/">Volver a Conscious Tech</a><script nonce="${nonce}">if(window.opener){window.opener.postMessage({type:"conscious-google-connected"},${JSON.stringify(origin.origin)});${success ? "window.close();" : ""}}</script></html>`
      );
    };
    let sid = req.headers.cookie
      ?.split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith(cookie + "="))
      ?.slice(cookie.length + 1);
    if (sid && !/^[a-f0-9]{64}$/.test(sid)) sid = undefined;
    if (!configured) {
      json(route === "/status" ? 200 : 503, {
        configured: false,
        connected: false,
        message: "Falta configurar la conexión de Google Calendar en el servidor.",
      });
      return;
    }
    if (!sid && route !== "/connect") {
      if (callback) {
        res.statusCode = 400;
        callbackPage(false, "La autorización ha caducado. Vuelve a conectar desde la app.");
        return;
      }
      json(route === "/status" ? 200 : 401, {
        configured: true,
        connected: false,
        message: route === "/status" ? undefined : "Conecta Google Calendar primero.",
      });
      return;
    }
    sid ??= randomBytes(32).toString("hex");
    const key = "session:" + sid;
    const setCookie = () =>
      res.setHeader(
        "Set-Cookie",
        `${cookie}=${sid}; Path=/api/google-calendar; HttpOnly; SameSite=Lax; Max-Age=604800${origin.protocol === "https:" ? "; Secure" : ""}`
      );
    if (busy.has(key)) {
      json(409, { message: "Hay otra operación de Google Calendar en curso." });
      return;
    }
    busy.add(key);
    let session: GoogleSession | null = null;
    try {
      session = await store.read<GoogleSession>(key);
      if (session && session.expiresAt < Date.now()) {
        await store.remove(key);
        session = null;
      }
      if (route === "/status") {
        json(200, { configured: true, connected: !!session?.tokens, message: session?.error });
        return;
      }
      if (route === "/disconnect") {
        await store.remove(key);
        res.setHeader(
          "Set-Cookie",
          `${cookie}=; Path=/api/google-calendar; HttpOnly; SameSite=Lax; Max-Age=0`
        );
        json(200, { connected: false });
        return;
      }
      if (route === "/connect") {
        session ??= { expiresAt: Date.now() + 7 * 86400000 };
        setCookie();
        const authorizationUrl = client.authorize(session);
        await store.write(key, session);
        json(200, { authorizationUrl });
        return;
      }
      if (callback) {
        const pending = session?.pending;
        const issuer = url.searchParams.get("iss");
        if (
          !session ||
          !pending ||
          pending.expires < Date.now() ||
          url.searchParams.get("state") !== pending.state ||
          (issuer && !["https://accounts.google.com", "accounts.google.com"].includes(issuer))
        ) {
          res.statusCode = 400;
          callbackPage(
            false,
            "La autorización no es válida o ha caducado. Vuelve a conectar desde la app."
          );
          return;
        }
        delete session.pending;
        await store.write(key, session);
        if (url.searchParams.has("error") || !url.searchParams.get("code")) {
          session.error = "No se ha completado la autorización de Google Calendar.";
          await store.write(key, session);
          callbackPage(false, session.error);
          return;
        }
        try {
          const tokens = await client.exchange(url.searchParams.get("code")!, pending.verifier);
          session.tokens = tokens;
          delete session.error;
          delete session.preview;
          session.expiresAt = Date.now() + 7 * 86400000;
          setCookie();
          await store.write(key, session);
          callbackPage(
            true,
            "Cuenta conectada. Vuelve a Conscious Tech para elegir calendario y revisar el envío. Todavía no se han enviado eventos."
          );
        } catch {
          session.error =
            "Google no ha completado la conexión o faltan los permisos solicitados. Vuelve a conectar.";
          await store.write(key, session);
          callbackPage(false, session.error);
        }
        return;
      }
      if (!session?.tokens) {
        json(401, { message: "Conecta Google Calendar primero." });
        return;
      }
      if (session.tokens.expiresAt < Date.now() + 60000) {
        if (!session.tokens.refresh_token) {
          delete session.tokens;
          await store.write(key, session);
          throw new GoogleCalendarError(401, "GOOGLE_RECONNECT_REQUIRED");
        }
        try {
          const previous = session.tokens;
          const fresh = await client.token({
            grant_type: "refresh_token",
            refresh_token: previous.refresh_token!,
          });
          session.tokens = {
            ...fresh,
            refresh_token: fresh.refresh_token ?? previous.refresh_token,
          };
          await store.write(key, session);
        } catch (error) {
          if (error instanceof GoogleCalendarError && [400, 401].includes(error.status)) {
            delete session.tokens;
            await store.write(key, session);
          }
          throw error;
        }
      }
      const token = session.tokens.access_token;
      if (route === "/calendars") {
        json(200, { calendars: await client.calendars(token) });
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        const value = Buffer.from(chunk);
        size += value.length;
        if (size > 256 * 1024) {
          json(413, { message: "La semana es demasiado grande para este envío." });
          return;
        }
        chunks.push(value);
      }
      const raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const input = GoogleCalendarExportSchema.safeParse(route === "/send" ? raw.input : raw);
      if (!input.success) {
        json(400, { message: "Revisa la semana, las fechas y la zona horaria." });
        return;
      }
      const preview = await previewGoogleDelivery(
        input.data,
        await installationId(),
        client,
        token
      );
      if (route === "/preview") {
        const nonce = randomBytes(24).toString("hex");
        session.preview = {
          nonce,
          hash: preview.hash,
          remoteHash: preview.remoteHash,
          expires: Date.now() + 600000,
        };
        await store.write(key, session);
        json(200, { nonce, ...googlePreviewCounts(preview) });
        return;
      }
      const ticket = session.preview;
      if (
        !ticket ||
        ticket.nonce !== raw.nonce ||
        ticket.expires < Date.now() ||
        ticket.hash !== preview.hash ||
        ticket.remoteHash !== preview.remoteHash
      )
        throw new GoogleCalendarError(409, "GOOGLE_PREVIEW_CHANGED");
      if (scopeBusy.has(preview.scope)) throw new GoogleCalendarError(409, "GOOGLE_SEND_BUSY");
      delete session.preview;
      await store.write(key, session);
      scopeBusy.add(preview.scope);
      try {
        json(200, await sendGoogleDelivery(input.data, preview, client, token));
      } finally {
        scopeBusy.delete(preview.scope);
      }
    } catch (error) {
      const code =
        error instanceof GoogleCalendarError
          ? error.code
          : error instanceof SyntaxError
            ? "GOOGLE_INVALID_REQUEST"
            : "GOOGLE_CONNECTION_FAILED";
      const status =
        error instanceof GoogleCalendarError && [400, 401, 403, 409, 412].includes(error.status)
          ? error.status
          : error instanceof SyntaxError
            ? 400
            : 502;
      const messages: Record<string, string> = {
        GOOGLE_MANUAL_CHANGES:
          "Hay eventos modificados o eliminados en Google. Revísalos allí antes de actualizar desde la app.",
        GOOGLE_PREVIEW_CHANGED: "La semana o el calendario han cambiado. Pulsa revisar de nuevo.",
        GOOGLE_HTTP_412:
          "Un evento ha cambiado durante el envío. Revisa de nuevo antes de continuar.",
        GOOGLE_CALENDAR_NOT_OWNED: "Elige un calendario del que seas propietario.",
        GOOGLE_RECONNECT_REQUIRED: "Vuelve a conectar Google Calendar.",
      };
      json(status, {
        code,
        message:
          messages[code] ??
          "No se pudo confirmar el envío a Google Calendar. Revisa la conexión y vuelve a revisar la propuesta; no reenvíes sin comprobarla.",
      });
    } finally {
      busy.delete(key);
    }
  };
}
