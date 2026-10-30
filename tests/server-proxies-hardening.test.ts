import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  isPrivateOrReservedIpv4,
  isPrivateOrReservedIp,
  isSafeCalendarUrl,
  validateSafeCalendarUrl,
  handleCalendarProxyRequest,
  calendarProxyRateLimiter,
  isOriginAllowed,
} from "../src/server/calendar-proxy-handler";
import { handleAIProxyRequest, aiProxyRateLimiter } from "../src/server/ai-proxy-handler";
import { SimpleRateLimiter } from "../src/server/rate-limiter";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

function createMockReq(options: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
  remoteAddress?: string;
}): IncomingMessage {
  const method = options.method || "GET";
  const url = options.url || "/";
  const headers = options.headers || {};
  const bodyText =
    options.body !== undefined
      ? typeof options.body === "string"
        ? options.body
        : JSON.stringify(options.body)
      : "";

  const stream = new Readable({
    read() {
      this.push(bodyText);
      this.push(null);
    },
  });

  const req = Object.assign(stream, {
    method,
    url,
    headers,
    socket: {
      remoteAddress: options.remoteAddress || "127.0.0.1",
    },
  }) as unknown as IncomingMessage;

  return req;
}

function createMockRes(): {
  res: ServerResponse;
  getStatusCode: () => number;
  getHeaders: () => Record<string, string>;
  getBody: () => string;
  getJson: () => Record<string, unknown>;
} {
  let statusCode = 200;
  const headers: Record<string, string> = {};
  let body = "";

  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(code: number) {
      statusCode = code;
    },
    setHeader(key: string, value: string) {
      headers[key.toLowerCase()] = value;
    },
    getHeader(key: string) {
      return headers[key.toLowerCase()];
    },
    end(chunk?: unknown) {
      if (chunk) {
        body +=
          typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf-8");
      }
    },
  } as unknown as ServerResponse;

  return {
    res,
    getStatusCode: () => statusCode,
    getHeaders: () => headers,
    getBody: () => body,
    getJson: () => (body ? JSON.parse(body) : {}),
  };
}

