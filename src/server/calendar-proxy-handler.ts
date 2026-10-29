import type { IncomingMessage, ServerResponse } from "node:http";
import dns from "node:dns";
import net from "node:net";
import { Agent } from "undici";
import { SimpleRateLimiter } from "./rate-limiter";

export const MAX_ICS_BYTES = 5 * 1024 * 1024; // 5 MB limit for calendar export
export const MAX_REDIRECTS = 3;

// Dev rate limiter: 20 requests per minute per IP
export const calendarProxyRateLimiter = new SimpleRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 20,
});

/**
 * Validates whether an IPv4 address belongs to a private, loopback, multicast, or reserved range.
 */
export function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true; // Treat malformed as unsafe
  }
  const [a, b, c] = parts as [number, number, number, number];

  // 0.0.0.0/8 (Current network)
  if (a === 0) return true;
  // 10.0.0.0/8 (Private-Use)
  if (a === 10) return true;
  // 100.64.0.0/10 (Shared Address Space / CGNAT: 100.64.0.0 - 100.127.255.255)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (Link-Local)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 (Private-Use: 172.16.0.0 - 172.31.255.255)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.0.0.0/24 (IETF Protocol Assignments)
  if (a === 192 && b === 0 && c === 0) return true;
  // 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 0 && c === 2) return true;
  // 192.88.99.0/24 (6to4 Relay Anycast)
  if (a === 192 && b === 88 && c === 99) return true;
  // 192.168.0.0/16 (Private-Use)
  if (a === 192 && b === 168) return true;
  // 198.18.0.0/15 (Benchmarking: 198.18.0.0 - 198.19.255.255)
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 198.51.100.0/24 (TEST-NET-2)
  if (a === 198 && b === 51 && c === 100) return true;
  // 203.0.113.0/24 (TEST-NET-3)
  if (a === 203 && b === 0 && c === 113) return true;
  // 224.0.0.0/4 (Multicast: 224.0.0.0 - 239.255.255.255)
  if (a >= 224 && a <= 239) return true;
  // 240.0.0.0/4 (Reserved / Future Use / Broadcast: 240.0.0.0 - 255.255.255.255)
  if (a >= 240) return true;

  return false;
}

/**
 * Expands an IPv6 address string into 8 16-bit numeric words.
 */
export function expandIpv6(ip: string): number[] | null {
  let cleanIp = ip.toLowerCase();

  // Handle IPv4-mapped IPv6 (e.g. ::ffff:192.168.1.1)
  const lastColon = cleanIp.lastIndexOf(":");
  if (lastColon !== -1) {
    const potentialIpv4 = cleanIp.slice(lastColon + 1);
    if (potentialIpv4.includes(".")) {
      if (isPrivateOrReservedIpv4(potentialIpv4)) {
        // Return dummy private representation immediately
        return [0, 0, 0, 0, 0, 0xffff, 0x7f00, 1];
      }
      const parts = potentialIpv4.split(".").map(Number);
      if (parts.length === 4 && parts.every((n) => !isNaN(n) && n >= 0 && n <= 255)) {
        const w1 = (((parts[0] ?? 0) << 8) | (parts[1] ?? 0)).toString(16);
        const w2 = (((parts[2] ?? 0) << 8) | (parts[3] ?? 0)).toString(16);
        cleanIp = cleanIp.slice(0, lastColon + 1) + w1 + ":" + w2;
      } else {
        return null;
      }
    }
  }

  const parts = cleanIp.split("::");
  if (parts.length > 2) return null;

  const leftWords = parts[0] ? parts[0].split(":").filter(Boolean) : [];
  const rightWords = parts.length === 2 && parts[1] ? parts[1].split(":").filter(Boolean) : [];

  const missingWords = 8 - (leftWords.length + rightWords.length);
  if (parts.length === 2 && missingWords < 0) return null;
  const fill = parts.length === 2 ? new Array(missingWords).fill("0") : [];

  const allWords = [...leftWords, ...fill, ...rightWords];
  if (allWords.length !== 8) return null;

  const parsed = allWords.map((w) => parseInt(w, 16));
  if (parsed.some((n) => isNaN(n) || n < 0 || n > 0xffff)) return null;

  return parsed;
}

