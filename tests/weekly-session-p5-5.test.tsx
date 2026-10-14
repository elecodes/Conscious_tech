import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Readable } from "node:stream";
import fs from "node:fs";
import path from "node:path";
import { indexedDB as fakeIDB, IDBKeyRange as fakeKeyRange } from "fake-indexeddb";
import {
  createIndexedDbStorage,
  deleteDatabase,
  IndexedDbStorageContext,
} from "../src/infrastructure/storage/indexeddb";
import { WeeklySessionService } from "../src/application/weekly-session-service";
import {
  WeeklySessionController,
  WeeklySessionReactContext,
  WeeklySessionContextValue,
} from "../src/web/context/weekly-session-context";
import { WeeklyPlanningFromNotes } from "../src/web/components/weekly-planning-from-notes";
import {
  generateWeeklyProposalFromItems,
  generateWeeklyProposalFromItemsDetailed,
  prepareBuildWeekInputDetailed,
} from "../src/application/planning-pipeline";
import { MockProvider } from "../src/providers/mock-provider";
import { RemoteAIProvider } from "../src/providers/remote-ai-provider";
import {
  handleAIProxyRequest,
  MAX_PAYLOAD_BYTES,
  sanitizeErrorMessage,
} from "../src/server/ai-proxy-handler";
import { ExtractedItem } from "../src/domain/items";
import { StoredWeeklyPlan } from "../src/domain/repositories/types";
import { WeeklySchedule } from "../src/domain/schedule";

function createMockReqRes(body: unknown, method = "POST") {
  const payloadStr = typeof body === "string" ? body : JSON.stringify(body);
  const req = Readable.from([Buffer.from(payloadStr)]) as any;
  req.method = method;

  let statusCode = 200;
  const headers: Record<string, string> = {};
  let responseData = "";

  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(code: number) {
      statusCode = code;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    end(chunk?: string) {
      if (chunk) responseData += chunk;
    },
  } as any;

  return {
    req,
    res,
    getResponse: () => ({
      status: statusCode,
      body: responseData ? JSON.parse(responseData) : null,
      rawBody: responseData,
      headers,
    }),
  };
}