describe("Server Proxies Security Hardening", () => {
  beforeEach(() => {
    calendarProxyRateLimiter.reset();
    aiProxyRateLimiter.reset();
    vi.restoreAllMocks();
  });

  describe("IPv4 & IPv6 Address Safety Checks", () => {
    it("flags private, loopback, multicast and reserved IPv4 addresses as unsafe", () => {
      // Loopback
      expect(isPrivateOrReservedIpv4("127.0.0.1")).toBe(true);
      expect(isPrivateOrReservedIpv4("127.255.255.254")).toBe(true);
      // Zero network
      expect(isPrivateOrReservedIpv4("0.0.0.0")).toBe(true);
      // RFC 1918
      expect(isPrivateOrReservedIpv4("10.0.0.1")).toBe(true);
      expect(isPrivateOrReservedIpv4("192.168.1.100")).toBe(true);
      expect(isPrivateOrReservedIpv4("172.16.0.1")).toBe(true);
      expect(isPrivateOrReservedIpv4("172.31.255.255")).toBe(true);
      // Link local
      expect(isPrivateOrReservedIpv4("169.254.169.254")).toBe(true);
      // CGNAT / Carrier-grade NAT (100.64.0.0/10)
      expect(isPrivateOrReservedIpv4("100.64.0.1")).toBe(true);
      expect(isPrivateOrReservedIpv4("100.127.255.255")).toBe(true);
      // Documentation / Test net
      expect(isPrivateOrReservedIpv4("192.0.2.1")).toBe(true);
      expect(isPrivateOrReservedIpv4("198.51.100.1")).toBe(true);
      expect(isPrivateOrReservedIpv4("203.0.113.1")).toBe(true);
      // Multicast and Broadcast
      expect(isPrivateOrReservedIpv4("224.0.0.1")).toBe(true);
      expect(isPrivateOrReservedIpv4("239.255.255.255")).toBe(true);
      expect(isPrivateOrReservedIpv4("255.255.255.255")).toBe(true);
    });

    it("allows valid public IPv4 addresses", () => {
      expect(isPrivateOrReservedIpv4("8.8.8.8")).toBe(false);
      expect(isPrivateOrReservedIpv4("1.1.1.1")).toBe(false);
      expect(isPrivateOrReservedIpv4("93.184.216.34")).toBe(false);
      expect(isPrivateOrReservedIpv4("142.250.190.46")).toBe(false);
    });

    it("flags IPv6 loopback, unspecified, ULA, link-local and IPv4-mapped addresses as unsafe", () => {
      // Loopback & Unspecified
      expect(isPrivateOrReservedIp("::1")).toBe(true);
      expect(isPrivateOrReservedIp("::")).toBe(true);
      // Unique Local Addresses (fc00::/7)
      expect(isPrivateOrReservedIp("fd00::1")).toBe(true);
      expect(isPrivateOrReservedIp("fc00::1234")).toBe(true);
      // Link-local (fe80::/10)
      expect(isPrivateOrReservedIp("fe80::1")).toBe(true);
      // IPv4-mapped IPv6
      expect(isPrivateOrReservedIp("::ffff:127.0.0.1")).toBe(true);
      expect(isPrivateOrReservedIp("::ffff:192.168.1.1")).toBe(true);
      expect(isPrivateOrReservedIp("::ffff:10.0.0.1")).toBe(true);
      expect(isPrivateOrReservedIp("::ffff:100.64.0.1")).toBe(true);
      // Multicast
      expect(isPrivateOrReservedIp("ff02::1")).toBe(true);
    });

    it("allows valid public IPv6 addresses", () => {
      expect(isPrivateOrReservedIp("2607:f8b0:4005:805::200e")).toBe(false);
      expect(isPrivateOrReservedIp("2001:4860:4860::8888")).toBe(false);
    });
  });

  describe("Concrete SSRF Bypass Vectors from Improvement Plan", () => {
    it("blocks every specific bypass vector identified in the plan", () => {
      // 1. http://[::1]/
      expect(isSafeCalendarUrl("http://[::1]/")).toBe(false);
      // 2. http://0.0.0.0/
      expect(isSafeCalendarUrl("http://0.0.0.0/")).toBe(false);
      // 3. http://[fd00::1]/
      expect(isSafeCalendarUrl("http://[fd00::1]/")).toBe(false);
      // 4. http://[fe80::1]/
      expect(isSafeCalendarUrl("http://[fe80::1]/")).toBe(false);
      // 5. http://[::ffff:127.0.0.1]/
      expect(isSafeCalendarUrl("http://[::ffff:127.0.0.1]/")).toBe(false);
      // 6. http://100.64.0.1/
      expect(isSafeCalendarUrl("http://100.64.0.1/")).toBe(false);
      // 7. http://foo.localhost/
      expect(isSafeCalendarUrl("http://foo.localhost/")).toBe(false);
      // 8. Private domains
      expect(isSafeCalendarUrl("http://device.local/calendar.ics")).toBe(false);
      expect(isSafeCalendarUrl("http://internal.service.internal/cal.ics")).toBe(false);
      expect(isSafeCalendarUrl("http://test.lan/calendar.ics")).toBe(false);

      // Phase 2 Residuals: IPv4-compatible, Teredo, 64:ff9b:1::/48
      expect(isSafeCalendarUrl("http://[::127.0.0.1]/")).toBe(false);
      expect(isSafeCalendarUrl("http://[2001::1]/")).toBe(false);
      expect(isPrivateOrReservedIp("::127.0.0.1")).toBe(true);
      expect(isPrivateOrReservedIp("::8.8.8.8")).toBe(true);
      expect(isPrivateOrReservedIp("2001::1")).toBe(true);
      expect(isPrivateOrReservedIp("64:ff9b:1::1")).toBe(true);
    });
  });

  describe("validateSafeCalendarUrl with DNS Resolution", () => {
    it("blocks hostnames that resolve to private or loopback IPs (DNS rebinding / localtest.me)", async () => {
      const mockDnsLookup = vi.fn().mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);

      const result = await validateSafeCalendarUrl("https://localtest.me/feed.ics", mockDnsLookup);
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("El host resuelve a una dirección IP privada");
    });

    it("blocks hostnames that resolve to any private IPv6", async () => {
      const mockDnsLookup = vi.fn().mockResolvedValue([{ address: "fd00::1", family: 6 }]);

      const result = await validateSafeCalendarUrl(
        "https://internal-calendar.corp.net/feed.ics",
        mockDnsLookup
      );
      expect(result.safe).toBe(false);
    });

    it("allows hostnames that resolve strictly to public IPs", async () => {
      const mockDnsLookup = vi.fn().mockResolvedValue([{ address: "142.250.190.46", family: 4 }]);

      const result = await validateSafeCalendarUrl(
        "https://calendar.google.com/calendar/ical/user/basic.ics",
        mockDnsLookup
      );
      expect(result.safe).toBe(true);
      expect(result.normalizedUrl?.hostname).toBe("calendar.google.com");
    });
  });

  describe("Calendar Proxy HTTP Request Handling", () => {
    it("rejects GET requests with 405 Method Not Allowed to avoid leaking private URL in access logs", async () => {
      const req = createMockReq({
        method: "GET",
        url: "/api/calendar/fetch-ical?url=https://calendar.google.com/private/basic.ics",
      });
      const { res, getStatusCode, getJson } = createMockRes();

      await handleCalendarProxyRequest(req, res);

      expect(getStatusCode()).toBe(405);
      const json = getJson();
      expect(json.code).toBe("METHOD_NOT_ALLOWED");
      expect(json.error).toContain("GET no está permitido por seguridad");
    });

    it("rejects requests missing target URL in POST body", async () => {
      const req = createMockReq({
        method: "POST",
        body: {},
      });
      const { res, getStatusCode, getJson } = createMockRes();

      await handleCalendarProxyRequest(req, res);

      expect(getStatusCode()).toBe(400);
      expect(getJson().code).toBe("MISSING_URL");
    });

    it("blocks SSRF targets via POST request", async () => {
      const req = createMockReq({
        method: "POST",
        body: { url: "http://127.0.0.1:8080/admin/secrets.ics" },
      });
      const { res, getStatusCode, getJson } = createMockRes();

      await handleCalendarProxyRequest(req, res);

      expect(getStatusCode()).toBe(400);
      expect(getJson().code).toBe("SSRF_BLOCKED");
    });

    it("streams response with byte cap and cuts off at 5 MB", async () => {
      const mockDnsLookup = vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);

      // Mock fetch with a stream exceeding 5MB
      const chunkSize = 1024 * 1024; // 1 MB
      let chunksSent = 0;
      const fakeStream = new ReadableStream({
        pull(controller) {
          if (chunksSent < 6) {
            chunksSent++;
            controller.enqueue(new Uint8Array(chunkSize));
          } else {
            controller.close();
          }
        },
      });

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "Content-Type": "text/calendar" }),
        body: fakeStream,
      } as unknown as Response);

      const req = createMockReq({
        method: "POST",
        body: { url: "https://calendar.example.com/oversized.ics" },
      });
      const { res, getStatusCode, getJson } = createMockRes();

      await handleCalendarProxyRequest(req, res, { dnsLookup: mockDnsLookup });

      expect(getStatusCode()).toBe(413);
      expect(getJson().code).toBe("ICS_TOO_LARGE");

      fetchSpy.mockRestore();
    });

    it("handles manual redirects and re-validates redirect targets", async () => {
      const mockDnsLookup = vi.fn().mockImplementation((host: string) => {
        if (host === "redirector.example.com") {
          return Promise.resolve([{ address: "93.184.216.34", family: 4 }]);
        }
        if (host === "destination.example.com") {
          return Promise.resolve([{ address: "93.184.216.35", family: 4 }]);
        }
        return Promise.resolve([{ address: "127.0.0.1", family: 4 }]);
      });

      const validIcs = "BEGIN:VCALENDAR\nVERSION:2.0\nSUMMARY:Test\nEND:VCALENDAR";

      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce({
          ok: false,
          status: 302,
          statusText: "Found",
          headers: new Headers({ location: "https://destination.example.com/feed.ics" }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: "OK",
          headers: new Headers({ "Content-Type": "text/calendar" }),
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(validIcs));
              controller.close();
            },
          }),
        } as unknown as Response);

      const req = createMockReq({
        method: "POST",
        body: { url: "https://redirector.example.com/start.ics" },
      });
      const { res, getStatusCode, getJson } = createMockRes();

      await handleCalendarProxyRequest(req, res, { dnsLookup: mockDnsLookup });

      expect(getStatusCode()).toBe(200);
      expect(getJson().success).toBe(true);
      expect(getJson().ics).toBe(validIcs);

      fetchSpy.mockRestore();
    });

    it("blocks redirects that target internal IP addresses", async () => {
      const mockDnsLookup = vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 302,
        statusText: "Found",
        headers: new Headers({ location: "http://127.0.0.1/admin.ics" }),
      } as unknown as Response);

      const req = createMockReq({
        method: "POST",
        body: { url: "https://redirector.example.com/bounce.ics" },
      });
      const { res, getStatusCode, getJson } = createMockRes();

      await handleCalendarProxyRequest(req, res, { dnsLookup: mockDnsLookup });

      expect(getStatusCode()).toBe(400);
      expect(getJson().code).toBe("SSRF_BLOCKED");

      fetchSpy.mockRestore();
    });

    it("enforces rate limits on repeated requests", async () => {
      const reqFactory = () =>
        createMockReq({
          method: "POST",
          body: { url: "https://invalid.test" },
          remoteAddress: "192.0.2.99",
        });

      // Exhaust limit of 20 requests
      for (let i = 0; i < 20; i++) {
        const { res } = createMockRes();
        await handleCalendarProxyRequest(reqFactory(), res);
      }

      // 21st request should be rate limited
      const { res, getStatusCode, getJson } = createMockRes();
      await handleCalendarProxyRequest(reqFactory(), res);

      expect(getStatusCode()).toBe(429);
      expect(getJson().code).toBe("RATE_LIMIT_EXCEEDED");
    });
  });

  describe("AI Proxy Request Hardening", () => {
    it("handles OPTIONS requests with 204 No Content", async () => {
      const req = createMockReq({
        method: "OPTIONS",
        headers: { origin: "http://localhost:5173" },
      });
      const { res, getStatusCode, getHeaders } = createMockRes();

      await handleAIProxyRequest(req, res);

      expect(getStatusCode()).toBe(204);
      expect(getHeaders()["access-control-allow-origin"]).toBe("http://localhost:5173");
    });

    it("does not send wildcard Access-Control-Allow-Origin", async () => {
      const req = createMockReq({
        method: "POST",
        headers: { origin: "http://localhost:5173" },
        body: { provider: "mock", action: "extract_items", payload: { notes: "test" } },
      });
      const { res, getHeaders } = createMockRes();

      await handleAIProxyRequest(req, res);

      expect(getHeaders()["access-control-allow-origin"]).not.toBe("*");
      expect(getHeaders()["access-control-allow-origin"]).toBe("http://localhost:5173");
    });

    it("rate limits AI proxy requests when exceeded", async () => {
      const reqFactory = () =>
        createMockReq({
          method: "POST",
          body: { provider: "mock", action: "extract_items", payload: { notes: "test" } },
          remoteAddress: "192.0.2.88",
        });

      for (let i = 0; i < 40; i++) {
        const { res } = createMockRes();
        await handleAIProxyRequest(reqFactory(), res);
      }

      const { res, getStatusCode, getJson } = createMockRes();
      await handleAIProxyRequest(reqFactory(), res);

      expect(getStatusCode()).toBe(429);
      expect(getJson().code).toBe("RATE_LIMIT_EXCEEDED");
    });
  });

  describe("SimpleRateLimiter Unit Tests", () => {
    it("accurately tracks remaining capacity and reset duration", () => {
      const limiter = new SimpleRateLimiter({ windowMs: 1000, maxRequests: 2 });
      const r1 = limiter.check("ip-1");
      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(1);

      const r2 = limiter.check("ip-1");
      expect(r2.allowed).toBe(true);
      expect(r2.remaining).toBe(0);

      const r3 = limiter.check("ip-1");
      expect(r3.allowed).toBe(false);
      expect(r3.remaining).toBe(0);
      expect(r3.resetMs).toBeGreaterThan(0);

      // Separate key has its own capacity
      const rOther = limiter.check("ip-2");
      expect(rOther.allowed).toBe(true);
    });

    it("prunes expired keys so the map does not grow without bound", () => {
      const limiter = new SimpleRateLimiter({ windowMs: 100, maxRequests: 5 });
      limiter.check("client-1");
      limiter.check("client-2");
      expect((limiter as any).size?.() ?? (limiter as any).records.size).toBe(2);

      // Advance time past windowMs
      const future = Date.now() + 200;
      (limiter as any).prune?.(future);
      expect((limiter as any).size?.() ?? (limiter as any).records.size).toBe(0);
    });
  });

  describe("isOriginAllowed Security Rules", () => {
    it("rejects undefined or empty origin", () => {
      expect(isOriginAllowed(undefined)).toBe(false);
      expect(isOriginAllowed("")).toBe(false);
    });

    it("does not allow origin merely because host matches Host header", () => {
      expect(isOriginAllowed("http://evil.com", { hostHeader: "evil.com" } as any)).toBe(false);
      expect(isOriginAllowed("https://attacker.org", "attacker.org" as any)).toBe(false);
    });

    it("allows localhost and 127.0.0.1 origins", () => {
      expect(isOriginAllowed("http://localhost:5173")).toBe(true);
      expect(isOriginAllowed("http://127.0.0.1:4173")).toBe(true);
      expect(isOriginAllowed("http://[::1]:5173")).toBe(true);
    });

    it("allows origins from explicit ALLOWED_ORIGINS env allowlist", () => {
      const env = {
        ALLOWED_ORIGINS: "https://app.conscioustech.com,https://staging.conscioustech.com",
      };
      expect(isOriginAllowed("https://app.conscioustech.com", env)).toBe(true);
      expect(isOriginAllowed("https://staging.conscioustech.com", env)).toBe(true);
      expect(isOriginAllowed("https://unauthorized.com", env)).toBe(false);
    });
  });

  describe("AI Proxy Token Authentication (AI_PROXY_TOKEN)", () => {
    it("rejects requests when AI_PROXY_TOKEN is configured and token is missing or invalid", async () => {
      const env = { AI_PROXY_TOKEN: "super-secret-token" };
      const req = createMockReq({
        method: "POST",
        body: { provider: "mock", action: "extract_items", payload: { text: "hello" } },
      });
      const { res, getStatusCode, getJson } = createMockRes();

      await handleAIProxyRequest(req, res, env);

      expect(getStatusCode()).toBe(401);
      expect(getJson().code).toBe("UNAUTHORIZED");
    });

    it("accepts requests when AI_PROXY_TOKEN matches via x-ai-proxy-token header", async () => {
      const env = { AI_PROXY_TOKEN: "super-secret-token" };
      const req = createMockReq({
        method: "POST",
        headers: { "x-ai-proxy-token": "super-secret-token" },
        body: {
          provider: "mock",
          action: "extract_items",
          payload: { text: "valid text", currentDate: "2026-10-29" },
        },
      });
      const { res, getStatusCode, getJson } = createMockRes();

      await handleAIProxyRequest(req, res, env);

      expect(getStatusCode()).toBe(200);
      expect(getJson().success).toBe(true);
    });

    it("accepts requests when AI_PROXY_TOKEN matches via Authorization header", async () => {
      const env = { AI_PROXY_TOKEN: "super-secret-token" };
      const req = createMockReq({
        method: "POST",
        headers: { authorization: "Bearer super-secret-token" },
        body: {
          provider: "mock",
          action: "extract_items",
          payload: { text: "valid text", currentDate: "2026-10-29" },
        },
      });
      const { res, getStatusCode, getJson } = createMockRes();

      await handleAIProxyRequest(req, res, env);

      expect(getStatusCode()).toBe(200);
      expect(getJson().success).toBe(true);
    });
  });

  describe("DNS Rebinding Protection via Connection Pinning", () => {
    it("pins the connection to the validated IP and prevents DNS rebinding to private IPs", async () => {
      let dnsCallCount = 0;
      const injectedDns = vi.fn().mockImplementation(() => {
        dnsCallCount++;
        if (dnsCallCount === 1) {
          // Initial validation resolves to public IP
          return Promise.resolve([{ address: "93.184.216.34", family: 4 }]);
        }
        // Second call (DNS rebinding attack) resolves to private IP
        return Promise.resolve([{ address: "127.0.0.1", family: 4 }]);
      });

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
        // If an undici dispatcher/agent is attached with pinned lookup, inspect it
        const dispatcher = (init as any)?.dispatcher;
        if (dispatcher && typeof dispatcher === "object") {
          // Check agent lookup behavior
          const lookup =
            dispatcher[
              Object.getOwnPropertySymbols(dispatcher).find((s) => s.description === "connect") ||
                "connect"
            ]?.lookup ||
            (dispatcher as any).connect?.lookup ||
            (dispatcher as any).options?.connect?.lookup;
          if (lookup) {
            let pinnedResult: any = null;
            lookup("rebind.example.com", {}, (_err: any, addrs: any) => {
              pinnedResult = addrs;
            });
            if (pinnedResult) {
              const ip = Array.isArray(pinnedResult) ? pinnedResult[0]?.address : pinnedResult;
              if (ip === "127.0.0.1") {
                throw new Error("DNS Rebinding vulnerability: connected to 127.0.0.1");
              }
            }
          }
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: new Headers({ "Content-Type": "text/calendar" }),
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode("BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR")
              );
              controller.close();
            },
          }),
        } as unknown as Response;
      });

      const req = createMockReq({
        method: "POST",
        body: { url: "https://rebind.example.com/feed.ics" },
      });
      const { res, getStatusCode, getJson } = createMockRes();

      await handleCalendarProxyRequest(req, res, { dnsLookup: injectedDns });

      expect(getStatusCode()).toBe(200);
      expect(getJson().success).toBe(true);

      // Verify fetch was called with a dispatcher / agent that pinned to the public IP
      const fetchOpts = fetchSpy.mock.calls[0]?.[1];
      expect(fetchOpts).toBeDefined();
      expect((fetchOpts as any).dispatcher).toBeDefined();

      fetchSpy.mockRestore();
    });
  });

  describe("Proxy Token Documentation and Security Contract", () => {
    it("asserts docs and config do not describe VITE_ proxy token as a secret and clarify real protections", () => {
      const readme = fs.readFileSync(path.resolve(__dirname, "../README.md"), "utf-8");
      const envExample = fs.readFileSync(path.resolve(__dirname, "../.env.example"), "utf-8");
      const adr0023 = fs.readFileSync(
        path.resolve(__dirname, "../docs/adr/0023-proxy-hardening-and-provider-decoupling.md"),
        "utf-8"
      );
      const changelog = fs.readFileSync(path.resolve(__dirname, "../CHANGELOG.md"), "utf-8");

      for (const [, content] of [
        ["README.md", readme],
        [".env.example", envExample],
        ["ADR 0023", adr0023],
        ["CHANGELOG.md", changelog],
      ]) {
        expect(content).not.toMatch(/(?:shared\s+secret|secreto\s+compartido).*?(?:AI_PROXY_TOKEN|VITE_AI_PROXY_TOKEN)/i);
        expect(content).not.toMatch(/(?:AI_PROXY_TOKEN|VITE_AI_PROXY_TOKEN).*?(?:shared\s+secret|secreto\s+compartido)/i);
      }

      expect(readme).toMatch(/dev guard, not a secret/i);
      expect(readme).toMatch(/origin/i);
      expect(readme).toMatch(/localhost/i);

      expect(adr0023).toMatch(/guardia de desarrollo/i);
      expect(adr0023).toMatch(/no es un secreto/i);
      expect(adr0023).toMatch(/origin/i);
      expect(adr0023).toMatch(/localhost/i);

      expect(envExample).toMatch(/dev guard/i);
    });
  });
});
