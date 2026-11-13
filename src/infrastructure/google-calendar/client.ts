import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.owned",
];
export type GoogleTokens = { access_token: string; refresh_token?: string; expiresAt: number };
export type GoogleSession = {
  expiresAt: number;
  tokens?: GoogleTokens;
  pending?: { state: string; verifier: string; expires: number };
  error?: string;
  preview?: { nonce: string; hash: string; remoteHash: string; expires: number };
};
export class GoogleCalendarError extends Error {
  constructor(
    public status: number,
    public code = `GOOGLE_HTTP_${status}`
  ) {
    super(code);
  }
}
export const CalendarSchema = z.object({
  id: z.string().min(1),
  summary: z.string().default("Calendario"),
  accessRole: z.string(),
  primary: z.boolean().optional(),
});
export type GoogleCalendar = z.infer<typeof CalendarSchema>;
export type RemoteEvent = Record<string, unknown> & { id: string; etag?: string; status?: string };
export class GoogleCalendarClient {
  constructor(
    private config: { clientId: string; clientSecret: string; redirectUri: string },
    private fetcher: typeof fetch = fetch
  ) {}
  private async request(url: string, init?: RequestInit) {
    const parsed = new URL(url);
    if (!["https://oauth2.googleapis.com", "https://www.googleapis.com"].includes(parsed.origin))
      throw new GoogleCalendarError(400, "GOOGLE_ENDPOINT_INVALID");
    const response = await this.fetcher(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new GoogleCalendarError(response.status);
    }
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2 * 1024 * 1024) throw new GoogleCalendarError(502, "GOOGLE_RESPONSE_TOO_LARGE");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    return size ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
  }
  authorize(session: GoogleSession) {
    const verifier = randomBytes(32).toString("base64url");
    const state = randomBytes(32).toString("hex");
    session.pending = { state, verifier, expires: Date.now() + 600000 };
    delete session.error;
    return (
      "https://accounts.google.com/o/oauth2/v2/auth?" +
      new URLSearchParams({
        client_id: this.config.clientId,
        redirect_uri: this.config.redirectUri,
        response_type: "code",
        scope: GOOGLE_SCOPES.join(" "),
        state,
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256",
        access_type: "offline",
        prompt: "consent select_account",
        include_granted_scopes: "true",
      })
    );
  }
  async token(parameters: Record<string, string>) {
    const data = await this.request("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        ...parameters,
      }).toString(),
    });
    const parsed = z
      .object({
        access_token: z.string().min(1),
        refresh_token: z.string().optional(),
        expires_in: z.number().positive(),
        scope: z.string().optional(),
        token_type: z.string().refine((value) => /^bearer$/i.test(value)),
      })
      .parse(data);
    if (
      parameters.grant_type === "authorization_code" &&
      (!parsed.scope || !GOOGLE_SCOPES.every((scope) => parsed.scope!.split(" ").includes(scope)))
    )
      throw new GoogleCalendarError(403, "GOOGLE_SCOPES_MISSING");
    return {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
      expiresAt: Date.now() + parsed.expires_in * 1000,
    } satisfies GoogleTokens;
  }
  exchange(code: string, verifier: string) {
    return this.token({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: this.config.redirectUri,
    });
  }
  async api(token: string, path: string, method = "GET", body?: unknown, etag?: string) {
    return this.request("https://www.googleapis.com/calendar/v3/" + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(etag ? { "If-Match": etag } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async calendars(token: string) {
    const result: GoogleCalendar[] = [];
    let next: string | undefined;
    for (let page = 0; page < 20; page++) {
      const data = z
        .object({
          items: z.array(CalendarSchema).default([]),
          nextPageToken: z.string().optional(),
        })
        .parse(
          await this.api(
            token,
            "users/me/calendarList?" +
              new URLSearchParams({ maxResults: "250", ...(next ? { pageToken: next } : {}) })
          )
        );
      result.push(...data.items.filter((calendar) => calendar.accessRole === "owner"));
      next = data.nextPageToken;
      if (!next) return result;
    }
    throw new GoogleCalendarError(502, "GOOGLE_CALENDARS_LIMIT");
  }
  async assertOwner(token: string, id: string) {
    const calendar = CalendarSchema.parse(
      await this.api(token, "users/me/calendarList/" + encodeURIComponent(id))
    );
    if (calendar.accessRole !== "owner")
      throw new GoogleCalendarError(403, "GOOGLE_CALENDAR_NOT_OWNED");
    return calendar;
  }
  async events(token: string, calendar: string, scope: string) {
    const rows: RemoteEvent[] = [];
    let next: string | undefined;
    for (let page = 0; page < 20; page++) {
      const data = z
        .object({
          items: z
            .array(
              z
                .object({
                  id: z.string(),
                  etag: z.string().optional(),
                  status: z.string().optional(),
                })
                .passthrough()
            )
            .default([]),
          nextPageToken: z.string().optional(),
        })
        .parse(
          await this.api(
            token,
            `calendars/${encodeURIComponent(calendar)}/events?` +
              new URLSearchParams({
                privateExtendedProperty: `ctPlan=${scope}`,
                showDeleted: "true",
                maxResults: "250",
                ...(next ? { pageToken: next } : {}),
              })
          )
        );
      rows.push(...data.items);
      next = data.nextPageToken;
      if (!next) return rows;
    }
    throw new GoogleCalendarError(502, "GOOGLE_EVENTS_LIMIT");
  }
}
