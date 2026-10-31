import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Voseo Denylist Test
 *
 * Why this exists:
 * In accordance with Conscious Tech product standards (ADR 0022), the product UI copy
 * is written in Spanish from Spain (neutral, tú/usted-free, no voseo).
 * To prevent regressions where Rioplatense/voseo verb forms or pronouns accidentally slip
 * into client-facing UI components or application-level user messages, this test scans all
 * source files under `src/web` and `src/application` against a curated denylist of voseo forms.
 */
const VOSEO_DENYLIST: { term: string; pattern: RegExp; replacement: string }[] = [
  { term: "tenés", pattern: /\btenés\b/i, replacement: "tienes / hay" },
  { term: "podés", pattern: /\bpodés\b/i, replacement: "puedes" },
  { term: "querés", pattern: /\bquerés\b/i, replacement: "quieres" },
  { term: "sincronizá", pattern: /\bsincronizá\b/i, replacement: "sincroniza" },
  { term: "elegí", pattern: /\belegí\b/i, replacement: "elige" },
  { term: "hacé", pattern: /\bhacé\b/i, replacement: "haz / realiza" },
  { term: "usá", pattern: /\busá\b/i, replacement: "usa / utiliza" },
  { term: "escribí", pattern: /\bescribí\b/i, replacement: "escribe" },
  { term: "mirá", pattern: /\bmirá\b/i, replacement: "mira / revisa" },
  { term: "decidís", pattern: /\bdecidís\b/i, replacement: "decides" },
  { term: "agregá", pattern: /\bagregá\b/i, replacement: "agrega / añade" },
  { term: "revisá", pattern: /\brevisá\b/i, replacement: "revisa" },
  { term: "cargá", pattern: /\bcargá\b/i, replacement: "carga" },
  { term: "guardá", pattern: /\bguardá\b/i, replacement: "guarda" },
  { term: "borrá", pattern: /\bborrá\b/i, replacement: "borra / elimina" },
  { term: "mostrá", pattern: /\bmostrá\b/i, replacement: "muestra" },
  { term: "pensá", pattern: /\bpensá\b/i, replacement: "piensa" },
  { term: "tomá", pattern: /\btomá\b/i, replacement: "toma" },
  { term: "dejá", pattern: /\bdejá\b/i, replacement: "deja" },
  { term: "cambiá", pattern: /\bcambiá\b/i, replacement: "cambia" },
  { term: "probá", pattern: /\bprobá\b/i, replacement: "prueba" },
  { term: "recordá", pattern: /\brecordá\b/i, replacement: "recuerda" },
  { term: "ingresá", pattern: /\bingresá\b/i, replacement: "ingresa / introduce" },
  { term: "anotá", pattern: /\banotá\b/i, replacement: "anota" },
  { term: "vos", pattern: /\bvos\b/i, replacement: "tú / ti / usted" },
];

function getFilesRecursively(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getFilesRecursively(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("FIX 2: Voseo denylist regression guard", () => {
  const targetDirs = [
    path.resolve(__dirname, "../src/web"),
    path.resolve(__dirname, "../src/application"),
  ];

  it("ensures no voseo forms exist in src/web or src/application user-facing code", () => {
    const violations: string[] = [];

    for (const dir of targetDirs) {
      const files = getFilesRecursively(dir);
      for (const file of files) {
        const relativePath = path.relative(path.resolve(__dirname, ".."), file);
        const lines = fs.readFileSync(file, "utf-8").split("\n");

        lines.forEach((line, index) => {
          for (const item of VOSEO_DENYLIST) {
            if (item.pattern.test(line)) {
              violations.push(
                `${relativePath}:${index + 1}: Found '${item.term}' (recommendation: '${item.replacement}')\n  Line: ${line.trim()}`
              );
            }
          }
        });
      }
    }

    expect(
      violations,
      `Voseo forms found in user-facing source code:\n${violations.join("\n")}`
    ).toHaveLength(0);
  });

  it("verifies the specific corrected user-facing strings", () => {
    const calendarCardPath = path.resolve(
      __dirname,
      "../src/web/components/calendar-sync-card.tsx"
    );
    const calendarContent = fs.readFileSync(calendarCardPath, "utf-8");
    expect(calendarContent).toContain("Sincroniza tus reuniones");
    expect(calendarContent).toMatch(/Tienes tu capacidad 100%\s+libre\./);
    expect(calendarContent).not.toContain("Sincronizá");
    expect(calendarContent).not.toContain("Tenés");

    const radarPath = path.resolve(__dirname, "../src/application/radar-pipeline.ts");
    const radarContent = fs.readFileSync(radarPath, "utf-8");
    expect(radarContent).toContain("Tienes suficiente margen en tu semana");
    expect(radarContent).not.toContain("Tenés");

    const adjustmentPanelPath = path.resolve(
      __dirname,
      "../src/web/components/active-week-adjustment-panel.tsx"
    );
    const adjustmentContent = fs.readFileSync(adjustmentPanelPath, "utf-8");
    expect(adjustmentContent).toContain(
      "Elige una tarea para definir sus horas o programarla en un día específico."
    );
    expect(adjustmentContent).not.toContain("Elegí una tarea");
  });
});