/**
 * Validates whether an IPv4 or IPv6 address belongs to any private or reserved address range.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    return isPrivateOrReservedIpv4(ip);
  }
  if (version === 6) {
    const words = expandIpv6(ip);
    if (!words) return true; // Malformed IPv6 treated as unsafe

    // ::/96 (IPv4-compatible IPv6 addresses: first 96 bits are all zero)
    // This includes :: (unspecified), ::1 (loopback), and ::<ipv4>
    if (words.slice(0, 6).every((w) => w === 0)) return true;
    // :: (Unspecified)
    if (words.every((w) => w === 0)) return true;
    // ::1 (Loopback)
    if (words.slice(0, 7).every((w) => w === 0) && words[7] === 1) return true;
    // ::ffff:0:0/96 (IPv4-mapped)
    if (words.slice(0, 5).every((w) => w === 0) && words[5] === 0xffff) {
      const w6 = words[6] ?? 0;
      const w7 = words[7] ?? 0;
      const ipv4 = `${(w6 >> 8) & 0xff}.${w6 & 0xff}.${(w7 >> 8) & 0xff}.${w7 & 0xff}`;
      return isPrivateOrReservedIpv4(ipv4);
    }
    // fc00::/7 (Unique local: fc00:: - fdff::)
    if (((words[0] ?? 0) & 0xfe00) === 0xfc00) return true;
    // fe80::/10 (Link-local: fe80:: - febf::)
    if (((words[0] ?? 0) & 0xffc0) === 0xfe80) return true;
    // ff00::/8 (Multicast)
    if (((words[0] ?? 0) & 0xff00) === 0xff00) return true;
    // 100::/64 (Discard-only)
    if (words[0] === 0x0100 && words[1] === 0 && words[2] === 0 && words[3] === 0) return true;
    // 2001::/32 (Teredo tunneling prefix RFC 4380)
    if (words[0] === 0x2001 && words[1] === 0x0000) return true;
    // 2001:db8::/32 (Documentation)
    if (words[0] === 0x2001 && words[1] === 0x0db8) return true;
    // 2002::/16 (6to4 relay)
    if (words[0] === 0x2002) return true;
    // 64:ff9b::/96 (IPv4/IPv6 translation)
    if (words[0] === 0x0064 && words[1] === 0xff9b && words[2] === 0 && words[3] === 0 && words[4] === 0 && words[5] === 0) return true;
    // 64:ff9b:1::/48 (Local-Use IPv4/IPv6 Translation RFC 8215)
    if (words[0] === 0x0064 && words[1] === 0xff9b && words[2] === 0x0001) return true;

    return false;
  }

  return true;
}

/**
 * Synchronous validation that verifies the URL scheme and checks for obvious localhost/private hostnames.
 */
export function isSafeCalendarUrl(urlString: string): boolean {
  try {
    const normalized = urlString.startsWith("webcal://")
      ? urlString.replace("webcal://", "https://")
      : urlString;

    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }

    let host = parsed.hostname.toLowerCase();
    if (host.startsWith("[") && host.endsWith("]")) {
      host = host.slice(1, -1);
    }

    // Direct loopback or private hostnames
    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host.endsWith(".lan") ||
      host.endsWith(".home") ||
      host.endsWith(".corp") ||
      host.endsWith(".test") ||
      host.endsWith(".example") ||
      host.endsWith(".invalid")
    ) {
      return false;
    }

    // If host is an IP literal, validate ranges directly
    if (net.isIP(host)) {
      return !isPrivateOrReservedIp(host);
    }

    return true;
  } catch {
    return false;
  }
}

export type DnsLookupFunction = (
  hostname: string,
  options: { all: true }
) => Promise<Array<{ address: string; family: number }>>;

export interface UrlValidationResult {
  safe: boolean;
  reason?: string;
  normalizedUrl?: URL;
  validatedIp?: string;
  validatedFamily?: number;
}

/**
 * Deep asynchronous SSRF validation with DNS resolution.
 * Resolves all IP addresses for the target host and rejects any private or reserved IPs.
 */
