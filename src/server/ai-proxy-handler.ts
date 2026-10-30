import type { IncomingMessage, ServerResponse } from "node:http";
import { ExtractItemsInputSchema } from "../domain/items";
import { DetectRelationshipsInputSchema } from "../domain/relationships";
import { GroupWorkInputSchema } from "../domain/work-groups";
import { DetectDeadlinesInputSchema } from "../domain/deadlines";
import { EvaluateContextInputSchema } from "../domain/context";
import { BuildWeekInputSchema } from "../domain/week";
import { GroqProvider } from "../providers/groq-provider";
import { GeminiProvider } from "../providers/gemini-provider";
import { MockProvider } from "../providers/mock-provider";
import { AIProvider } from "../providers/ai-provider";
import { SimpleRateLimiter } from "./rate-limiter";
import { isOriginAllowed } from "./calendar-proxy-handler";
import { logger } from "../utils/logger";

export const MAX_PAYLOAD_BYTES = 50 * 1024; // 50 KB limit for brain dump notes & inputs

export const aiProxyRateLimiter = new SimpleRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 40,
});

export type AIProxyAction =
  | "extract_items"
  | "detect_relationships"
  | "group_work"
  | "detect_deadlines"
  | "evaluate_context"
  | "build_week";

export interface AIProxyRequestBody {
  provider: "groq" | "gemini" | "mock";
  action: AIProxyAction;
  payload: unknown;
}

export function sanitizeErrorMessage(message: string): string {
  // Redact potential API keys matching Groq or Gemini shapes
  return message
    .replace(/gsk_[A-Za-z0-9_-]+/g, "[REDACTED_GROQ_KEY]")
    .replace(/AIza[A-Za-z0-9_-]+/g, "[REDACTED_GEMINI_KEY]")
    .replace(/(?:file:\/\/)?[/\\][A-Za-z0-9_.\-\\/]+(?:\.ts|\.js|\.mjs)/g, "[INTERNAL_PATH]");
}

export function classifyErrorStatus(err: unknown): {
  status: number;
  code: string;
  message: string;
} {
  const originalMsg = err instanceof Error ? err.message : String(err);
  const sanitized = sanitizeErrorMessage(originalMsg);
  const lower = originalMsg.toLowerCase();

  if (
    lower.includes("401") ||
    lower.includes("unauthorized") ||
    lower.includes("invalid api key") ||
    lower.includes("api_key")
  ) {
    return {
      status: 401,
      code: "AUTHENTICATION_ERROR",
      message: "Credencial del proveedor de IA rechazada o no válida (401).",
    };
  }

  if (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("quota") ||
    lower.includes("resource_exhausted")
  ) {
    return {
      status: 429,
      code: "QUOTA_EXCEEDED",
      message: "Límite de tasa o cuota de tokens excedido en el proveedor (429).",
    };
  }

  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("etimedout")) {
    return {
      status: 504,
      code: "TIMEOUT",
      message: "Tiempo de espera agotado al conectar con el proveedor de IA.",
    };
  }

  if (
    lower.includes("schema validation") ||
    lower.includes("invalid input") ||
    lower.includes("zod")
  ) {
    return {
      status: 400,
      code: "INVALID_INPUT_OR_OUTPUT",
      message: `Error de validación de datos: ${sanitized}`,
    };
  }

  return {
    status: 500,
    code: "PROVIDER_ERROR",
    message: sanitized,
  };
}

export function createServerProvider(
  providerType: "groq" | "gemini" | "mock",
  env: Record<string, string | undefined> = process.env
): AIProvider {
  if (providerType === "mock") {
    return new MockProvider();
  }

  if (providerType === "groq") {
    const apiKey = env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error("GROQ_API_KEY no configurada en las variables de entorno del servidor.");
    }
    return new GroqProvider({ apiKey });
  }

  if (providerType === "gemini") {
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY no configurada en las variables de entorno del servidor.");
    }
    return new GeminiProvider({ apiKey });
  }

  throw new Error(`Proveedor no soportado: "${providerType}"`);
}

let hasWarnedMissingAiProxyToken = false;

export function checkAiProxyTokenWarning(
  env: Record<string, string | undefined> = process.env
): void {
  if (!env.AI_PROXY_TOKEN && !hasWarnedMissingAiProxyToken) {
    hasWarnedMissingAiProxyToken = true;
    logger.warn(
      "[AI Proxy] Advertencia: AI_PROXY_TOKEN no está configurado. El proxy opera en modo desarrollo sin autenticación."
    );
  }
}

/**
 * Handles incoming HTTP requests for the secure server-side AI proxy.
 */