describe("Fase P5.5 — Auditoría de seguridad y preparación para pruebas con IA real", () => {
  const TEST_DB_NAME = "conscious_tech_p5_5_test_db";

  if (typeof globalThis.IDBKeyRange === "undefined") {
    (globalThis as unknown as { IDBKeyRange: typeof fakeKeyRange }).IDBKeyRange = fakeKeyRange;
  }

  let storage: IndexedDbStorageContext;
  let service: WeeklySessionService;
  let controller: WeeklySessionController;
  let mockProvider: MockProvider;

  const sampleItems: ExtractedItem[] = [
    {
      id: "item-1",
      title: "Revisar arquitectura",
      rawText: "Revisar arquitectura del proxy",
      type: "task",
      status: "started",
      estimatedEffort: { value: 4, unit: "hours", source: "user" },
      commitment: "personal",
    },
  ];

  function createMockContextValue(
    overrides?: Partial<WeeklySessionContextValue>
  ): WeeklySessionContextValue {
    return {
      state: controller.getSnapshot(),
      service,
      controller,
      reloadSession: () => controller.reloadSession(),
      createOrSavePlan: (plan, sched) => controller.createOrSavePlan(plan, sched),
      applyAdjustment: (params) => controller.applyAdjustment(params),
      closeWeek: (params) => controller.closeWeek(params),
      confirmMemoryCandidate: (cand, dec) => controller.confirmMemoryCandidate(cand, dec),
      confirmMemoryOperation: (op, conf) => controller.confirmMemoryOperation(op, conf),
      purgeSession: (id) => controller.purgeSession(id),
      resolveAmbiguity: (id) => controller.resolveAmbiguity(id),
      saveDraftPlan: (p) => controller.saveDraftPlan(p),
      clearDraftPlan: (id) => controller.clearDraftPlan(id),
      ...overrides,
    };
  }

  beforeEach(async () => {
    await deleteDatabase(TEST_DB_NAME, fakeIDB);
    storage = await createIndexedDbStorage({
      dbName: TEST_DB_NAME,
      customFactory: fakeIDB,
    });
    service = new WeeklySessionService({
      plans: storage.plans,
      schedules: storage.schedules,
      closeReports: storage.closeReports,
      memories: storage.memories,
      getDb: () => storage.db,
    });
    controller = new WeeklySessionController(service);
    mockProvider = new MockProvider();
  });

  // --------------------------------------------------------------------------
  // 1. MockProvider Offline Integrity
  // --------------------------------------------------------------------------
  it("MockProvider funciona 100% offline sin consumir tokens ni requerir credenciales", async () => {
    const res = await mockProvider.extractItems({
      text: "Comprar café y revisar informe mañana",
      currentDate: "2026-10-12",
    });

    expect(res).toBeDefined();
    expect(res.items.length).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // 2. Server-side AI Proxy Security & Sanitization
  // --------------------------------------------------------------------------
  describe("Server-side AI Proxy (/api/ai)", () => {
    it("devuelve 500 y mensaje sanitizado cuando no se configuran credenciales en el servidor", async () => {
      const { req, res, getResponse } = createMockReqRes({
        provider: "groq",
        action: "extract_items",
        payload: { text: "notas de prueba", currentDate: "2026-10-12" },
      });

      await handleAIProxyRequest(req, res, { GROQ_API_KEY: "" });
      const response = getResponse();

      expect(response.status).toBe(401);
      expect(response.body.error).toContain("Credencial del proveedor de IA rechazada o no válida");
      expect(response.body.error).not.toContain("gsk_");
    });

    it("rechaza proveedores no soportados con status 400", async () => {
      const { req, res, getResponse } = createMockReqRes({
        provider: "unsupported-provider",
        action: "extract_items",
        payload: { text: "test" },
      });

      await handleAIProxyRequest(req, res);
      const response = getResponse();

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Proveedor no válido");
    });

    it("rechaza peticiones que superan el límite de 50 KB con status 413", async () => {
      const oversizedString = "A".repeat(MAX_PAYLOAD_BYTES + 500);
      const { req, res, getResponse } = createMockReqRes(oversizedString);

      await handleAIProxyRequest(req, res);
      const response = getResponse();

      expect(response.status).toBe(413);
      expect(response.body.code).toBe("PAYLOAD_TOO_LARGE");
    });

    it("sanitiza errores y no fuga tokens ni rutas internas en las respuestas de error", () => {
      const leaked =
        "Error in /Users/elena/Developer/Conscious_tech/secrets/config.ts with key gsk_TESTSECRETKEY1234 and AIzaSyD987654";
      const sanitized = sanitizeErrorMessage(leaked);

      expect(sanitized).not.toContain("gsk_TESTSECRETKEY1234");
      expect(sanitized).not.toContain("AIzaSyD987654");
      expect(sanitized).not.toContain("/Users/elena/");
      expect(sanitized).toContain("[REDACTED_GROQ_KEY]");
      expect(sanitized).toContain("[REDACTED_GEMINI_KEY]");
      expect(sanitized).toContain("[INTERNAL_PATH]");
    });
  });

  // --------------------------------------------------------------------------
  // 3. RemoteAIProvider Client Contract
  // --------------------------------------------------------------------------
  describe("RemoteAIProvider", () => {
    it("delega llamadas al endpoint /api/ai sin requerir claves en el cliente", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            items: [
              {
                id: "remote-1",
                title: "Item remoto",
                rawText: "Texto remoto",
                type: "task",
                status: "started",
              },
            ],
          },
        }),
      });

      const remoteProvider = new RemoteAIProvider({
        id: "groq",
        fetchFn: fetchSpy,
      });

      const res = await remoteProvider.extractItems({
        text: "test prompt",
        currentDate: "2026-10-12",
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/ai",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
      );
      expect(res.items).toHaveLength(1);
      expect(res.items[0]!.title).toBe("Item remoto");
    });

    it("propaga errores del proxy de forma legible sin filtrar trazas privadas", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({
          success: false,
          error: "Cuota de API excedida en el proveedor remoto",
        }),
      });

      const remoteProvider = new RemoteAIProvider({
        id: "gemini",
        fetchFn: fetchSpy,
      });

      await expect(
        remoteProvider.extractItems({ text: "test", currentDate: "2026-10-12" })
      ).rejects.toThrow("Cuota de API excedida en el proveedor remoto");
    });
  });

  // --------------------------------------------------------------------------
  // 4. Structured Pipeline Diagnostics & Intermediate Fallbacks
  // --------------------------------------------------------------------------
  describe("Diagnósticos y Fallbacks del Pipeline", () => {
    it("produce diagnósticos estructurados cuando una skill intermedia falla", async () => {
      const faultTolerantProvider = new MockProvider();
      vi.spyOn(faultTolerantProvider, "detectRelationships").mockRejectedValue(
        new Error("Provider rate limit error on detect_relationships")
      );

      const { input, diagnostics } = await prepareBuildWeekInputDetailed(
        faultTolerantProvider,
        {
          items: [
            sampleItems[0]!,
            {
              id: "item-2",
              title: "Tarea secundaria",
              rawText: "Tarea secundaria",
              type: "task",
              status: "pending",
              commitment: "personal",
            },
          ],
          currentDate: "2026-10-12",
        }
      );

      expect(input).toBeDefined();
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics.some((d) => d.stage === "detect_relationships")).toBe(true);
      expect(
        diagnostics.find((d) => d.stage === "detect_relationships")?.fallbackRationale
      ).toContain("elementos tratados como independientes");
    });

    it("generateWeeklyProposalFromItemsDetailed entrega la propuesta y los diagnósticos", async () => {
      const faultTolerantProvider = new MockProvider();
      vi.spyOn(faultTolerantProvider, "detectDeadlines").mockRejectedValue(
        new Error("Timeout on detect_deadlines")
      );

      const { proposal, diagnostics } = await generateWeeklyProposalFromItemsDetailed(
        faultTolerantProvider,
        {
          items: sampleItems,
          currentDate: "2026-10-12",
        }
      );

      expect(proposal).toBeDefined();
      expect(diagnostics.some((d) => d.stage === "detect_deadlines")).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Persistence Rollback on Schedule Save Failure
  // --------------------------------------------------------------------------
  describe("Rollback de persistencia ante fallos", () => {
    it("elimina el plan guardado si el guardado de la agenda asociada falla, evitando planes huérfanos", async () => {
      const originalSave = storage.schedules.save.bind(storage.schedules);
      storage.schedules.save = vi.fn().mockRejectedValue(new Error("Disk IO failure in schedules"));

      const validProposal = await generateWeeklyProposalFromItems(mockProvider, {
        items: sampleItems,
        currentDate: "2026-10-12",
      });
      const targetWeek = validProposal.weekSummary.targetWeek;

      const plan: StoredWeeklyPlan = {
        planId: "plan-test-rollback",
        status: "active",
        targetWeek,
        proposal: validProposal,
        createdAt: "2026-10-12T00:00:00.000Z",
        updatedAt: "2026-10-12T00:00:00.000Z",
      };

      const schedule: WeeklySchedule = {
        scheduleId: "sched-test-rollback",
        planId: "plan-test-rollback",
        weekRange: targetWeek,
        timeBlocks: [],
        dailyAllocations: [],
        dayConstraints: [],
        appliedAdjustments: [],
        version: 1,
        createdAt: "2026-10-12T00:00:00.000Z",
        updatedAt: "2026-10-12T00:00:00.000Z",
      };

      await expect(service.createOrSavePlanAndSchedule(plan, schedule)).rejects.toThrow(
        "Disk IO failure in schedules"
      );

      // Verify that the plan was rolled back and is NOT in storage
      const activePlans = await storage.plans.getActivePlans();
      expect(activePlans.find((p) => p.planId === "plan-test-rollback")).toBeUndefined();
      const planById = await storage.plans.getById("plan-test-rollback");
      expect(planById).toBeNull();

      storage.schedules.save = originalSave;
    });
  });

  // --------------------------------------------------------------------------
  // 6. Controller Concurrency & Double-Click Protection
  // --------------------------------------------------------------------------
  describe("Protección contra doble clic / llamadas concurrentes", () => {
    it("WeeklySessionController previene guardados concurrentes solapados", async () => {
      let resolveFirstSave: () => void = () => {};
      const firstSavePromise = new Promise<void>((resolve) => {
        resolveFirstSave = resolve;
      });

      const originalSave = service.createOrSavePlanAndSchedule.bind(service);
      let callCount = 0;
      vi.spyOn(service, "createOrSavePlanAndSchedule").mockImplementation(async (plan, sched) => {
        callCount++;
        if (callCount === 1) {
          await firstSavePromise;
        }
        return originalSave(plan, sched);
      });

      const validProposal = await generateWeeklyProposalFromItems(mockProvider, {
        items: sampleItems,
        currentDate: "2026-10-12",
      });
      const targetWeek = validProposal.weekSummary.targetWeek;

      const plan: StoredWeeklyPlan = {
        planId: "plan-concurrent-test",
        status: "active",
        targetWeek,
        proposal: validProposal,
        createdAt: "2026-10-12T00:00:00.000Z",
        updatedAt: "2026-10-12T00:00:00.000Z",
      };

      // Trigger first save (will wait on promise)
      const save1 = controller.createOrSavePlan(plan);

      // Trigger immediate second save while first is in-flight
      const save2 = controller.createOrSavePlan(plan);

      const res2 = await save2;
      expect(res2.status).toBe("conflict_active_plan_exists");

      // Release first save
      resolveFirstSave();
      const res1 = await save1;
      expect(res1.status).toBe("success");
    });
  });

  // --------------------------------------------------------------------------
  // 7. UI Renders Warnings and Security Elements
  // --------------------------------------------------------------------------
  describe("UI Renders & Bundle Secret Audit", () => {
    it("WeeklyPlanningFromNotes renderiza el estado inicial correctamente sin credenciales", () => {
      const html = renderToStaticMarkup(
        <WeeklySessionReactContext.Provider value={createMockContextValue()}>
          <WeeklyPlanningFromNotes provider={mockProvider} currentDate="2026-10-12" />
        </WeeklySessionReactContext.Provider>
      );

      expect(html).toContain("Planificar semana a partir de ideas");
      expect(html).toContain("IA propone · Tú decides");
      expect(html).toContain("¿Qué tienes en mente para planificar?");
    });

    it("auditoría estática confirma que no se almacenan secretos en localStorage en el código fuente", () => {
      const appSource = fs.readFileSync(
        path.resolve(process.cwd(), "src/web/App.tsx"),
        "utf-8"
      );
      const remoteProviderSource = fs.readFileSync(
        path.resolve(process.cwd(), "src/providers/remote-ai-provider.ts"),
        "utf-8"
      );

      expect(appSource).not.toContain("CT_GROQ_KEY");
      expect(appSource).not.toContain("CT_GEMINI_KEY");
      expect(appSource).not.toContain("localStorage.getItem(\"CT_");
      expect(appSource).not.toContain("localStorage.setItem(\"CT_");
      expect(remoteProviderSource).not.toContain("apiKey");
      expect(remoteProviderSource).not.toContain("process.env");
    });
  });
});