export async function validateSafeCalendarUrl(
  urlString: string,
  dnsLookup: DnsLookupFunction = (host, opts) => dns.promises.lookup(host, opts)
): Promise<UrlValidationResult> {
  if (!isSafeCalendarUrl(urlString)) {
    return {
      safe: false,
      reason: "URL no válida, protocolo no permitido o destino reservado/local.",
    };
  }

  const normalized = urlString.startsWith("webcal://")
    ? urlString.replace("webcal://", "https://")
    : urlString;

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return { safe: false, reason: "Formato de URL no válido." };
  }

  let host = parsed.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }

  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      return { safe: false, reason: `Dirección IP privada o reservada bloqueada (${host}).` };
    }
    return {
      safe: true,
      normalizedUrl: parsed,
      validatedIp: host,
      validatedFamily: net.isIP(host),
    };
  }

  try {
    const addresses = await dnsLookup(host, { all: true });
    if (!addresses || addresses.length === 0) {
      return { safe: false, reason: "No se encontraron registros DNS para el host." };
    }

    for (const record of addresses) {
      if (isPrivateOrReservedIp(record.address)) {
        return {
          safe: false,
          reason: `El host resuelve a una dirección IP privada o no permitida (${record.address}).`,
        };
      }
    }

    const primaryRecord = addresses[0];
    return {
      safe: true,
      normalizedUrl: parsed,
      validatedIp: primaryRecord.address,
      validatedFamily: primaryRecord.family,
    };
  } catch (dnsErr) {
    return {
      safe: false,
      reason: `Error en la resolución DNS: ${dnsErr instanceof Error ? dnsErr.message : String(dnsErr)}`,
    };
  }
}

/**
 * Validates whether the origin header comes from the local dev environment or an explicit ALLOWED_ORIGINS allowlist.
 * Returns false when there is no Origin header. Does NOT accept origins merely matching Host header.
 */
