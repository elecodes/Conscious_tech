import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAIProvider, ProviderType } from "../src/providers/factory";
import { extractItems } from "../src/skills/extract-items";
import { detectRelationships } from "../src/skills/detect-relationships";
import { groupWork } from "../src/skills/group-work";
import { validateGroupWorkInvariants } from "../src/skills/group-work/deterministic";
import { ExtractedItem } from "../src/domain/items";
import {
  Relationship,
  DetectedRelationshipsSchema,
} from "../src/domain/relationships";
import { detectDeadlines } from "../src/skills/detect-deadlines";
import { validateDeadlinesInvariants } from "../src/skills/detect-deadlines/deterministic";
import { DetectedDeadline, DetectedDeadlines } from "../src/domain/deadlines";
import { evaluateContext } from "../src/skills/evaluate-context";
import { validateContextInvariants } from "../src/skills/evaluate-context/deterministic";
import { EvaluateContextOutput } from "../src/domain/context";
import {
  buildWeekWithAudit,
  evaluateProposedWeekSemanticQuality,
} from "../src/skills/build-week";
import {
  validateProposedWeekInvariants,
  BuildWeekInput,
  ProposedWeek,
} from "../src/domain/week";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile() {
  const envPath = path.resolve(__dirname, "../.env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [key, ...rest] = trimmed.split("=");
      if (key && rest.length > 0) {
        const val = rest.join("=").trim().replace(/^["']|["']$/g, "");
        if (!process.env[key.trim()]) {
          process.env[key.trim()] = val;
        }
      }
    }
  }
}

loadEnvFile();

export interface BuildWeekCaseEvaluationRecord {
  caseId: string;
  title: string;
  provider: string;
  model: string;
  executedAt?: string;
  status: "success" | "repaired_success" | "semantic_failure" | "invalid_response" | "provider_error";
  metrics: {
    durationMs: number;
    latencyRating?: "fast" | "acceptable" | "slow";
    tokens?: {
      prompt?: number;
      completion?: number;
      total?: number;
    };
  };
  history?: Array<Omit<BuildWeekCaseEvaluationRecord, "history">>;
  parsing: {
    success: boolean;
    repaired: boolean;
    repairsCount: number;
    repairs: Array<{ type: string; itemId?: string; description: string }>;
  };
  invariants: {
    valid: boolean;
    errors: string[];
  };
  semanticChecks?: {
    valid: boolean;
    status: "success" | "semantic_failure";
    errors: string[];
    warnings: string[];
    checks: {
      explicitCommitmentsPreserved: boolean;
      ideasNotObligations: boolean;
      dependenciesBackedByExplicitDependsOn: boolean;
      archivedItemsPreserved: boolean;
      noInventedEstimates: boolean;
      honestCapacityStatus: boolean;
      highImportanceNotFlexible?: boolean;
      deadlinesPreservedWithoutShifting?: boolean;
    };
  };
  conservation: {
    inputCount: number;
    outputCount: number;
    isConserved1to1: boolean;
  };
  classification: {
    fociCount: number;
    obligationsCount: number;
    flexibleOptionsCount: number;
    deferredCount: number;
    deferredReasons: Record<string, number>;
  };
  fociReview: Array<{
    title: string;
    contributingItemIds: string[];
    desiredOutcome: string;
    estimatedHours: number | null;
  }>;
  proposal?: ProposedWeek;
  error?: {
    message: string;
    type: string;
    issues?: unknown[];
  };
}

export function mergeConsolidatedWeekResults(
  existingRecords: Record<string, BuildWeekCaseEvaluationRecord>,
  newRecords: Record<string, BuildWeekCaseEvaluationRecord>
): Record<string, BuildWeekCaseEvaluationRecord> {
  const merged: Record<string, BuildWeekCaseEvaluationRecord> = { ...existingRecords };

  for (const [caseId, incoming] of Object.entries(newRecords)) {
    const existing = merged[caseId];

    if (!existing) {
      merged[caseId] = incoming;
      continue;
    }

    const isExistingReal = existing.provider !== "mock";
    const isIncomingMock = incoming.provider === "mock";

    if (isExistingReal && isIncomingMock) {
      // Rule: Never let a mock run silently overwrite or replace a real Groq/external evaluation.
      // Append the mock execution to history so there is a record, but keep the real result active.
      const history = [...(existing.history || [])];
      const { history: _, ...incomingWithoutHistory } = incoming;
      history.push(incomingWithoutHistory);
      merged[caseId] = {
        ...existing,
        history,
      };
      continue;
    }

    // If incoming is real, or existing is mock:
    // Update active record to incoming, pushing previous active record to history.
    const history = [...(existing.history || [])];
    const { history: _, ...existingWithoutHistory } = existing;
    history.push(existingWithoutHistory);

    merged[caseId] = {
      ...incoming,
      history,
    };
  }

  return merged;
}

interface CaseDump {
  id: string;
  title: string;
  text: string;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  checks: {
    validIds: boolean;
    noSelfRelations: boolean;
    noDuplicateRelations: boolean;
    canonicalTypes: boolean;
    nonEmptyReasons: boolean;
    validConfidence: boolean;
    schemaCompliant: boolean;
  };
}

function validateDetectedRelationships(
  relationships: Relationship[],
  items: ExtractedItem[]
): ValidationResult {
  const errors: string[] = [];
  const validIds = new Set(items.map((i) => i.id));
  const seenKeys = new Set<string>();

  let validIdsCheck = true;
  let noSelfRelationsCheck = true;
  let noDuplicateRelationsCheck = true;
  let canonicalTypesCheck = true;
  let nonEmptyReasonsCheck = true;
  let validConfidenceCheck = true;

  const validTypes = [
    "same_project",
    "same_objective",
    "related_to",
    "part_of",
    "depends_on",
    "duplicate",
  ];
  const validConfidences = ["high", "medium", "low"];

  for (const r of relationships) {
    if (!validIds.has(r.sourceItemId)) {
      validIdsCheck = false;
      errors.push(`sourceItemId "${r.sourceItemId}" no existe en los items extraídos`);
    }
    if (!validIds.has(r.targetItemId)) {
      validIdsCheck = false;
      errors.push(`targetItemId "${r.targetItemId}" no existe en los items extraídos`);
    }
    if (r.sourceItemId === r.targetItemId) {
      noSelfRelationsCheck = false;
      errors.push(`Auto-relación detectada: ${r.sourceItemId} -> ${r.targetItemId}`);
    }
    const key = `${r.sourceItemId}::${r.targetItemId}::${r.type}`;
    if (seenKeys.has(key)) {
      noDuplicateRelationsCheck = false;
      errors.push(`Relación duplicada encontrada: ${key}`);
    }
    seenKeys.add(key);

    if (!validTypes.includes(r.type)) {
      canonicalTypesCheck = false;
      errors.push(`Tipo de relación no canónico: "${r.type}"`);
    }
    if (!r.reason || r.reason.trim().length === 0) {
      nonEmptyReasonsCheck = false;
      errors.push(`Reason vacío para ${r.sourceItemId} -> ${r.targetItemId}`);
    }
    if (!validConfidences.includes(r.confidence)) {
      validConfidenceCheck = false;
      errors.push(`Confidence inválido: "${r.confidence}"`);
    }
  }

  const schemaCheck = DetectedRelationshipsSchema.safeParse({ relationships });
  const schemaCompliant = schemaCheck.success;
  if (!schemaCompliant) {
    errors.push(`Fallo de esquema DetectedRelationshipsSchema: ${schemaCheck.error?.message}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    checks: {
      validIds: validIdsCheck,
      noSelfRelations: noSelfRelationsCheck,
      noDuplicateRelations: noDuplicateRelationsCheck,
      canonicalTypes: canonicalTypesCheck,
      nonEmptyReasons: nonEmptyReasonsCheck,
      validConfidence: validConfidenceCheck,
      schemaCompliant,
    },
  };
}

async function runSkill01Evaluation(
  provider: ReturnType<typeof createAIProvider>,
  providerArg: string,
  filteredCases: CaseDump[],
  currentDate: string
) {
  console.log(`\n======================================================`);
  console.log(`🧪 EVALUANDO SKILL: extract_items`);
  console.log(`🤖 Proveedor: ${providerArg}`);
  console.log(`======================================================\n`);

  const results: Record<string, unknown> = {};

  for (const c of filteredCases) {
    console.log(`------------------------------------------------------`);
    console.log(`📌 [${c.id}] ${c.title}`);
    console.log(`📝 Texto original:\n"${c.text}"\n`);

    const start = Date.now();
    try {
      const output = await extractItems(provider, {
        text: c.text,
        currentDate,
        locale: "es-ES",
      });
      const elapsed = Date.now() - start;

      console.log(`✨ Extraído en ${elapsed}ms (${output.items.length} items):`);
      for (const item of output.items) {
        console.log(`  • [${item.id}] ${item.title} (${item.type})`);
      }

      results[c.id] = {
        title: c.title,
        input: c.text,
        elapsedMs: elapsed,
        output,
      };
    } catch (err) {
      console.error(`  ❌ Error extrayendo items: ${(err as Error).message}`);
      results[c.id] = {
        title: c.title,
        input: c.text,
        error: (err as Error).message,
      };
    }
    console.log();

    if (providerArg !== "mock") {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const outPath = path.resolve(__dirname, "../cases/eval-results.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), "utf-8");
  console.log(`\n✅ Resultados completos guardados en: cases/eval-results.json`);
}

async function runSkill02Evaluation(
  provider: ReturnType<typeof createAIProvider>,
  providerArg: string,
  filteredCases: CaseDump[],
  currentDate: string
) {
  console.log(`\n======================================================`);
  console.log(`🔗 EVALUANDO SKILL: detect_relationships`);
  console.log(`🤖 Proveedor: ${providerArg}`);
  if (providerArg === "mock") {
    console.log(`ℹ️ Modo mock determinista (fixtures para casos conocidos, 0 tokens)`);
  }
  console.log(`======================================================\n`);

  const results: Record<string, unknown> = {};

  const typeCounts: Record<string, number> = {
    same_project: 0,
    same_objective: 0,
    related_to: 0,
    part_of: 0,
    depends_on: 0,
    duplicate: 0,
  };

  let casesWithRelationships = 0;
  let casesWithoutRelationships = 0;
  let totalRelationships = 0;
  let totalValidationErrors = 0;

  for (const c of filteredCases) {
    const caseIndex = c.id.replace("case-", "");
    console.log(`------------------------------------------------------`);
    console.log(`CASE ${caseIndex}`);
    console.log(`Input:\n"${c.text}"\n`);

    let success = false;
    let attempt = 0;
    while (!success && attempt < 4) {
      attempt++;
      const start = Date.now();
      try {
        // 1. extract_items
        const extractionOutput = await extractItems(provider, {
          text: c.text,
          currentDate,
          locale: "es-ES",
        });

        // Small throttle if using remote LLM between extract and detect
        if (providerArg !== "mock") {
          await new Promise((r) => setTimeout(r, 2000));
        }

        // 2. detect_relationships
        const relationshipsOutput = await detectRelationships(provider, {
          items: extractionOutput.items,
        });
        const elapsed = Date.now() - start;

        console.log(`Extracted items:`);
        if (extractionOutput.items.length === 0) {
          console.log(`- none`);
        } else {
          for (const item of extractionOutput.items) {
            console.log(`- ${item.id}: ${item.title}`);
          }
        }
        console.log();

        const rels = relationshipsOutput.relationships;
        console.log(`Detected relationships:`);
        if (rels.length === 0) {
          console.log(`- none`);
          casesWithoutRelationships++;
        } else {
          casesWithRelationships++;
          for (const rel of rels) {
            totalRelationships++;
            typeCounts[rel.type] = (typeCounts[rel.type] ?? 0) + 1;

            console.log(`- ${rel.sourceItemId} → ${rel.targetItemId}`);
            console.log(`  type: ${rel.type}`);
            console.log(`  confidence: ${rel.confidence}`);
            console.log(`  reason: ${rel.reason}`);
            console.log();
          }
        }

        // 3. Automatic Validation
        const validation = validateDetectedRelationships(rels, extractionOutput.items);
        console.log(`Validation:`);
        if (validation.valid) {
          console.log(`✓ valid IDs`);
          console.log(`✓ no self-relations`);
          console.log(`✓ no duplicate relations`);
          console.log(`✓ canonical types`);
          console.log(`✓ non-empty reasons`);
          console.log(`✓ valid confidence`);
          console.log(`✓ schema compliant`);
        } else {
          for (const err of validation.errors) {
            totalValidationErrors++;
            console.log(`✗ ${err}`);
          }
        }

        results[c.id] = {
          title: c.title,
          input: c.text,
          elapsedMs: elapsed,
          extractedItems: extractionOutput.items,
          relationships: rels,
          validation,
        };
        success = true;
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes("429") || msg.includes("rate_limit")) {
          console.log(`⏳ Rate limit en Groq (intento ${attempt}/4). Esperando 10 segundos antes de reintentar...`);
          await new Promise((r) => setTimeout(r, 10000));
        } else {
          console.error(`❌ Error en pipeline: ${msg}`);
          totalValidationErrors++;
          results[c.id] = {
            title: c.title,
            input: c.text,
            error: msg,
          };
          break;
        }
      }
    }
    console.log();

    // Throttle between cases on remote providers
    if (providerArg !== "mock") {
      await new Promise((r) => setTimeout(r, 2500));
    }
  }

  console.log(`======================================================`);
  console.log(`📊 RESUMEN DE EVALUACIÓN: detect_relationships`);
  console.log(`🤖 Proveedor: ${providerArg}`);
  console.log(`======================================================`);
  console.log(`Total cases: ${filteredCases.length}`);
  console.log(`Cases with relationships: ${casesWithRelationships}`);
  console.log(`Cases without relationships: ${casesWithoutRelationships}`);
  console.log(`Validation errors: ${totalValidationErrors}`);
  console.log(`Total relationships detected: ${totalRelationships}\n`);

  console.log(`Resumen por tipo:`);
  for (const [type, count] of Object.entries(typeCounts)) {
    console.log(`${type}: ${count}`);
  }
  console.log(`======================================================\n`);

  const outPath = path.resolve(__dirname, "../cases/eval-relationships-results.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), "utf-8");
  console.log(`✅ Resultados guardados en: cases/eval-relationships-results.json`);
}

async function runSkill03Evaluation(
  provider: ReturnType<typeof createAIProvider>,
  providerArg: string,
  filteredCases: CaseDump[],
  currentDate: string
) {
  console.log(`\n======================================================`);
  console.log(`📦 EVALUANDO SKILL: group_work`);
  console.log(`🤖 Proveedor: ${providerArg}`);
  if (providerArg === "mock") {
    console.log(`ℹ️ Modo mock determinista (fixtures para casos conocidos, 0 tokens)`);
  }
  console.log(`======================================================\n`);

  const results: Record<string, unknown> = {};

  let casesWithGroups = 0;
  let casesWithoutGroups = 0;
  let totalGroups = 0;
  let totalItemsInGroups = 0;
  let totalUngroupedItems = 0;
  let totalValidationErrors = 0;

  for (const c of filteredCases) {
    const caseIndex = c.id.replace("case-", "");
    console.log(`------------------------------------------------------`);
    console.log(`CASE ${caseIndex}`);
    console.log(`Input:\n"${c.text}"\n`);

    let success = false;
    let attempt = 0;
    while (!success && attempt < 4) {
      attempt++;
      const start = Date.now();
      try {
        // 1. extract_items
        const extractionOutput = await extractItems(provider, {
          text: c.text,
          currentDate,
          locale: "es-ES",
        });

        if (providerArg !== "mock") {
          await new Promise((r) => setTimeout(r, 2000));
        }

        // 2. detect_relationships
        const relationshipsOutput = await detectRelationships(provider, {
          items: extractionOutput.items,
        });

        if (providerArg !== "mock") {
          await new Promise((r) => setTimeout(r, 2000));
        }

        // 3. group_work
        const groupedOutput = await groupWork(provider, {
          items: extractionOutput.items,
          relationships: relationshipsOutput.relationships,
        });
        const elapsed = Date.now() - start;

        console.log(`Extracted items (${extractionOutput.items.length}):`);
        for (const item of extractionOutput.items) {
          console.log(`- ${item.id}: ${item.title}`);
        }

        console.log(`\nDetected relationships (${relationshipsOutput.relationships.length}):`);
        if (relationshipsOutput.relationships.length === 0) {
          console.log(`- none`);
        } else {
          for (const rel of relationshipsOutput.relationships) {
            console.log(`- ${rel.sourceItemId} --(${rel.type})--> ${rel.targetItemId}`);
          }
        }

        console.log(`\nGrouped work:`);
        if (groupedOutput.groups.length === 0) {
          console.log(`- no groups formed`);
        } else {
          for (const g of groupedOutput.groups) {
            console.log(`📁 Grupo: "${g.title}" [${g.id}]`);
            console.log(`   Items (${g.itemIds.length}): ${g.itemIds.join(", ")}`);
            console.log(`   Rationale: ${g.rationale}`);
          }
        }

        console.log(`Ungrouped items (${groupedOutput.ungroupedItemIds.length}):`);
        if (groupedOutput.ungroupedItemIds.length === 0) {
          console.log(`- none`);
        } else {
          console.log(`- ${groupedOutput.ungroupedItemIds.join(", ")}`);
        }

        // Deterministic domain invariant check
        const invariants = validateGroupWorkInvariants(groupedOutput, extractionOutput.items);
        console.log(`\nValidation:`);
        if (invariants.valid) {
          console.log(`✓ all invariants satisfied`);
          console.log(`✓ disjoint groups (no items in multiple groups)`);
          console.log(`✓ conservation verified (0 items lost, 0 phantoms)`);
        } else {
          console.log(`❌ Invariant errors:`);
          for (const err of invariants.errors) {
            console.log(`  - ${err}`);
          }
          totalValidationErrors++;
        }

        if (groupedOutput.groups.length > 0) {
          casesWithGroups++;
        } else {
          casesWithoutGroups++;
        }

        totalGroups += groupedOutput.groups.length;
        totalItemsInGroups += groupedOutput.groups.reduce((acc, g) => acc + g.itemIds.length, 0);
        totalUngroupedItems += groupedOutput.ungroupedItemIds.length;

        results[c.id] = {
          caseId: c.id,
          input: c.text,
          elapsedMs: elapsed,
          itemsCount: extractionOutput.items.length,
          relationshipsCount: relationshipsOutput.relationships.length,
          groupsCount: groupedOutput.groups.length,
          groups: groupedOutput.groups,
          ungroupedItemIds: groupedOutput.ungroupedItemIds,
          validation: invariants,
        };

        success = true;
      } catch (err) {
        const errorMsg = (err as Error).message;
        if (errorMsg.includes("rate_limit_exceeded") || errorMsg.includes("429")) {
          const waitSec = attempt * 12;
          console.warn(`⏳ Rate limit alcanzado en ${c.id}. Reintentando en ${waitSec}s (intento ${attempt}/4)...`);
          await new Promise((r) => setTimeout(r, waitSec * 1000));
        } else {
          console.error(`\n❌ Error en pipeline: ${errorMsg}`);
          totalValidationErrors++;
          success = true;
        }
      }
    }

    if (providerArg !== "mock") {
      await new Promise((r) => setTimeout(r, 2500));
    }
  }

  console.log(`\n======================================================`);
  console.log(`📊 RESUMEN DE EVALUACIÓN: group_work`);
  console.log(`🤖 Proveedor: ${providerArg}`);
  console.log(`======================================================`);
  console.log(`Total cases: ${filteredCases.length}`);
  console.log(`Cases with groups: ${casesWithGroups}`);
  console.log(`Cases without groups: ${casesWithoutGroups}`);
  console.log(`Total groups formed: ${totalGroups}`);
  console.log(`Total items in groups: ${totalItemsInGroups}`);
  console.log(`Total ungrouped items: ${totalUngroupedItems}`);
  console.log(`Validation errors: ${totalValidationErrors}`);
  console.log(`======================================================\n`);

  const outPath = path.resolve(__dirname, "../cases/eval-group-work-results.json");
  let finalResults = results;
  if (filteredCases.length < 25 && fs.existsSync(outPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(outPath, "utf-8"));
      finalResults = { ...prev, ...results };
    } catch {}
  }
  fs.writeFileSync(outPath, JSON.stringify(finalResults, null, 2), "utf-8");
  console.log(`✅ Resultados guardados en: cases/eval-group-work-results.json`);
}

async function runSkill04Evaluation(
  provider: any,
  providerArg: string,
  filteredCases: CaseDump[],
  currentDate: string
) {
  console.log(`\n======================================================`);
  console.log(`🔍 EVALUACIÓN: Skill 04 — detect_deadlines`);
  console.log(`🤖 Proveedor: ${providerArg}`);
  console.log(`📅 Fecha base de anclaje: ${currentDate}`);
  console.log(`📋 Total casos a evaluar: ${filteredCases.length}`);
  console.log(`======================================================\n`);

  const mockExtractionsPath = path.resolve(__dirname, "../cases/mock-extractions.json");
  const mockExtractions: Record<string, { items: ExtractedItem[] }> = JSON.parse(
    fs.readFileSync(mockExtractionsPath, "utf-8")
  );

  let totalDeadlines = 0;
  let casesWithDeadlines = 0;
  let casesWithoutDeadlines = 0;
  let totalValidationErrors = 0;
  const byKind: Record<string, number> = {
    exact_date: 0,
    relative_date: 0,
    date_range: 0,
    recurring: 0,
    unspecified: 0,
  };
  const byConfidence: Record<string, number> = {
    high: 0,
    medium: 0,
    low: 0,
  };

  const results: Record<string, DetectedDeadlines> = {};

  for (const c of filteredCases) {
    console.log(`\n------------------------------------------------------`);
    console.log(`📌 Evaluando [${c.id}] — "${c.title}"`);
    console.log(`------------------------------------------------------`);

    const start = Date.now();
    try {
      // 1. Obtain input items (from mock extractions for stability, or extract dynamically)
      let items: ExtractedItem[];
      if (mockExtractions[c.id]) {
        items = mockExtractions[c.id].items;
      } else {
        const ext = await extractItems(provider, { text: c.text, currentDate });
        items = ext.items;
      }

      console.log(`Extracted items (${items.length}):`);
      for (const item of items) {
        console.log(`- ${item.id} [${item.type}]: ${item.title}`);
      }

      // 2. detect_deadlines
      const deadlinesOutput = await detectDeadlines(provider, {
        items,
        currentDate,
      });
      const elapsed = Date.now() - start;

      console.log(`\nDetected deadlines (${deadlinesOutput.deadlines.length}):`);
      if (deadlinesOutput.deadlines.length === 0) {
        console.log(`- none (no temporal anchors found)`);
        casesWithoutDeadlines++;
      } else {
        casesWithDeadlines++;
        for (const d of deadlinesOutput.deadlines) {
          const item = items.find((i) => i.id === d.itemId);
          const title = item ? item.title : "(unknown item)";
          console.log(`⏰ [${d.kind}] "${d.raw}" -> ${title} (${d.itemId})`);
          if (d.resolvedStart || d.resolvedEnd) {
            console.log(`   Resolved: ${d.resolvedStart || "null"} .. ${d.resolvedEnd || "null"}`);
          }
          console.log(`   Confidence: ${d.confidence}`);

          byKind[d.kind] = (byKind[d.kind] || 0) + 1;
          byConfidence[d.confidence] = (byConfidence[d.confidence] || 0) + 1;
          totalDeadlines++;
        }
      }

      // 3. Validation of invariants
      const invariants = validateDeadlinesInvariants(deadlinesOutput, items);
      console.log(`\nValidation:`);
      if (invariants.valid) {
        console.log(`✓ all deadlines invariants satisfied`);
        console.log(`✓ valid item IDs (0 phantoms)`);
        console.log(`✓ valid calendar dates (start <= end)`);
        console.log(`✓ no invented dates`);
      } else {
        totalValidationErrors += invariants.errors.length;
        console.log(`❌ Invariant errors (${invariants.errors.length}):`);
        for (const err of invariants.errors) {
          console.log(`   - ${err}`);
        }
      }

      console.log(`⏱ Tiempo: ${elapsed}ms`);
      results[c.id] = deadlinesOutput;
    } catch (err) {
      console.error(`❌ Error procesando [${c.id}]: ${(err as Error).message}`);
      totalValidationErrors++;
    }

    if (providerArg !== "mock") {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.log(`\n======================================================`);
  console.log(`📊 RESUMEN DE EVALUACIÓN: detect_deadlines`);
  console.log(`🤖 Proveedor: ${providerArg}`);
  console.log(`======================================================`);
  console.log(`Total cases: ${filteredCases.length}`);
  console.log(`Cases with deadlines: ${casesWithDeadlines}`);
  console.log(`Cases without deadlines: ${casesWithoutDeadlines}`);
  console.log(`Total deadlines detected: ${totalDeadlines}`);
  console.log(`Deadlines by kind:`, byKind);
  console.log(`Deadlines by confidence:`, byConfidence);
  console.log(`Validation errors: ${totalValidationErrors}`);
  console.log(`======================================================\n`);

  const outPath = path.resolve(__dirname, "../cases/eval-deadlines-results.json");
  let finalResults = results;
  if (filteredCases.length < 25 && fs.existsSync(outPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(outPath, "utf-8"));
      finalResults = { ...prev, ...results };
    } catch {}
  }
  fs.writeFileSync(outPath, JSON.stringify(finalResults, null, 2), "utf-8");
  console.log(`✅ Resultados guardados en: cases/eval-deadlines-results.json`);
}

async function runSkill05Evaluation(
  provider: ReturnType<typeof createAIProvider>,
  providerArg: string,
  filteredCases: CaseDump[],
  currentDate: string,
  meta?: { requestedCaseIds: string[]; omittedCaseIds: string[] }
) {
  console.log(`\n======================================================`);
  console.log(`🚀 EVALUANDO SKILL 05: evaluate_context`);
  console.log(`🤖 Proveedor: ${providerArg}`);
  console.log(`📅 Fecha base: ${currentDate}`);
  console.log(`📋 Total casos a ejecutar: ${filteredCases.length}`);
  if (meta && meta.omittedCaseIds.length > 0) {
    console.warn(`⚠️  Casos omitidos / no encontrados: ${meta.omittedCaseIds.join(", ")}`);
  }
  console.log(`======================================================\n`);

  const results: Record<string, EvaluateContextOutput> = {};
  const executedCases: string[] = [];
  const passedCases: string[] = [];
  const failedCases: string[] = [];
  let totalValidationErrors = 0;
  let totalItemsAssessed = 0;
  let totalGroupsAssessed = 0;
  let totalQuestions = 0;
  const attentionCounts: Record<string, number> = {};
  const relevanceCounts: Record<string, number> = {};
  const signalCounts: Record<string, number> = {};

  const mockItemsMap: Record<string, { items: ExtractedItem[] }> = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../cases/mock-extractions.json"), "utf-8")
  );
  const mockRelsMap: Record<string, { relationships: Relationship[] }> = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../cases/mock-relationships.json"), "utf-8")
  );
  const mockGroupsMap: Record<string, { groups: any[]; ungroupedItemIds: string[] }> = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../cases/mock-groupings.json"), "utf-8")
  );
  const mockDeadlinesMap: Record<string, { deadlines: DetectedDeadline[] }> = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../cases/mock-deadlines.json"), "utf-8")
  );

  for (const c of filteredCases) {
    executedCases.push(c.id);
    console.log(`\n------------------------------------------------------`);
    console.log(`📦 CASO [${c.id}]: ${c.title}`);
    console.log(`------------------------------------------------------`);

    const start = Date.now();
    try {
      const items = mockItemsMap[c.id]?.items || [];
      const relationships = mockRelsMap[c.id]?.relationships || [];
      const groupedWork = mockGroupsMap[c.id] || { groups: [], ungroupedItemIds: items.map((i) => i.id) };
      const deadlines = mockDeadlinesMap[c.id] || { deadlines: [] };

      console.log(`Items: ${items.length}, Grupos: ${groupedWork.groups.length}, Deadlines: ${deadlines.deadlines.length}`);

      const contextOutput = await evaluateContext(provider, {
        currentDate,
        items,
        relationships,
        groupedWork,
        deadlines,
      });
      const elapsed = Date.now() - start;

      console.log(`\nItem assessments (${contextOutput.itemAssessments.length}):`);
      for (const ia of contextOutput.itemAssessments) {
        const item = items.find((i) => i.id === ia.itemId);
        console.log(`- [${ia.attention.toUpperCase()}] ${item?.title || ia.itemId}: signals=[${ia.signals.join(", ")}]`);
        attentionCounts[ia.attention] = (attentionCounts[ia.attention] || 0) + 1;
        for (const s of ia.signals) {
          signalCounts[s] = (signalCounts[s] || 0) + 1;
        }
        totalItemsAssessed++;
      }

      console.log(`\nGroup assessments (${contextOutput.groupAssessments.length}):`);
      for (const ga of contextOutput.groupAssessments) {
        console.log(`- [${ga.relevance.toUpperCase()}] Group ${ga.groupId}: ${ga.rationale}`);
        relevanceCounts[ga.relevance] = (relevanceCounts[ga.relevance] || 0) + 1;
        totalGroupsAssessed++;
      }

      if (contextOutput.openQuestions.length > 0) {
        console.log(`\nOpen questions (${contextOutput.openQuestions.length}):`);
        for (const q of contextOutput.openQuestions) {
          console.log(`❓ [${q.topic}] ${q.question} (reason: ${q.reason})`);
          totalQuestions++;
        }
      }

      const invariants = validateContextInvariants(contextOutput, {
        currentDate,
        items,
        relationships,
        groupedWork,
        deadlines,
      });

      console.log(`\nValidation:`);
      if (invariants.valid) {
        passedCases.push(c.id);
        console.log(`✓ 100% item coverage (1:1, 0 phantoms, 0 duplicates)`);
        console.log(`✓ 100% group coverage (1:1, 0 phantoms, 0 duplicates)`);
        console.log(`✓ all question references exist`);
        console.log(`✓ no scheduling/capacity leakage`);
      } else {
        failedCases.push(c.id);
        totalValidationErrors += invariants.errors.length;
        console.log(`❌ Invariant errors (${invariants.errors.length}):`);
        for (const err of invariants.errors) {
          console.log(`   - ${err}`);
        }
      }

      console.log(`⏱ Tiempo: ${elapsed}ms`);
      const executionMeta = provider.getLastExecutionMeta?.();
      if (executionMeta?.tokensUsed) {
        console.log(
          `🎟 Tokens: prompt=${executionMeta.tokensUsed.prompt}, completion=${executionMeta.tokensUsed.completion}, total=${executionMeta.tokensUsed.total}`
        );
      }
      results[c.id] = contextOutput;
    } catch (err) {
      failedCases.push(c.id);
      console.error(`❌ Error procesando [${c.id}]: ${(err as Error).message}`);
      if ((err as any).issues) {
        console.error(`   Issues:`, JSON.stringify((err as any).issues, null, 2));
      }
      totalValidationErrors++;
    }

    if (providerArg !== "mock") {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const requestedCount = meta?.requestedCaseIds.length ?? filteredCases.length;
  const omittedCount = meta?.omittedCaseIds.length ?? 0;
  const omittedList = meta?.omittedCaseIds ?? [];

  console.log(`\n======================================================`);
  console.log(`📊 RESUMEN DE EVALUACIÓN: evaluate_context`);
  console.log(`🤖 Proveedor: ${providerArg}`);
  console.log(`======================================================`);
  console.log(`Casos solicitados: ${requestedCount}`);
  console.log(`Casos omitidos / no encontrados: ${omittedCount}${omittedCount > 0 ? ` [${omittedList.join(", ")}]` : ""}`);
  console.log(`Casos ejecutados: ${executedCases.length}`);
  console.log(`Casos aprobados (invariantes válidas): ${passedCases.length}`);
  console.log(`Casos fallidos (invariantes o error): ${failedCases.length}${failedCases.length > 0 ? ` [${failedCases.join(", ")}]` : ""}`);
  console.log(`Total items evaluados: ${totalItemsAssessed}`);
  console.log(`Total grupos evaluados: ${totalGroupsAssessed}`);
  console.log(`Total preguntas abiertas: ${totalQuestions}`);
  console.log(`Distribución de atención:`, attentionCounts);
  console.log(`Distribución de relevancia:`, relevanceCounts);
  console.log(`Señales detectadas:`, signalCounts);
  console.log(`Total errores de validación: ${totalValidationErrors}`);
  console.log(`======================================================\n`);

  const outPath = path.resolve(__dirname, "../cases/eval-context-results.json");
  let finalResults = results;
  if (filteredCases.length < 25 && fs.existsSync(outPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(outPath, "utf-8"));
      finalResults = { ...prev, ...results };
    } catch {}
  }
  fs.writeFileSync(outPath, JSON.stringify(finalResults, null, 2), "utf-8");
  console.log(`✅ Resultados guardados en: cases/eval-context-results.json`);
}

async function runSkill06Evaluation(
  provider: ReturnType<typeof createAIProvider>,
  providerArg: string,
  filteredCases: CaseDump[],
  currentDate: string
) {
  console.log(`\n======================================================`);
  console.log(`🚀 EVALUANDO SKILL 06: build_week`);
  console.log(`🤖 Proveedor: ${providerArg} (${provider.model})`);
  console.log(`📅 Fecha base: ${currentDate}`);
  console.log(`📋 Total casos: ${filteredCases.length}`);
  if (providerArg === "groq") {
    console.log(`⚠️  MODO REAL: Consumiendo tokens de Groq API`);
  } else {
    console.log(`ℹ️  MODO MOCK: Determinista offline, 0 tokens`);
  }
  console.log(`======================================================\n`);

  if (!provider.buildWeek) {
    console.warn(
      `⚠️ El proveedor "${providerArg}" no implementa buildWeek todavía.`
    );
    console.warn(
      `Ejecutá "npm run eval:week -- --provider=mock" para ejecutar la evaluación offline determinista con 0 tokens.`
    );
    return;
  }

  const results: Record<string, BuildWeekCaseEvaluationRecord> = {};
  let totalItemsProcessed = 0;
  let totalFoci = 0;
  let totalObligations = 0;
  let totalFlexibleOptions = 0;
  let totalDeferredItems = 0;
  let totalRepairs = 0;

  let countSuccess = 0;
  let countRepaired = 0;
  let countSemanticFailure = 0;
  let countInvalidResponse = 0;
  let countProviderError = 0;

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  let hasTokenMetrics = false;

  let totalDurationMs = 0;
  const slowCases: Array<{ caseId: string; durationMs: number }> = [];
  const latencyRatingCounts: Record<string, number> = { fast: 0, acceptable: 0, slow: 0 };

  const deferredReasonCounts: Record<string, number> = {};
  const capacityStatusCounts: Record<string, number> = {};
  const repairTypeCounts: Record<string, number> = {};
  const semanticErrorCounts: Record<string, number> = {};

  const mockItemsMap: Record<string, { items: ExtractedItem[] }> = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../cases/mock-extractions.json"), "utf-8")
  );
  const mockRelsMap: Record<string, { relationships: Relationship[] }> = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../cases/mock-relationships.json"), "utf-8")
  );
  const mockGroupsMap: Record<string, { groups: any[]; ungroupedItemIds: string[] }> = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../cases/mock-groupings.json"), "utf-8")
  );
  const mockDeadlinesMap: Record<string, { deadlines: DetectedDeadline[] }> = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../cases/mock-deadlines.json"), "utf-8")
  );
  const mockContextMap: Record<string, EvaluateContextOutput> = fs.existsSync(
    path.resolve(__dirname, "../cases/eval-context-results.json")
  )
    ? JSON.parse(
        fs.readFileSync(path.resolve(__dirname, "../cases/eval-context-results.json"), "utf-8")
      )
    : {};

  for (const c of filteredCases) {
    console.log(`\n------------------------------------------------------`);
    console.log(`📦 CASO [${c.id}]: ${c.title}`);
    console.log(`------------------------------------------------------`);

    const start = Date.now();
    try {
      const items = mockItemsMap[c.id]?.items || [];
      const itemIds = new Set(items.map((i) => i.id));
      const relationships = (mockRelsMap[c.id]?.relationships || []).filter(
        (r) => itemIds.has(r.sourceItemId) && itemIds.has(r.targetItemId)
      );
      const rawGrouped = mockGroupsMap[c.id] || {
        groups: [],
        ungroupedItemIds: items.map((i) => i.id),
      };
      const groupedWork = {
        groups: (rawGrouped.groups || []).map((g) => ({
          ...g,
          itemIds: g.itemIds.filter((id: string) => itemIds.has(id)),
        })),
        ungroupedItemIds: (rawGrouped.ungroupedItemIds || []).filter((id: string) => itemIds.has(id)),
      };
      const rawDeadlines = mockDeadlinesMap[c.id] || { deadlines: [] };
      const deadlines = {
        deadlines: (rawDeadlines.deadlines || []).filter((dl) => itemIds.has(dl.itemId)),
      };
      const context = mockContextMap[c.id] || {
        itemAssessments: items.map((i) => ({
          itemId: i.id,
          attention: "medium" as const,
          signals: [],
          rationale: "Default context",
        })),
        groupAssessments: groupedWork.groups.map((g) => ({
          groupId: g.id,
          relevance: "medium" as const,
          rationale: "Default group relevance",
        })),
        openQuestions: [],
      };

      const buildWeekInput: BuildWeekInput = {
        currentDate,
        userIntent: c.title,
        items,
        relationships,
        groupedWork,
        deadlines,
        context,
        capacity: {
          totalAvailableHours: 25,
          minProtectedSpaceRatio: 0.25,
        },
      };

      console.log(
        `Items entrada: ${items.length}, Grupos: ${groupedWork.groups.length}, Capacidad disponible: 25h`
      );

      const auditResult = await buildWeekWithAudit(provider, buildWeekInput);
      const elapsed = Date.now() - start;
      const proposal = auditResult.proposal;

      // Extract provider execution metadata if available
      const executionMeta = typeof (provider as any).getLastExecutionMeta === "function"
        ? (provider as any).getLastExecutionMeta()
        : undefined;

      const duration = executionMeta?.durationMs ?? elapsed;
      totalDurationMs += duration;

      const latencyRating: "fast" | "acceptable" | "slow" =
        duration <= 10000 ? "fast" : duration <= 30000 ? "acceptable" : "slow";
      latencyRatingCounts[latencyRating] = (latencyRatingCounts[latencyRating] || 0) + 1;
      if (duration > 30000) {
        slowCases.push({ caseId: c.id, durationMs: duration });
      }

      const tokens = executionMeta?.tokensUsed;
      if (tokens) {
        hasTokenMetrics = true;
        totalPromptTokens += tokens.prompt ?? 0;
        totalCompletionTokens += tokens.completion ?? 0;
        totalTokens += tokens.total ?? 0;
      }

      totalItemsProcessed += items.length;
      totalFoci += proposal.foci.length;
      totalObligations += proposal.obligations.length;
      totalFlexibleOptions += proposal.flexibleOptions.length;
      totalDeferredItems += proposal.deferredItems.length;

      const capStatus = proposal.weekSummary.capacity.capacityStatus;
      capacityStatusCounts[capStatus] = (capacityStatusCounts[capStatus] || 0) + 1;

      console.log(`\nEstructura semanal:`);
      console.log(`- Focos propuestos (${proposal.foci.length}):`);
      for (const f of proposal.foci) {
        console.log(`  🎯 [${f.title}] (${f.contributingItemIds.length} items, est: ${f.estimatedHours ?? "n/a"}h) -> outcome: "${f.desiredOutcome}"`);
      }

      console.log(`- Obligaciones (${proposal.obligations.length}):`);
      for (const o of proposal.obligations) {
        console.log(`  🔒 [${o.commitmentType}] ${o.title} (est: ${o.estimatedHours ?? "n/a"}h, due: ${o.dueDate || "semana"})`);
      }

      console.log(`- Opciones flexibles (${proposal.flexibleOptions.length}):`);
      for (const fo of proposal.flexibleOptions) {
        console.log(`  🌱 ${fo.title} (cond: "${fo.condition || "si queda tiempo"}")`);
      }

      const caseDeferredReasons: Record<string, number> = {};
      console.log(`- Elementos aplazados/conservados (${proposal.deferredItems.length}):`);
      for (const d of proposal.deferredItems) {
        console.log(`  ⏸️  [${d.reason}] ${d.title}`);
        deferredReasonCounts[d.reason] = (deferredReasonCounts[d.reason] || 0) + 1;
        caseDeferredReasons[d.reason] = (caseDeferredReasons[d.reason] || 0) + 1;
      }

      console.log(`\nCapacidad y espacio:`);
      console.log(`- Estado capacidad: ${proposal.weekSummary.capacity.capacityStatus}`);
      console.log(`- Espacio protegido: ${proposal.weekSummary.capacity.protectedSpaceStatus} (${proposal.weekSummary.capacity.protectedSpaceHours ?? "n/a"}h recomendadas)`);
      console.log(`- Horas: planificables=${proposal.weekSummary.capacity.plannableHours ?? "n/a"}h, conocidas=${proposal.weekSummary.capacity.knownEstimatedHours ?? "n/a"}h, planificadas=${proposal.weekSummary.capacity.plannedHours ?? "n/a"}h`);

      if (auditResult.repaired) {
        console.log(`\n🔧 Reparaciones aplicadas (${auditResult.repairs.length}):`);
        for (const rep of auditResult.repairs) {
          console.log(`   - [${rep.type}] ${rep.description}`);
          repairTypeCounts[rep.type] = (repairTypeCounts[rep.type] || 0) + 1;
          totalRepairs++;
        }
      }

      // 1. Invariant cross-checks
      const invariants = validateProposedWeekInvariants(proposal, buildWeekInput);
      console.log(`\nValidación de invariantes:`);
      if (invariants.valid) {
        console.log(`✓ 100% item conservation (1:1, 0 phantoms, 0 duplicados, 0 omitidos)`);
        console.log(`✓ Coherencia matemática de capacidad`);
        console.log(`✓ Exclusividad de categorías y límite de focos (0..3)`);
      } else {
        console.log(`❌ Invariant errors (${invariants.errors.length}):`);
        for (const err of invariants.errors) {
          console.log(`   - ${err}`);
        }
      }

      // 2. Semantic quality checks
      const semanticQuality = evaluateProposedWeekSemanticQuality(proposal, buildWeekInput);
      console.log(`\nValidación de calidad semántica:`);
      if (semanticQuality.valid) {
        console.log(`✓ Compromisos explícitos preservados`);
        console.log(`✓ Ideas no convertidas en obligaciones`);
        console.log(`✓ Dependencias respaldadas estrictamente por depends_on`);
        console.log(`✓ Elementos archivados conservados como archivados`);
        console.log(`✓ Honestidad en capacidad e incertidumbre`);
      } else {
        console.log(`❌ Semantic errors (${semanticQuality.errors.length}):`);
        for (const err of semanticQuality.errors) {
          console.log(`   - ${err}`);
          semanticErrorCounts[err] = (semanticErrorCounts[err] || 0) + 1;
        }
      }
      if (semanticQuality.warnings.length > 0) {
        console.log(`⚠️ Advertencias semánticas (${semanticQuality.warnings.length}):`);
        for (const w of semanticQuality.warnings) {
          console.log(`   - ${w}`);
        }
      }

      // Determine case status
      let caseStatus: "success" | "repaired_success" | "semantic_failure" | "invalid_response" = "success";
      if (!invariants.valid) {
        caseStatus = "invalid_response";
        countInvalidResponse++;
      } else if (!semanticQuality.valid) {
        caseStatus = "semantic_failure";
        countSemanticFailure++;
      } else if (auditResult.repaired) {
        caseStatus = "repaired_success";
        countRepaired++;
      } else {
        countSuccess++;
      }

      console.log(`\n📌 Resultado caso: [${caseStatus.toUpperCase()}]`);
      if (tokens) {
        console.log(`⏱ Tiempo: ${duration}ms | Tokens: prompt=${tokens.prompt ?? "n/a"}, comp=${tokens.completion ?? "n/a"}, total=${tokens.total ?? "n/a"}`);
      } else {
        console.log(`⏱ Tiempo: ${duration}ms (offline/0 tokens)`);
      }

      // Register full structured case result
      const outputCount =
        proposal.obligations.length +
        proposal.flexibleOptions.length +
        proposal.deferredItems.length;

      results[c.id] = {
        caseId: c.id,
        title: c.title,
        provider: providerArg,
        model: provider.model,
        executedAt: new Date().toISOString(),
        status: caseStatus,
        metrics: {
          durationMs: duration,
          latencyRating,
          tokens: tokens
            ? {
                prompt: tokens.prompt,
                completion: tokens.completion,
                total: tokens.total,
              }
            : undefined,
        },
        parsing: {
          success: true,
          repaired: auditResult.repaired,
          repairsCount: auditResult.repairs.length,
          repairs: auditResult.repairs.map((r) => ({
            type: r.type,
            itemId: r.itemId,
            description: r.description,
          })),
        },
        invariants: {
          valid: invariants.valid,
          errors: invariants.errors,
        },
        semanticChecks: semanticQuality,
        conservation: {
          inputCount: items.length,
          outputCount,
          isConserved1to1: items.length === outputCount && invariants.valid,
        },
        classification: {
          fociCount: proposal.foci.length,
          obligationsCount: proposal.obligations.length,
          flexibleOptionsCount: proposal.flexibleOptions.length,
          deferredCount: proposal.deferredItems.length,
          deferredReasons: caseDeferredReasons,
        },
        fociReview: proposal.foci.map((f) => ({
          title: f.title,
          contributingItemIds: f.contributingItemIds,
          desiredOutcome: f.desiredOutcome,
          estimatedHours: f.estimatedHours,
        })),
        proposal,
      };
    } catch (err) {
      console.error(`❌ Error procesando [${c.id}]: ${(err as Error).message}`);
      const errType = (err as any).name || "Error";
      const isValidationErr =
        errType === "WeekValidationError" ||
        errType === "ZodError" ||
        (err as Error).message.includes("schema");

      const caseStatus = isValidationErr ? "invalid_response" : "provider_error";
      if (isValidationErr) {
        countInvalidResponse++;
      } else {
        countProviderError++;
      }

      if ((err as any).issues) {
        console.error(`   Issues:`, JSON.stringify((err as any).issues, null, 2));
      }

      results[c.id] = {
        caseId: c.id,
        title: c.title,
        provider: providerArg,
        model: provider.model,
        executedAt: new Date().toISOString(),
        status: caseStatus,
        metrics: {
          durationMs: Date.now() - start,
        },
        parsing: {
          success: false,
          repaired: false,
          repairsCount: 0,
          repairs: [],
        },
        invariants: {
          valid: false,
          errors: [(err as Error).message],
        },
        semanticChecks: undefined,
        conservation: {
          inputCount: 0,
          outputCount: 0,
          isConserved1to1: false,
        },
        classification: {
          fociCount: 0,
          obligationsCount: 0,
          flexibleOptionsCount: 0,
          deferredCount: 0,
          deferredReasons: {},
        },
        fociReview: [],
        error: {
          message: (err as Error).message,
          type: errType,
          issues: (err as any).issues,
        },
      };
    }
  }

  console.log(`\n======================================================`);
  console.log(`📊 RESUMEN DE EVALUACIÓN: build_week`);
  console.log(`🤖 Proveedor: ${providerArg} (${provider.model})`);
  console.log(`======================================================`);
  console.log(`Total casos evaluados: ${filteredCases.length}`);
  console.log(`- Éxito limpio (sin reparaciones): ${countSuccess}`);
  console.log(`- Éxito con reparaciones seguras: ${countRepaired}`);
  console.log(`- Fallos semánticos: ${countSemanticFailure}`);
  console.log(`- Respuestas inválidas (parsing/invariantes): ${countInvalidResponse}`);
  console.log(`- Errores de proveedor/red: ${countProviderError}`);
  console.log(`------------------------------------------------------`);
  console.log(`Total items procesados: ${totalItemsProcessed}`);
  console.log(`Total focos propuestos: ${totalFoci}`);
  console.log(`Total obligaciones: ${totalObligations}`);
  console.log(`Total opciones flexibles: ${totalFlexibleOptions}`);
  console.log(`Total elementos aplazados: ${totalDeferredItems}`);
  console.log(`Distribución de motivos de aplazamiento:`, deferredReasonCounts);
  console.log(`Distribución de estado de capacidad:`, capacityStatusCounts);
  console.log(`Total reparaciones aplicadas: ${totalRepairs}`);
  console.log(`Detalle de reparaciones:`, repairTypeCounts);
  console.log(`------------------------------------------------------`);
  console.log(`Métricas de latencia y experiencia de uso:`);
  console.log(`- Tiempo total: ${(totalDurationMs / 1000).toFixed(1)}s`);
  console.log(`- Latencia promedio: ${Math.round(totalDurationMs / filteredCases.length)}ms`);
  console.log(`- Distribución de latencia:`, latencyRatingCounts);
  if (slowCases.length > 0) {
    console.log(
      `⚠️ Casos con latencia alta (>30s): ${slowCases
        .map((s) => `${s.caseId} (${(s.durationMs / 1000).toFixed(1)}s)`)
        .join(", ")}`
    );
  }
  if (hasTokenMetrics) {
    console.log(`------------------------------------------------------`);
    console.log(`Uso total de tokens:`);
    console.log(`- Prompt tokens: ${totalPromptTokens}`);
    console.log(`- Completion tokens: ${totalCompletionTokens}`);
    console.log(`- Total tokens: ${totalTokens}`);
  }
  console.log(`======================================================\n`);

  const outPath = path.resolve(__dirname, "../cases/eval-week-results.json");
  let existingResults: Record<string, BuildWeekCaseEvaluationRecord> = {};
  if (fs.existsSync(outPath)) {
    try {
      existingResults = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    } catch {}
  }
  const finalResults = mergeConsolidatedWeekResults(existingResults, results);
  fs.writeFileSync(outPath, JSON.stringify(finalResults, null, 2), "utf-8");
  console.log(`✅ Reporte estructurado guardado en: cases/eval-week-results.json`);
}

async function main() {
  const args = process.argv.slice(2);
  const skillArg =
    [...args].reverse().find((a) => a.startsWith("--skill="))?.split("=")[1] ||
    process.env.EVAL_SKILL ||
    "evaluate_context";
  const defaultProvider = skillArg === "build_week" ? "mock" : "groq";

  const providerFromArgs = [...args].reverse().find((a) => a.startsWith("--provider="))?.split("=")[1] as ProviderType | undefined;
  const providerArg =
    providerFromArgs ||
    (skillArg === "build_week" && process.env.BUILD_WEEK_PROVIDER
      ? (process.env.BUILD_WEEK_PROVIDER as ProviderType)
      : undefined) ||
    (process.env.AI_PROVIDER as ProviderType) ||
    defaultProvider;

  const caseArg = [...args].reverse().find((a) => a.startsWith("--case="))?.split("=")[1];

  if (providerArg === "groq") {
    console.log(`\n======================================================`);
    console.log(`⚠️  AVISO DE COSTE Y CUOTA: PROVEEDOR REAL (GROQ)`);
    console.log(`💸 Esta ejecución realizará llamadas de red a la API de Groq.`);
    console.log(`======================================================\n`);
  }

  let provider;
  try {
    provider = createAIProvider({ provider: providerArg });
  } catch (err) {
    console.error(`❌ Error inicializando proveedor "${providerArg}": ${(err as Error).message}`);
    console.error(
      `\nAsegurate de definir ${
        providerArg === "groq" ? "GROQ_API_KEY" : "GEMINI_API_KEY"
      } en tu archivo .env o en variables de entorno, o ejecutá con --provider=mock para evaluación offline.`
    );
    process.exit(1);
  }

  const casesPath = path.resolve(__dirname, "../cases/real-dumps.json");
  const cases: CaseDump[] = JSON.parse(fs.readFileSync(casesPath, "utf-8"));
  const allKnownIds = new Set(cases.map((c) => c.id));
  const requestedCaseIds = caseArg
    ? caseArg
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
    : cases.map((c) => c.id);
  const omittedCaseIds = requestedCaseIds.filter((id) => !allKnownIds.has(id));

  if (omittedCaseIds.length > 0) {
    console.warn(
      `\n⚠️  ATENCIÓN: Se solicitaron casos que no existen en real-dumps.json: ${omittedCaseIds.join(
        ", "
      )} (posible typo en el argumento --case)`
    );
  }

  const validRequestedSet = new Set(requestedCaseIds.filter((id) => allKnownIds.has(id)));
  const filteredCases = caseArg ? cases.filter((c) => validRequestedSet.has(c.id)) : cases;

  if (filteredCases.length === 0) {
    console.error(`No se encontraron casos válidos para "${caseArg}".`);
    process.exit(1);
  }

  const dateArg = [...args].reverse().find((a) => a.startsWith("--date="))?.split("=")[1];
  const currentDate = dateArg || process.env.EVAL_DATE || "2026-10-09";

  if (skillArg === "extract_items") {
    await runSkill01Evaluation(provider, providerArg, filteredCases, currentDate);
  } else if (skillArg === "detect_relationships") {
    await runSkill02Evaluation(provider, providerArg, filteredCases, currentDate);
  } else if (skillArg === "group_work") {
    await runSkill03Evaluation(provider, providerArg, filteredCases, currentDate);
  } else if (skillArg === "detect_deadlines") {
    await runSkill04Evaluation(provider, providerArg, filteredCases, currentDate);
  } else if (skillArg === "build_week") {
    await runSkill06Evaluation(provider, providerArg, filteredCases, currentDate);
  } else {
    await runSkill05Evaluation(provider, providerArg, filteredCases, currentDate, {
      requestedCaseIds,
      omittedCaseIds,
    });
  }
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("eval-cases.ts") || process.argv[1].endsWith("eval-cases.js"));

if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}

