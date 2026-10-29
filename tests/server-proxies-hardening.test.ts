import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isPrivateOrReservedIpv4,
  isPrivateOrReservedIp,
  isSafeCalendarUrl,
  validateSafeCalendarUrl,
  handleCalendarProxyRequest,
  calendarProxyRateLimiter,
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
  const bodyText = options.body !== undefined
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
        body += typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf-8");
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
    });
  });

  describe("validateSafeCalendarUrl with DNS Resolution", () => {
    it("blocks hostnames that resolve to private or loopback IPs (DNS rebinding / localtest.me)", async () => {
      const mockDnsLookup = vi.fn().mockResolvedValue([
        { address: "127.0.0.1", family: 4 },
      ]);

      const result = await validateSafeCalendarUrl("https://localtest.me/feed.ics", mockDnsLookup);
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("El host resuelve a una dirección IP privada");
    });

    it("blocks hostnames that resolve to any private IPv6", async () => {
      const mockDnsLookup = vi.fn().mockResolvedValue([
        { address: "fd00::1", family: 6 },
      ]);

      const result = await validateSafeCalendarUrl("https://internal-calendar.corp.net/feed.ics", mockDnsLookup);
      expect(result.safe).toBe(false);
    });

    it("allows hostnames that resolve strictly to public IPs", async () => {
      const mockDnsLookup = vi.fn().mockResolvedValue([
        { address: "142.250.190.46", family: 4 },
      ]);

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
      const mockDnsLookup = vi.fn().mockResolvedValue([
        { address: "93.184.216.34", family: 4 },
      ]);

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

      const fetchSpy = vi.spyOn(globalThis, "fetch")
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
      const mockDnsLookup = vi.fn().mockResolvedValue([
        { address: "93.184.216.34", family: 4 },
      ]);

      const fetchSpy = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce({
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
      const reqFactory = () => createMockReq({
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
      const reqFactory = () => createMockReq({
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
  });
});