export function isOriginAllowed(
  originHeader?: string,
  envOrHost?: Record<string, string | undefined> | string
): boolean {
  if (!originHeader || typeof originHeader !== "string" || !originHeader.trim()) {
    return false;
  }

  let env: Record<string, string | undefined> = process.env;
  if (envOrHost && typeof envOrHost === "object") {
    env = envOrHost;
  }

  try {
    const originUrl = new URL(originHeader);
    const host = originUrl.hostname.toLowerCase();

    // 1. Localhost development origins
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") {
      return true;
    }

    // 2. Explicit allowlist from ALLOWED_ORIGINS env var
    const allowedEnv = env.ALLOWED_ORIGINS;
    if (allowedEnv) {
      const allowedList = allowedEnv
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const originLower = originHeader.trim().toLowerCase();
      const originUrlOrigin = originUrl.origin.toLowerCase();
      if (allowedList.includes(originLower) || allowedList.includes(originUrlOrigin) || allowedList.includes(host)) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Handles incoming requests to fetch an external iCal feed securely.
 * Enforces POST body with credentials, strict SSRF DNS checking, manual redirect revalidation,
 * and streaming with a hard 5MB byte cap.
 */
export async function handleCalendarProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: {
    dnsLookup?: DnsLookupFunction;
    fetchFn?: typeof fetch;
  } = {}
): Promise<void> {
  const originHeader = req.headers?.origin;

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Vary", "Origin");

  if (isOriginAllowed(originHeader)) {
    res.setHeader("Access-Control-Allow-Origin", originHeader!);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Reject GET requests explicitly to protect calendar credentials from server access logs
  if (req.method === "GET") {
    res.statusCode = 405;
    res.end(
      JSON.stringify({
        error: "El método GET no está permitido por seguridad para evitar registrar la URL privada en logs. Use POST con { url } en el cuerpo.",
        code: "METHOD_NOT_ALLOWED",
      })
    );
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "Método no permitido. Use POST.", code: "METHOD_NOT_ALLOWED" }));
    return;
  }

  // Rate limiting check
  const clientIp = req.socket?.remoteAddress || "127.0.0.1";
  const rateLimit = calendarProxyRateLimiter.check(clientIp);
  if (!rateLimit.allowed) {
    res.statusCode = 429;
    res.setHeader("Retry-After", String(Math.ceil(rateLimit.resetMs / 1000)));
    res.end(
      JSON.stringify({
        error: "Demasiadas peticiones al proxy de calendario. Por favor espera un momento.",
        code: "RATE_LIMIT_EXCEEDED",
      })
    );
    return;
  }

  // Read request JSON body with size cap (10 KB max for payload)
  let bodyText = "";
  try {
    for await (const chunk of req) {
      bodyText += chunk;
      if (bodyText.length > 10 * 1024) {
        res.statusCode = 413;
        res.end(JSON.stringify({ error: "Carga útil de la petición demasiado grande.", code: "PAYLOAD_TOO_LARGE" }));
        return;
      }
    }
  } catch {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Error leyendo la petición.", code: "BAD_REQUEST" }));
    return;
  }

  let targetUrl: string | null = null;
  try {
    const parsed = JSON.parse(bodyText);
    targetUrl = parsed.url;
  } catch {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Cuerpo de petición JSON inválido.", code: "INVALID_JSON" }));
    return;
  }

  if (!targetUrl || typeof targetUrl !== "string" || !targetUrl.trim()) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Falta el parámetro 'url' en el cuerpo JSON.", code: "MISSING_URL" }));
    return;
  }

  let currentUrl = targetUrl.trim();
  let redirectCount = 0;
  let finalResponse: Response | null = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      while (redirectCount <= MAX_REDIRECTS) {
        const validation = await validateSafeCalendarUrl(currentUrl, options.dnsLookup);
        if (!validation.safe || !validation.normalizedUrl) {
          clearTimeout(timeout);
          res.statusCode = 400;
          res.end(
            JSON.stringify({
              error: validation.reason || "URL de calendario no permitida por seguridad.",
              code: "SSRF_BLOCKED",
            })
          );
          return;
        }

        const fetchUrl = validation.normalizedUrl.toString();

        let dispatcher: Agent | undefined;
        if (validation.validatedIp) {
          dispatcher = new Agent({
            connect: {
              lookup: (_hostname, _opts, callback) => {
                callback(null, [
                  {
                    address: validation.validatedIp!,
                    family: validation.validatedFamily ?? 4,
                  },
                ]);
              },
            },
          });
        }

        const fetchFn = options.fetchFn ?? fetch;
        const response = await fetchFn(fetchUrl, {
          signal: controller.signal,
          redirect: "manual",
          ...(dispatcher ? { dispatcher } : {}),
          headers: {
            "User-Agent": "ConsciousTech-CalendarSync/1.0",
            Accept: "text/calendar, application/octet-stream, */*",
          },
        });

        // Check for manual redirect (301, 302, 303, 307, 308)
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          redirectCount++;
          if (redirectCount > MAX_REDIRECTS) {
            clearTimeout(timeout);
            res.statusCode = 502;
            res.end(
              JSON.stringify({
                error: "Demasiadas redirecciones al obtener el calendario.",
                code: "TOO_MANY_REDIRECTS",
              })
            );
            return;
          }

          const location = response.headers.get("location");
          if (!location) {
            clearTimeout(timeout);
            res.statusCode = 502;
            res.end(
              JSON.stringify({
                error: "Respuesta de redirección sin cabecera Location.",
                code: "INVALID_REDIRECT",
              })
            );
            return;
          }

          currentUrl = new URL(location, fetchUrl).toString();
          continue;
        }

        finalResponse = response;
        break;
      }
    } finally {
      clearTimeout(timeout);
    }

    if (!finalResponse) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: "No se recibió respuesta del servidor de calendario.", code: "CALENDAR_FETCH_FAILED" }));
      return;
    }

    if (!finalResponse.ok) {
      res.statusCode = finalResponse.status === 404 ? 404 : 502;
      res.end(
        JSON.stringify({
          error: `Error al obtener el calendario: HTTP ${finalResponse.status} ${finalResponse.statusText}`,
          code: "CALENDAR_FETCH_FAILED",
        })
      );
      return;
    }

    // Stream the body with a strict 5 MB byte cap to prevent memory exhaustion
    if (!finalResponse.body) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: "Cuerpo de respuesta vacío del servidor de calendario.", code: "EMPTY_CALENDAR_BODY" }));
      return;
    }

    const reader = finalResponse.body.getReader();
    let totalBytes = 0;
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > MAX_ICS_BYTES) {
          await reader.cancel();
          res.statusCode = 413;
          res.end(
            JSON.stringify({
              error: "El archivo de calendario excede el tamaño máximo permitido (5MB).",
              code: "ICS_TOO_LARGE",
            })
          );
          return;
        }
        chunks.push(value);
      }
    }

    const icsText = Buffer.concat(chunks).toString("utf-8");

    if (!icsText.includes("BEGIN:VCALENDAR")) {
      res.statusCode = 422;
      res.end(
        JSON.stringify({
          error: "La respuesta no es un feed iCalendar válido (falta BEGIN:VCALENDAR).",
          code: "NOT_ICAL_FORMAT",
        })
      );
      return;
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, ics: icsText }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = message.includes("abort") || message.includes("timeout");
    res.statusCode = isTimeout ? 504 : 502;
    res.end(
      JSON.stringify({
        error: isTimeout ? "Tiempo de espera agotado al conectar con el calendario." : "No se pudo conectar con el servidor de calendario.",
        code: isTimeout ? "CALENDAR_TIMEOUT" : "CALENDAR_NETWORK_ERROR",
      })
    );
  }
}
