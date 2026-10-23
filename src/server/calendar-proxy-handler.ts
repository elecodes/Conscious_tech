import type { IncomingMessage, ServerResponse } from "node:http";

export const MAX_ICS_BYTES = 5 * 1024 * 1024; // 5 MB limit for calendar export

/**
 * Validates that the provided URL is a safe external HTTP/HTTPS or webcal URL.
 * Prevents SSRF attacks to internal/localhost addresses.
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

    const host = parsed.hostname.toLowerCase();
    // Block local / loopback / private IP ranges
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      host.startsWith("169.254.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Handles incoming requests to fetch an external iCal feed without browser CORS issues.
 */
export async function handleCalendarProxyRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  // CORS & Security headers
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  let targetUrl: string | null = null;

  if (req.method === "GET") {
    const parsedUrl = new URL(req.url || "", "http://localhost");
    targetUrl = parsedUrl.searchParams.get("url");
  } else if (req.method === "POST") {
    let bodyText = "";
    for await (const chunk of req) {
      bodyText += chunk;
      if (bodyText.length > 10 * 1024) {
        res.statusCode = 413;
        res.end(JSON.stringify({ error: "Payload too large", code: "PAYLOAD_TOO_LARGE" }));
        return;
      }
    }

    try {
      const parsed = JSON.parse(bodyText);
      targetUrl = parsed.url;
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Invalid JSON body", code: "INVALID_JSON" }));
      return;
    }
  } else {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }));
    return;
  }

  if (!targetUrl || typeof targetUrl !== "string" || !targetUrl.trim()) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Falta el parámetro 'url' de iCal.", code: "MISSING_URL" }));
    return;
  }

  const cleanUrl = targetUrl.trim();
  if (!isSafeCalendarUrl(cleanUrl)) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "URL de calendario no válida o no permitida.", code: "INVALID_URL" }));
    return;
  }

  const fetchUrl = cleanUrl.startsWith("webcal://")
    ? cleanUrl.replace("webcal://", "https://")
    : cleanUrl;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(fetchUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "ConsciousTech-CalendarSync/1.0",
        Accept: "text/calendar, application/octet-stream, */*",
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      res.statusCode = response.status === 404 ? 404 : 502;
      res.end(
        JSON.stringify({
          error: `Error al obtener el calendario: HTTP ${response.status} ${response.statusText}`,
          code: "CALENDAR_FETCH_FAILED",
        })
      );
      return;
    }

    const icsText = await response.text();
    if (icsText.length > MAX_ICS_BYTES) {
      res.statusCode = 413;
      res.end(JSON.stringify({ error: "El archivo de calendario excede el tamaño máximo permitido (5MB).", code: "ICS_TOO_LARGE" }));
      return;
    }

    if (!icsText.includes("BEGIN:VCALENDAR")) {
      res.statusCode = 422;
      res.end(JSON.stringify({ error: "La respuesta no es un feed iCalendar válido (falta BEGIN:VCALENDAR).", code: "NOT_ICAL_FORMAT" }));
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
