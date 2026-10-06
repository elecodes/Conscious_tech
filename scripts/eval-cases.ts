import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAIProvider, ProviderType } from "../src/providers/factory";
import { extractItems } from "../src/skills/extract-items";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Simple .env loader if file exists
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

async function main() {
  const args = process.argv.slice(2);
  const providerArg = (args.find((a) => a.startsWith("--provider="))?.split("=")[1] as ProviderType) ||
    (process.env.AI_PROVIDER as ProviderType) ||
    "groq";
  const caseArg = args.find((a) => a.startsWith("--case="))?.split("=")[1];

  console.log(`\n======================================================`);
  console.log(`🧪 EVALUANDO SKILL: extract_items`);
  console.log(`🤖 Proveedor: ${providerArg}`);
  console.log(`======================================================\n`);

  let provider;
  try {
    provider = createAIProvider({ provider: providerArg });
  } catch (err) {
    console.error(`❌ Error inicializando proveedor "${providerArg}": ${(err as Error).message}`);
    console.error(`\nAsegurate de definir ${providerArg === "groq" ? "GROQ_API_KEY" : "GEMINI_API_KEY"} en tu archivo .env o en variables de entorno.`);
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
        const details = [
          `tipo: [${item.type.toUpperCase()}]`,
          item.project ? `proyecto: "${item.project}"` : null,
          item.status ? `estado: ${item.status}` : null,
          item.commitment && item.commitment !== "none" ? `compromiso: ${item.commitment}` : null,
          item.estimatedEffort ? `esfuerzo: ${item.estimatedEffort.value} ${item.estimatedEffort.unit}` : null,
          item.deadline ? `fecha: ${item.deadline.raw}${item.deadline.resolved ? ` (${item.deadline.resolved})` : ""}` : null,
          item.importance ? `importancia: ${item.importance}` : null,
        ]
          .filter(Boolean)
          .join(" | ");

        console.log(`  • ${item.title}`);
        console.log(`    ↳ ${details}`);
        console.log(`    ↳ rawText: "${item.rawText}"`);
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

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
