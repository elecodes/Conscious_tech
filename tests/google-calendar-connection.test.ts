import { afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createGoogleCalendarHandler } from "../src/server/google-calendar-handler";
import { GOOGLE_SCOPES } from "../src/infrastructure/google-calendar/client";
import {
  googleCalendarRows,
  type GoogleCalendarExport,
} from "../src/application/google-calendar-export";
import { googleEventHash } from "../src/infrastructure/google-calendar/delivery";
const input: GoogleCalendarExport = {
  notebookId: "d4444444-4444-4444-8444-444444444444",
  planId: "plan-1",
  calendarId: "owner@example.test",
  timeZone: "Europe/Madrid",
  snapshot: {
    title: "Semana de prueba",
    rows: [2, 2, 1, null].map((hours, index) => ({
      name: index === 3 ? "Sin fecha" : "Práctica",
      date: index === 3 ? "" : `2026-11-${16 + index}`,
      status: "Pendiente",
      hours,
      remaining: null,
      kind: "Reparto diario",
      week: "2026-11-16 – 2026-11-22",
      deadline: "",
      time: "",
      taskId: "plan-1/a",
    })),
  },
};
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function harness(
  options: {
    unconfigured?: boolean;
    lostReply?: boolean;
    expires?: number;
    denyScopes?: boolean;
  } = {}
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ct-google-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const events = new Map<string, Record<string, unknown>>();
  const grants: URLSearchParams[] = [];
  const writes: string[] = [];
  let version = 0;
  let lost = !!options.lostReply;
  const fetcher = vi.fn(async (urlValue: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(urlValue));
    if (url.pathname === "/token") {
      const data = new URLSearchParams(String(init?.body));
      grants.push(data);
      expect(data.get("client_secret")).toBe("SECRET_CLIENT");
      return Response.json({
        access_token: "SECRET_ACCESS",
        refresh_token: "SECRET_REFRESH",
        token_type: "Bearer",
        expires_in: options.expires ?? 3600,
        scope: options.denyScopes ? GOOGLE_SCOPES[0] : GOOGLE_SCOPES.join(" "),
      });
    }
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer SECRET_ACCESS");
    const method = init?.method ?? "GET";
    if (url.pathname.endsWith("/calendarList"))
      return Response.json({
        items: [
          { id: input.calendarId, summary: "Personal", accessRole: "owner", primary: true },
          { id: "writer", summary: "Compartido", accessRole: "writer" },
        ],
      });
    if (url.pathname.includes("/calendarList/"))
      return Response.json({
        id: decodeURIComponent(url.pathname.split("/").at(-1)!),
        summary: "Personal",
        accessRole: url.pathname.endsWith("writer") ? "writer" : "owner",
      });
    if (url.pathname.endsWith("/events") && method === "GET") {
      const scope = url.searchParams.get("privateExtendedProperty")!.slice("ctPlan=".length);
      return Response.json({
        items: [...events.values()].filter(
          (event) =>
            (event.extendedProperties as { private: { ctPlan: string } }).private.ctPlan === scope
        ),
      });
    }
    const id =
      method === "POST" ? JSON.parse(String(init?.body)).id : url.pathname.split("/").at(-1)!;
    if (method === "GET") {
      const value = events.get(id);
      return value ? Response.json(value) : Response.json({}, { status: 404 });
    }
    writes.push(method);
    if (method === "POST") {
      if (events.has(id)) return Response.json({}, { status: 409 });
      expect(id).toMatch(/^[0-9a-v]{5,1024}$/);
      events.set(id, {
        ...JSON.parse(String(init?.body)),
        status: "confirmed",
        etag: `v${++version}`,
        htmlLink: `https://www.google.com/calendar/event?eid=${id}`,
      });
      if (lost) {
        lost = false;
        throw new Error("Lost reply SECRET_ACCESS");
      }
    } else {
      const existing = events.get(id)!;
      if (new Headers(init?.headers).get("If-Match") !== existing.etag)
        return Response.json({}, { status: 412 });
      if (method === "DELETE") {
        events.delete(id);
        return new Response(null, { status: 204 });
      }
      events.set(id, { ...existing, ...JSON.parse(String(init?.body)), etag: `v${++version}` });
    }
    return Response.json(events.get(id));
  }) as typeof fetch;
  let handler: ReturnType<typeof createGoogleCalendarHandler>;
  const server = http.createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      })
  );
  const origin = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  const restart = () => {
    handler = createGoogleCalendarHandler({
      origin,
      directory,
      ...(options.unconfigured ? {} : { clientId: "CLIENT", clientSecret: "SECRET_CLIENT" }),
      fetcher,
    });
  };
  restart();
  const req = (route: string, body?: unknown, cookie = "", headers: Record<string, string> = {}) =>
    fetch(origin + "/api/google-calendar" + route, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Cookie: cookie,
        ...(body === undefined ? {} : { Origin: origin, "Content-Type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const connect = async () => {
    const response = await req("/connect", {});
    const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    const auth = new URL((await response.json()).authorizationUrl);
    const callback = `/callback?state=${auth.searchParams.get("state")}&code=CODE`;
    return { cookie, auth, callback };
  };
  const authorize = async () => {
    const connection = await connect();
    expect((await req(connection.callback, undefined, connection.cookie)).status).toBe(200);
    return connection;
  };
  const preview = async (cookie: string, data = input) => {
    const response = await req("/preview", data, cookie);
    expect(response.status).toBe(200);
    return response.json();
  };
  return { req, connect, authorize, preview, events, writes, grants, fetcher, directory, restart };
}
describe("Google Calendar OAuth and explicit delivery", () => {
  it("reports missing app configuration without contacting Google", async () => {
    const h = await harness({ unconfigured: true });
    expect(await (await h.req("/status")).json()).toMatchObject({
      configured: false,
      connected: false,
    });
    expect(h.fetcher).not.toHaveBeenCalled();
    expect((await h.req("/connect", {})).status).toBe(503);
  });
  it("connects with Google's standard callback, binds consent to state and restores encrypted sessions", async () => {
    const h = await harness();
    const { cookie, auth, callback } = await h.connect();
    expect((await h.req(callback.replace("state=", "state=bad"), undefined, cookie)).status).toBe(
      400
    );
    await h.req(callback, undefined, cookie);
    expect((await h.req(callback, undefined, cookie)).status).toBe(400);
    expect(
      createHash("sha256").update(h.grants[0]!.get("code_verifier")!).digest("base64url")
    ).toBe(auth.searchParams.get("code_challenge"));
    h.restart();
    const status = await (await h.req("/status", undefined, cookie)).json();
    expect(status).toMatchObject({ connected: true });
    expect(JSON.stringify(status)).not.toContain("SECRET");
    const calendars = await (await h.req("/calendars", undefined, cookie)).json();
    expect(calendars.calendars).toHaveLength(1);
    for (const file of await readdir(h.directory))
      expect((await readFile(path.join(h.directory, file))).toString()).not.toContain("SECRET");
    expect((await h.req("/connect", {}, "", { Origin: "https://evil.test" })).status).toBe(403);
    await h.req("/disconnect", {}, cookie);
    expect((await (await h.req("/status", undefined, cookie)).json()).connected).toBe(false);
  });
  it("previews without writes and reconciles split events without duplicates, including moves and removals", async () => {
    const h = await harness();
    const { cookie } = await h.authorize();
    let preview = await h.preview(cookie);
    expect(preview).toMatchObject({ create: 3, undated: 1, remove: 0 });
    expect(h.writes).toEqual([]);
    h.restart();
    const sent = await h.req("/send", { input, nonce: preview.nonce }, cookie);
    expect(sent.status).toBe(200);
    expect((await sent.json()).url).toMatch(/^https:\/\/www\.google\.com\/calendar\/event\?eid=/);
    expect(h.events.size).toBe(3);
    expect((await h.req("/send", { input, nonce: preview.nonce }, cookie)).status).toBe(409);
    const isolated = await h.preview(cookie, {
      ...input,
      notebookId: "e5555555-5555-4555-8555-555555555555",
    });
    expect(isolated).toMatchObject({ create: 3, update: 0, remove: 0 });
    const ids = [...h.events.keys()];
    preview = await h.preview(cookie);
    expect(preview).toMatchObject({ create: 0, update: 0, unchanged: 3 });
    await h.req("/send", { input, nonce: preview.nonce }, cookie);
    expect(h.writes).toHaveLength(3);
    const moved = structuredClone(input);
    moved.snapshot.rows[0]!.date = "2026-11-20";
    moved.snapshot.rows.splice(2, 1);
    preview = await h.preview(cookie, moved);
    expect(preview).toMatchObject({ create: 0, update: 1, remove: 1 });
    expect((await h.req("/send", { input: moved, nonce: preview.nonce }, cookie)).status).toBe(200);
    expect(h.events.size).toBe(2);
    expect([...h.events.keys()].every((id) => ids.includes(id))).toBe(true);
  });
  it("stops on changed preview, manual Google edits and calendars not owned", async () => {
    const h = await harness();
    const { cookie } = await h.authorize();
    let preview = await h.preview(cookie);
    const changed = structuredClone(input);
    changed.snapshot.rows[0]!.name = "Changed";
    expect((await h.req("/send", { input: changed, nonce: preview.nonce }, cookie)).status).toBe(
      409
    );
    expect(h.writes).toEqual([]);
    await h.req("/send", { input, nonce: preview.nonce }, cookie);
    preview = await h.preview(cookie);
    const first = h.events.values().next().value!;
    first.summary = "Edited in Google";
    first.etag = "manual";
    expect((await h.req("/send", { input, nonce: preview.nonce }, cookie)).status).toBe(409);
    preview = await h.preview(cookie);
    expect(preview.conflicts).toBe(1);
    expect((await h.req("/send", { input, nonce: preview.nonce }, cookie)).status).toBe(409);
    expect((await h.req("/preview", { ...input, calendarId: "writer" }, cookie)).status).toBe(403);
  });
  it("treats a Google-deleted event without an ETag as a conflict instead of recreating it", async () => {
    const h = await harness();
    const { cookie } = await h.authorize();
    let preview = await h.preview(cookie);
    await h.req("/send", { input, nonce: preview.nonce }, cookie);
    const first = h.events.values().next().value!;
    first.status = "cancelled";
    delete first.etag;
    preview = await h.preview(cookie);
    expect(preview.conflicts).toBe(1);
    expect((await h.req("/send", { input, nonce: preview.nonce }, cookie)).status).toBe(409);
    expect(h.writes).toHaveLength(3);
  });
  it("recovers a lost insert reply by reading deterministic IDs before another confirmed send", async () => {
    const h = await harness({ lostReply: true, expires: 1 });
    const { cookie } = await h.authorize();
    let preview = await h.preview(cookie);
    expect((await h.req("/send", { input, nonce: preview.nonce }, cookie)).status).toBe(502);
    expect(h.events.size).toBe(1);
    h.restart();
    preview = await h.preview(cookie);
    expect(preview).toMatchObject({ create: 2, unchanged: 1 });
    expect((await h.req("/send", { input, nonce: preview.nonce }, cookie)).status).toBe(200);
    expect(h.events.size).toBe(3);
    expect(h.grants.some((grant) => grant.get("grant_type") === "refresh_token")).toBe(true);
  });
  it("rejects partial scopes and keeps undated work out, with all-day exclusive ends and DST wall times", async () => {
    const h = await harness({ denyScopes: true });
    const { cookie } = await h.authorize();
    expect((await (await h.req("/status", undefined, cookie)).json()).connected).toBe(false);
    const rows = googleCalendarRows(input);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.body.end).toEqual({ date: "2026-11-17" });
    expect(rows[0]!.body.transparency).toBe("transparent");
    const timed = structuredClone(input);
    timed.snapshot.rows[0]!.time = "10:00–12:00";
    const event = googleCalendarRows(timed)[0]!.body;
    expect(event.transparency).toBe("opaque");
    expect(event.start).toEqual({ dateTime: "2026-11-16T10:00:00", timeZone: "Europe/Madrid" });
    expect(googleEventHash(event)).toBe(
      googleEventHash({
        ...event,
        start: { dateTime: "2026-11-16T09:00:00Z", timeZone: "Europe/Madrid" },
        end: { dateTime: "2026-11-16T11:00:00Z", timeZone: "Europe/Madrid" },
      })
    );
  });
});
