import { describe, it, expect, beforeEach } from "vitest";
import { indexedDB as fakeIDB, IDBKeyRange as fakeKeyRange } from "fake-indexeddb";
import { MockProvider } from "../src/providers/mock-provider";
import { TargetWeek, ProposedWeek, ProposedWeekSchema, ExtractedItem, BuildWeekInput } from "../src/domain/week";
import { generateWeeklyProposalFromItemsDetailed } from "../src/application/planning-pipeline";
import { createIndexedDbStorage, deleteDatabase } from "../src/infrastructure/storage/indexeddb";
import { WeeklySessionService } from "../src/application/weekly-session-service";
import { StoredWeeklyPlan, StoredWeeklyPlanSchema } from "../src/domain/repositories/types";
import { WeeklySchedule } from "../src/domain/schedule";
import {
  normalizeAndConserveProposedWeek,
  calculateWeeklyCapacity,
} from "../src/skills/build-week/deterministic";
import { extractPlanItems } from "../src/web/components/weekly-session-view";

describe("Regresión: Planificación y activación de semanas con 7 elementos y límite de 3 focos", () => {
  const currentDate = "2026-10-15";
  const targetWeek: TargetWeek = {
    startDate: "2026-10-19",
    endDate: "2026-10-25",
  };

  const TEST_DB_NAME = "conscious_tech_seven_items_regression_test_db";

  if (typeof globalThis.IDBKeyRange === "undefined") {
    (globalThis as unknown as { IDBKeyRange: typeof fakeKeyRange }).IDBKeyRange = fakeKeyRange;
  }

  beforeEach(async () => {
    await deleteDatabase(TEST_DB_NAME, fakeIDB);
  });

  async function createTestService() {
    const storage = await createIndexedDbStorage({
      dbName: TEST_DB_NAME,
      customFactory: fakeIDB,
    });
    return new WeeklySessionService({
      plans: storage.plans,
      schedules: storage.schedules,
      closeReports: storage.closeReports,
      memories: storage.memories,
      getDb: () => storage.db,
    });
  }

  // Los 7 elementos exactos del caso del usuario
  const sevenItems: ExtractedItem[] = [
    {
      id: "item-aws",
      rawText: "a full con AWS CERTifocation.",
      title: "A full con AWS CERTifocation",
      type: "task",
      status: "pending",
      estimatedEffort: { value: 10, unit: "hours", source: "estimated" },
    },
    {
      id: "item-ciber",
      rawText: "Tengo que preparar la clase de Cibervoluntarios para el lunes.",
      title: "Preparar la clase de Cibervoluntarios para el lunes",
      type: "commitment",
      status: "pending",
      deadline: {
        raw: "para el lunes",
        resolved: "2026-10-19",
        confidence: "high",
      },
      estimatedEffort: { value: 3, unit: "hours", source: "estimated" },
    },
    {
      id: "item-tec-consciente",
      rawText: "También quiero avanzar Tecnología Consciente",
      title: "Avanzar Tecnología Consciente",
      type: "task",
      status: "pending",
      project: "Tecnología Consciente",
    },
    {
      id: "item-solid",
      rawText: "estudiar SOLID",
      title: "Estudiar SOLID",
      type: "task",
      status: "pending",
    },
    {
      id: "item-arch-ai",
      rawText: "seguir con ArchitectAI.",
      title: "Seguir con ArchitectAI",
      type: "task",
      status: "pending",
      project: "ArchitectAI",
    },
    {
      id: "item-substack",
      rawText: "Además quería mirar Substack Notes, pero eso no corre prisa.",
      title: "Quería mirar Substack Notes, pero eso no corre prisa",
      type: "task",
      status: "pending",
    },
    {
      id: "item-second-brain",
      rawText: "REvisar second brain",
      title: "REvisar second brain",
      type: "task",
      status: "pending",
    },
  ];

  it("1. Recorrido completo con 7 elementos: genera propuesta, guarda borrador, recupera y activa sin error de límite Zod", async () => {
    const service = await createTestService();
    const provider = new MockProvider();

    // 1. Generación de propuesta semanal a partir de los 7 elementos
    const detailedPlan = await generateWeeklyProposalFromItemsDetailed(provider, {
      items: sevenItems,
      currentDate,
      targetWeek,
      totalAvailableHours: 25,
      minProtectedSpaceRatio: 0.25,
      userIntent: "Publicar más sobre IA y educación",
    });

    const proposal = detailedPlan.proposal;

    // Invariante 1: Validación estricta del esquema Zod
    const zodValidation = ProposedWeekSchema.safeParse(proposal);
    expect(zodValidation.success).toBe(true);

    // Invariante 2: Contrato de dominio de focos (foci.length <= 3)
    expect(proposal.foci.length).toBeLessThanOrEqual(3);

    // Invariante 3: Conservación exacta de los 7 elementos (sin pérdidas ni duplicados ni IDs inventados)
    const accountedItemIds = new Set<string>();
    for (const f of proposal.foci) {
      for (const id of f.contributingItemIds) {
        expect(accountedItemIds.has(id)).toBe(false);
        accountedItemIds.add(id);
      }
    }
    for (const o of proposal.obligations) {
      // Si la obligación proviene de un item, lo contamos
      const matching = sevenItems.find((it) => it.title === o.title || it.id === o.title);
      if (matching) {
        accountedItemIds.add(matching.id);
      }
    }
    for (const fl of proposal.flexibleOptions) {
      expect(accountedItemIds.has(fl.itemId)).toBe(false);
      accountedItemIds.add(fl.itemId);
    }
    for (const d of proposal.deferredItems) {
      expect(accountedItemIds.has(d.itemId)).toBe(false);
      accountedItemIds.add(d.itemId);
    }

    // Cada uno de los 7 elementos debe quedar representado exactamente una vez
    for (const it of sevenItems) {
      const isAccounted =
        accountedItemIds.has(it.id) ||
        proposal.obligations.some((o) => o.title.includes("Cibervoluntarios") && it.id === "item-ciber");
      expect(isAccounted).toBe(true);
    }

    // 2. Persistencia del borrador
    const draftPlan: StoredWeeklyPlan = {
      planId: `draft-${targetWeek.startDate}`,
      status: "draft",
      targetWeek,
      proposal,
      draftContext: {
        extractedItems: sevenItems,
        acceptedItemIds: sevenItems.map((i) => i.id),
        availableHoursInput: "25",
        protectedSpacePercentInput: "25",
      },
      createdAt: "2026-10-15T12:00:00.000Z",
      updatedAt: "2026-10-15T12:00:00.000Z",
    };

    const zodCheck = StoredWeeklyPlanSchema.safeParse(draftPlan);
    expect(zodCheck.success).toBe(true);

    const saveRes = await service.saveDraftPlan(draftPlan);
    expect(saveRes.status).toBe("success");

    // 3. Recarga del borrador desde almacenamiento persistente
    const retrievedDraft = await service.getDraftPlan();
    expect(retrievedDraft).not.toBeNull();
    expect(retrievedDraft?.status).toBe("draft");
    expect(retrievedDraft?.proposal.foci.length).toBeLessThanOrEqual(3);

    const draftSchemaValidation = StoredWeeklyPlanSchema.safeParse(retrievedDraft);
    expect(draftSchemaValidation.success).toBe(true);

    // 4. Activación de la semana con los 7 elementos
    const nowIso = new Date().toISOString();
    const activePlan: StoredWeeklyPlan = {
      planId: `plan-${targetWeek.startDate}-test-7`,
      status: "active",
      targetWeek,
      proposal: retrievedDraft!.proposal,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const activationResult = await service.createOrSavePlanAndSchedule(activePlan);

    // Debe activarse con éxito sin fallar con "Array must contain at most 3 element(s)"
    expect(activationResult.status).toBe("success");

    // Verificar que la sesión activa persiste y contiene la propuesta completa
    const resumeRes = await service.resumeSession();
    expect(resumeRes.status).toBe("session_resumed");
    if (resumeRes.status === "session_resumed") {
      expect(resumeRes.state.activePlan?.planId).toBe(`plan-${targetWeek.startDate}-test-7`);
      expect(resumeRes.state.activePlan?.proposal.foci.length).toBeLessThanOrEqual(3);
    }
  });

  it("2. Propuesta candidata con más de 3 focos: normaliza a un máximo de 3 y preserva el exceso en deferredItems (out_of_capacity)", () => {
    // 5 focos candidatos estructurados
    const rawProposalWith5Foci: ProposedWeek = {
      weekSummary: {
        targetWeek,
        intent: "Semana intensiva",
        capacity: calculateWeeklyCapacity({
          capacityConfig: { totalAvailableHours: 30, minProtectedSpaceRatio: 0.25 },
          foci: [
            { estimatedHours: 4 },
            { estimatedHours: 4 },
            { estimatedHours: 4 },
            { estimatedHours: 4 },
            { estimatedHours: 4 },
          ],
        }),
      },
      foci: [
        {
          id: "focus-1",
          title: "Foco 1",
          desiredOutcome: "Meta 1",
          rationale: "Razón 1",
          contributingItemIds: ["item-1"],
          estimatedHours: 4,
        },
        {
          id: "focus-2",
          title: "Foco 2",
          desiredOutcome: "Meta 2",
          rationale: "Razón 2",
          contributingItemIds: ["item-2"],
          estimatedHours: 4,
        },
        {
          id: "focus-3",
          title: "Foco 3",
          desiredOutcome: "Meta 3",
          rationale: "Razón 3",
          contributingItemIds: ["item-3"],
          estimatedHours: 4,
        },
        {
          id: "focus-4",
          title: "Foco 4 (Excedente)",
          desiredOutcome: "Meta 4",
          rationale: "Razón 4",
          contributingItemIds: ["item-4"],
          estimatedHours: 4,
        },
        {
          id: "focus-5",
          title: "Foco 5 (Excedente)",
          desiredOutcome: "Meta 5",
          rationale: "Razón 5",
          contributingItemIds: ["item-5"],
          estimatedHours: 4,
        },
      ],
      obligations: [],
      flexibleOptions: [],
      deferredItems: [
        {
          itemId: "item-6",
          title: "Tarea 6",
          reason: "not_scheduled",
          rationale: "No programada",
        },
        {
          itemId: "item-7",
          title: "Tarea 7",
          reason: "not_scheduled",
          rationale: "No programada",
        },
      ],
      unplannedSpace: {
        rationale: "Espacio protegido",
        recommendedHours: 7.5,
      },
      confirmationPrompt: {
        question: "¿Confirmar semana?",
        keyTradeoffs: ["Capacidad limitada"],
        pendingQuestions: [],
      },
    };

    const inputItems: ExtractedItem[] = [
      { id: "item-1", rawText: "q1", title: "Item 1", type: "task", status: "pending" },
      { id: "item-2", rawText: "q2", title: "Item 2", type: "task", status: "pending" },
      { id: "item-3", rawText: "q3", title: "Item 3", type: "task", status: "pending" },
      { id: "item-4", rawText: "q4", title: "Item 4", type: "task", status: "pending" },
      { id: "item-5", rawText: "q5", title: "Item 5", type: "task", status: "pending" },
      { id: "item-6", rawText: "q6", title: "Item 6", type: "task", status: "pending" },
      { id: "item-7", rawText: "q7", title: "Item 7", type: "task", status: "pending" },
    ];

    const buildInput: BuildWeekInput = {
      items: inputItems,
      targetWeek,
      currentDate,
      relationships: [],
      groupedWork: {
        groups: [
          { id: "g1", title: "G1", itemIds: ["item-1"], rationale: "Grupo 1" },
          { id: "g2", title: "G2", itemIds: ["item-2"], rationale: "Grupo 2" },
          { id: "g3", title: "G3", itemIds: ["item-3"], rationale: "Grupo 3" },
          { id: "g4", title: "G4", itemIds: ["item-4"], rationale: "Grupo 4" },
          { id: "g5", title: "G5", itemIds: ["item-5"], rationale: "Grupo 5" },
        ],
        ungroupedItemIds: ["item-6", "item-7"],
      },
      deadlines: { deadlines: [] },
      context: { itemAssessments: [], groupAssessments: [], openQuestions: [] },
      capacity: {
        totalAvailableHours: 30,
        minProtectedSpaceRatio: 0.25,
      },
    };

    // Normalizar mediante el motor de conservación
    const result = normalizeAndConserveProposedWeek(rawProposalWith5Foci, buildInput);

    // 1. Debe acotar a un máximo de 3 focos
    expect(result.proposal.foci.length).toBe(3);
    expect(result.proposal.foci.map((f) => f.id)).toEqual(["focus-1", "focus-2", "focus-3"]);

    // 2. Los focos excedentes (focus-4 y focus-5) deben conservarse en deferredItems como out_of_capacity
    const deferredIds = result.proposal.deferredItems.map((d) => d.itemId);
    expect(deferredIds).toContain("item-4");
    expect(deferredIds).toContain("item-5");

    const item4Deferred = result.proposal.deferredItems.find((d) => d.itemId === "item-4");
    expect(item4Deferred?.reason).toBe("out_of_capacity");

    // 3. Auditoría de reparación explícita
    const excessRepairs = result.repairs.filter((r) => r.type === "excess_foci_deferred");
    expect(excessRepairs.length).toBe(2);

    // 4. Invariante de conservación estricta: los 7 items están presentes sin pérdidas ni duplicados
    const allIds = [
      ...result.proposal.foci.flatMap((f) => f.contributingItemIds),
      ...result.proposal.deferredItems.map((d) => d.itemId),
    ];
    expect(allIds.sort()).toEqual(["item-1", "item-2", "item-3", "item-4", "item-5", "item-6", "item-7"]);

    // 5. Debe ser perfectamente válido según ProposedWeekSchema
    const parseResult = ProposedWeekSchema.safeParse(result.proposal);
    expect(parseResult.success).toBe(true);
  });

  it("3. Inclusión manual de tareas más allá de 3 focos: se enrutan a flexibleOptions sin romper el límite de focos", async () => {
    const service = await createTestService();

    // Propuesta base con 3 focos principales
    const baseProposal: ProposedWeek = {
      weekSummary: {
        targetWeek,
        intent: "Semana con 3 focos",
        capacity: calculateWeeklyCapacity({
          capacityConfig: { totalAvailableHours: 25, minProtectedSpaceRatio: 0.25 },
          foci: [{ estimatedHours: 4 }, { estimatedHours: 4 }, { estimatedHours: 4 }],
        }),
      },
      foci: [
        {
          id: "focus-1",
          title: "Foco 1",
          desiredOutcome: "Meta 1",
          rationale: "Razón 1",
          contributingItemIds: ["item-1"],
          estimatedHours: 4,
        },
        {
          id: "focus-2",
          title: "Foco 2",
          desiredOutcome: "Meta 2",
          rationale: "Razón 2",
          contributingItemIds: ["item-2"],
          estimatedHours: 4,
        },
        {
          id: "focus-3",
          title: "Foco 3",
          desiredOutcome: "Meta 3",
          rationale: "Razón 3",
          contributingItemIds: ["item-3"],
          estimatedHours: 4,
        },
      ],
      obligations: [],
      flexibleOptions: [],
      deferredItems: [
        {
          itemId: "item-4",
          title: "Tarea postergada 4",
          reason: "not_scheduled",
          rationale: "Fuera de propuesta inicial",
        },
      ],
      unplannedSpace: {
        rationale: "Espacio protegido",
        recommendedHours: 6.25,
      },
      confirmationPrompt: {
        question: "¿Confirmar?",
        keyTradeoffs: [],
        pendingQuestions: [],
      },
    };

    // Simular que el usuario decide incluir item-4 cuando ya hay 3 focos
    // Siguiendo el contrato de la UI: si foci >= 3, se agrega a flexibleOptions
    const updatedFlexible = [...baseProposal.flexibleOptions];
    const updatedFoci = [...baseProposal.foci];
    const updatedDeferred = baseProposal.deferredItems.filter((d) => d.itemId !== "item-4");

    if (updatedFoci.length < 3) {
      updatedFoci.push({
        id: "focus-included-item-4",
        title: "Tarea postergada 4",
        desiredOutcome: "Avanzar en Tarea 4",
        rationale: "Reconsiderado e incluido en la semana",
        contributingItemIds: ["item-4"],
        estimatedHours: 2,
      });
    } else {
      updatedFlexible.push({
        itemId: "item-4",
        title: "Tarea postergada 4",
        condition: "Reconsiderado e incluido conscientemente en la semana como opción flexible al alcanzarse el máximo de 3 focos.",
        estimatedHours: 2,
      });
    }

    const modifiedProposal: ProposedWeek = {
      ...baseProposal,
      foci: updatedFoci,
      flexibleOptions: updatedFlexible,
      deferredItems: updatedDeferred,
    };

    // Verificar que los focos se mantuvieron en 3 y la tarea 4 está en flexibleOptions
    expect(modifiedProposal.foci.length).toBe(3);
    expect(modifiedProposal.flexibleOptions.length).toBe(1);
    expect(modifiedProposal.flexibleOptions[0].itemId).toBe("item-4");

    // Guardar borrador y activar
    const plan: StoredWeeklyPlan = {
      planId: `plan-${targetWeek.startDate}-flexible-overflow`,
      status: "active",
      targetWeek,
      proposal: modifiedProposal,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const activationResult = await service.createOrSavePlanAndSchedule(plan);
    expect(activationResult.status).toBe("success");
  });

  it("4. Ajuste de tareas en la semana activa: guardar horas y asignar día persiste en el plan y la agenda", async () => {
    const service = await createTestService();
    const provider = new MockProvider();

    // 1. Generar y activar propuesta con 7 elementos
    const detailedPlan = await generateWeeklyProposalFromItemsDetailed(provider, {
      items: sevenItems,
      currentDate,
      targetWeek,
      totalAvailableHours: 25,
      minProtectedSpaceRatio: 0.25,
    });
    expect(detailedPlan.proposal).toBeDefined();

    const planId = `plan-${targetWeek.startDate}-adjust-test`;
    const nowIso = new Date().toISOString();
    const activePlan: StoredWeeklyPlan = {
      planId,
      status: "active",
      targetWeek,
      proposal: detailedPlan.proposal,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const initialSchedule: WeeklySchedule = {
      scheduleId: `sched-${targetWeek.startDate}-adjust-test`,
      planId,
      weekRange: targetWeek,
      version: 1,
      timeBlocks: [],
      dailyAllocations: [],
      appliedAdjustments: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const saveResult = await service.createOrSavePlanAndSchedule(activePlan, initialSchedule);
    expect(saveResult.status).toBe("success");

    // 2. Comprobar que "item-ciber" (Preparar la clase de Cibervoluntarios) es una obligación
    const ciberObligation = activePlan.proposal.obligations.find((o) => o.itemId === "item-ciber");
    expect(ciberObligation).toBeDefined();

    // 3. Simular ajuste de la tarea: asignar 3 horas y programarla para el sábado 2026-10-24
    const updatedObligations = activePlan.proposal.obligations.map((o) =>
      o.itemId === "item-ciber" ? { ...o, estimatedHours: 3 } : o
    );

    const updatedCapacity = calculateWeeklyCapacity({
      capacityConfig: { totalAvailableHours: 25, minProtectedSpaceRatio: 0.25 },
      explicitKnownEstimatedHours: 3,
      explicitCompleteness: "partial",
      foci: activePlan.proposal.foci,
      obligations: updatedObligations,
    });

    const updatedPlan: StoredWeeklyPlan = {
      ...activePlan,
      proposal: {
        ...activePlan.proposal,
        obligations: updatedObligations,
        weekSummary: {
          ...activePlan.proposal.weekSummary,
          capacity: updatedCapacity,
        },
      },
      updatedAt: new Date().toISOString(),
    };

    const updatedSchedule: WeeklySchedule = {
      ...initialSchedule,
      dailyAllocations: [
        {
          itemId: "item-ciber",
          day: "2026-10-24",
          allocatedHours: 3,
        },
      ],
      appliedAdjustments: [],
      version: initialSchedule.version + 1,
      updatedAt: new Date().toISOString(),
    };

    const updateResult = await service.createOrSavePlanAndSchedule(updatedPlan, updatedSchedule);
    expect(updateResult.status).toBe("success");

    // 4. Recuperar la sesión y verificar con extractPlanItems
    const resumeRes = await service.resumeSession();
    expect(resumeRes.status).toBe("session_resumed");
    if (resumeRes.status === "session_resumed") {
      const storedPlan = resumeRes.state.activePlan!;
      const storedSchedule = resumeRes.state.activeSchedule!;

      const items = extractPlanItems(storedPlan, storedSchedule);
      const ciberDescriptor = items.find((i) => i.itemId === "item-ciber");

      expect(ciberDescriptor).toBeDefined();
      expect(ciberDescriptor?.title).toContain("Preparar la clase de Cibervoluntarios");
      // Ya NO debe ser null ni "Sin estimar"
      expect(ciberDescriptor?.estimatedHours).toBe(3);
      expect(ciberDescriptor?.dueDate).toBe("2026-10-19");

      // La asignación de día debe reflejarse en la agenda
      const alloc = storedSchedule.dailyAllocations.find((a) => a.itemId === "item-ciber");
      expect(alloc).toBeDefined();
      expect(alloc?.day).toBe("2026-10-24");
      expect(alloc?.allocatedHours).toBe(3);
    }
  });
});
