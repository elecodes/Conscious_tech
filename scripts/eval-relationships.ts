import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAIProvider, ProviderType } from "../src/providers/factory";
import { detectRelationships } from "../src/skills/detect-relationships";
import { ExtractedItem } from "../src/domain/items";

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

interface CaseData {
  items: ExtractedItem[];
}

async function main() {
  const args = process.argv.slice(2);
  const providerArg =
    (args.find((a) => a.startsWith("--provider="))?.split("=")[1] as ProviderType) ||
    (process.env.AI_PROVIDER as ProviderType) ||
    "mock";
  const caseArg = args.find((a) => a.startsWith("--case="))?.split("=")[1];

  console.log(`\n======================================================`);
  console.log(`🔗 EVALUANDO SKILL: detect_relationships`);
  console.log(`🤖 Proveedor: ${providerArg}`);
  console.log(`======================================================\n`);

  let provider;
  try {
    provider = createAIProvider({ provider: providerArg });
  } catch (err) {
    console.error(`❌ Error inicializando proveedor "${providerArg}": ${(err as Error).message}`);
    process.exit(1);
  }

  const mockExtractionsPath = path.resolve(__dirname, "../cases/mock-extractions.json");
  const casesRecord: Record<string, CaseData> = JSON.parse(
    fs.readFileSync(mockExtractionsPath, "utf-8")
  );

  const caseIds = Object.keys(casesRecord);
  const filteredIds = caseArg ? caseIds.filter((id) => id === caseArg) : caseIds;

  if (filteredIds.length === 0) {
    console.error(`No se encontró el caso "${caseArg}".`);
    process.exit(1);
  }

  const results: Record<string, unknown> = {};

  for (const cid of filteredIds) {
    const caseData = casesRecord[cid];
    if (!caseData || !caseData.items) continue;

    const items = caseData.items;
    const itemMap = new Map<string, ExtractedItem>(items.map((it) => [it.id, it]));

    console.log(`------------------------------------------------------`);
    console.log(`📌 [${cid}] (${items.length} items en entrada)`);

    const start = Date.now();
    try {
      const output = await detectRelationships(
        provider,
        { items },
        { inferSameProject: true }
      );
      const elapsed = Date.now() - start;

      console.log(`✨ Detectadas ${output.relationships.length} relaciones en ${elapsed}ms:`);
      if (output.relationships.length === 0) {
        console.log(`  (Sin relaciones directas detectadas - items independientes)`);
      } else {
        for (const rel of output.relationships) {
          const srcTitle = itemMap.get(rel.sourceItemId)?.title || rel.sourceItemId;
          const tgtTitle = itemMap.get(rel.targetItemId)?.title || rel.targetItemId;

          console.log(
            `  • [${rel.type.toUpperCase()}] (${rel.confidence}): "${srcTitle}" -> "${tgtTitle}"`
          );
          console.log(`    ↳ Motivo: ${rel.reason}`);
        }
      }

      results[cid] = {
        itemCount: items.length,
        elapsedMs: elapsed,
        output,
      };
    } catch (err) {
      console.error(`  ❌ Error detectando relaciones: ${(err as Error).message}`);
      results[cid] = {
        itemCount: items.length,
        error: (err as Error).message,
      };
    }
    console.log();

    if (providerArg !== "mock") {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const outPath = path.resolve(__dirname, "../cases/eval-relationships-results.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), "utf-8");
  console.log(`\n✅ Resultados guardados en: cases/eval-relationships-results.json`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