export async function handleAIProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  env: Record<string, string | undefined> = process.env
): Promise<void> {
  const originHeader = req.headers?.origin;

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Vary", "Origin");

  if (isOriginAllowed(originHeader, env)) {
    res.setHeader("Access-Control-Allow-Origin", originHeader!);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-ai-proxy-token");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Verify shared secret token if AI_PROXY_TOKEN is configured
  const configuredToken = env.AI_PROXY_TOKEN;
  if (configuredToken) {
    const headerToken = req.headers?.["x-ai-proxy-token"] as string | undefined;
    const authHeader = req.headers?.["authorization"] as string | undefined;
    let bearerToken: string | undefined;
    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      bearerToken = authHeader.slice(7).trim();
    }
    const token = headerToken || bearerToken;
    if (!token || token !== configuredToken) {
      res.statusCode = 401;
      res.end(
        JSON.stringify({
          error: "No autorizado. Token de proxy IA no válido o ausente.",
          code: "UNAUTHORIZED",
        })
      );
      return;
    }
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(
      JSON.stringify({ error: "Método no permitido. Use POST.", code: "METHOD_NOT_ALLOWED" })
    );
    return;
  }

  // Rate limiting check
  const clientIp = req.socket?.remoteAddress || "127.0.0.1";
  const rateLimit = aiProxyRateLimiter.check(clientIp);
  if (!rateLimit.allowed) {
    res.statusCode = 429;
    res.setHeader("Retry-After", String(Math.ceil(rateLimit.resetMs / 1000)));
    res.end(
      JSON.stringify({
        error: "Demasiadas peticiones al proxy de IA. Por favor espera un momento.",
        code: "RATE_LIMIT_EXCEEDED",
      })
    );
    return;
  }

  // 1. Read body with strict size limit
  let rawBody = "";
  let receivedBytes = 0;

  try {
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      receivedBytes += buffer.length;
      if (receivedBytes > MAX_PAYLOAD_BYTES) {
        res.statusCode = 413;
        res.end(
          JSON.stringify({
            error: `Carga útil excede el límite permitido de ${MAX_PAYLOAD_BYTES} bytes.`,
            code: "PAYLOAD_TOO_LARGE",
          })
        );
        return;
      }
      rawBody += buffer.toString("utf8");
    }
  } catch {
    res.statusCode = 400;
    res.end(
      JSON.stringify({ error: "Error leyendo el cuerpo de la petición.", code: "BAD_REQUEST" })
    );
    return;
  }

  // 2. Parse JSON
  let body: AIProxyRequestBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Cuerpo de petición JSON inválido.", code: "INVALID_JSON" }));
    return;
  }

  const { provider: providerType, action, payload } = body;

  if (!providerType || !["groq", "gemini", "mock"].includes(providerType)) {
    res.statusCode = 400;
    res.end(
      JSON.stringify({
        error: "Proveedor no válido. Debe ser 'groq', 'gemini' o 'mock'.",
        code: "INVALID_PROVIDER",
      })
    );
    return;
  }

  if (!action) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Acción requerida.", code: "MISSING_ACTION" }));
    return;
  }

  // 3. Resolve server provider safely
  let providerInstance: AIProvider;
  try {
    providerInstance = createServerProvider(providerType, env);
  } catch (provErr) {
    const errorInfo = classifyErrorStatus(provErr);
    res.statusCode = errorInfo.status;
    res.end(JSON.stringify({ error: errorInfo.message, code: errorInfo.code }));
    return;
  }

  // 4. Validate input payload and execute action
  try {
    let result: unknown;

    switch (action) {
      case "extract_items": {
        const validatedInput = ExtractItemsInputSchema.parse(payload);
        if (!validatedInput.text.trim()) {
          res.statusCode = 400;
          res.end(
            JSON.stringify({
              error: "El texto de entrada no puede estar vacío.",
              code: "EMPTY_INPUT",
            })
          );
          return;
        }
        result = await providerInstance.extractItems(validatedInput);
        break;
      }

      case "detect_relationships": {
        const validatedInput = DetectRelationshipsInputSchema.parse(payload);
        result = await providerInstance.detectRelationships(validatedInput);
        break;
      }

      case "group_work": {
        const validatedInput = GroupWorkInputSchema.parse(payload);
        result = await providerInstance.groupWork(validatedInput);
        break;
      }

      case "detect_deadlines": {
        const validatedInput = DetectDeadlinesInputSchema.parse(payload);
        result = await providerInstance.detectDeadlines(validatedInput);
        break;
      }

      case "evaluate_context": {
        const validatedInput = EvaluateContextInputSchema.parse(payload);
        result = await providerInstance.evaluateContext(validatedInput);
        break;
      }

      case "build_week": {
        const validatedInput = BuildWeekInputSchema.parse(payload);
        if (!providerInstance.buildWeek) {
          res.statusCode = 400;
          res.end(
            JSON.stringify({
              error: `El proveedor '${providerType}' no soporta buildWeek.`,
              code: "ACTION_NOT_SUPPORTED",
            })
          );
          return;
        }
        result = await providerInstance.buildWeek(validatedInput);
        break;
      }

      default:
        res.statusCode = 400;
        res.end(
          JSON.stringify({ error: `Acción '${action}' no reconocida.`, code: "UNKNOWN_ACTION" })
        );
        return;
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, data: result }));
  } catch (execErr) {
    const errorInfo = classifyErrorStatus(execErr);
    res.statusCode = errorInfo.status;
    res.end(JSON.stringify({ error: errorInfo.message, code: errorInfo.code }));
  }
}
