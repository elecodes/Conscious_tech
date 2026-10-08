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

async function main() {
  const args = process.argv.slice(2);
  const providerArg =
    (args.find((a) => a.startsWith("--provider="))?.split("=")[1] as ProviderType) ||
    (process.env.AI_PROVIDER as ProviderType) ||
    "groq";
  const caseArg = args.find((a) => a.startsWith("--case="))?.split("=")[1];
  const skillArg =
    args.find((a) => a.startsWith("--skill="))?.split("=")[1] ||
    process.env.EVAL_SKILL ||
    "group_work";

  let provider;
  try {
    provider = createAIProvider({ provider: providerArg });
  } catch (err) {
    console.error(`❌ Error inicializando proveedor "${providerArg}": ${(err as Error).message}`);
    console.error(
      `\nAsegurate de definir ${
        providerArg === "groq" ? "GROQ_API_KEY" : "GEMINI_API_KEY"
      } en tu archivo .env o en variables de entorno.`
    );
    process.exit(1);
  }

  const casesPath = path.resolve(__dirname, "../cases/real-dumps.json");
  const cases: CaseDump[] = JSON.parse(fs.readFileSync(casesPath, "utf-8"));
  const filteredCases = caseArg ? cases.filter((c) => c.id === caseArg) : cases;

  if (filteredCases.length === 0) {
    console.error(`No se encontró el caso "${caseArg}".`);
    process.exit(1);
  }

  const currentDate = new Date().toISOString().split("T")[0] || "2026-10-06";

  if (skillArg === "extract_items") {
    await runSkill01Evaluation(provider, providerArg, filteredCases, currentDate);
  } else if (skillArg === "detect_relationships") {
    await runSkill02Evaluation(provider, providerArg, filteredCases, currentDate);
  } else {
    await runSkill03Evaluation(provider, providerArg, filteredCases, currentDate);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

