import { describe, it, expect } from "vitest";
import { formatTaskDictation } from "../src/web/task-dictation";
import { extractItems } from "../src/skills/extract-items";
import { MockProvider } from "../src/providers/mock-provider";
describe("Explicit voice task separators", () => {
  it("turns a spoken list into separate extracted tasks without splitting effort or numbers", async () => {
    const spoken =
      "Estudiar Python 2 horas, siguiente tarea, preparar Big school 3 horas, siguiente tarea, practicar typing 1 hora";
    const text = formatTaskDictation(spoken, "es-ES");
    expect(text).toBe(
      "Estudiar Python 2 horas\npreparar Big school 3 horas\npracticar typing 1 hora"
    );
    const result = await extractItems(new MockProvider(), {
      text,
      currentDate: "2026-11-12",
      locale: "es-ES",
    });
    expect(result.items).toHaveLength(3);
    expect(result.items.map((item) => item.estimatedEffort?.value)).toEqual([2, 3, 1]);
  });
  it("accepts punctuation/case and a command at the beginning or end without blank task multiplication", () => {
    expect(
      formatTaskDictation(
        "Siguiente tarea. Leer. SIGUIENTE TAREA: Practicar. siguiente tarea siguiente tarea",
        "es-ES"
      )
    ).toBe("\nLeer\nPracticar\n");
    expect(formatTaskDictation("Learn Python, next task, write a report", "en-US")).toBe(
      "Learn Python\nwrite a report"
    );
    expect(
      formatTaskDictation("Escribir las siguientes tareas y revisar tarea uno 2.5 horas", "es-ES")
    ).toBe("Escribir las siguientes tareas y revisar tarea uno 2.5 horas");
  });
});

it("accepts short and legacy commands from the user's captured example and protects next-week context", async () => {
  const text =
    "Seguir avanzando en patrones siguiente tarea seguir con lessons de Big school siguiente seguir con mis apps la siguiente tarea a seguir con lógica";
  const normalized = formatTaskDictation(text, "es-ES");
  expect(normalized.split("\n")).toHaveLength(4);
  const result = await extractItems(new MockProvider(), {
    text: normalized,
    currentDate: "2026-11-12",
  });
  expect(result.items).toHaveLength(4);
  expect(result.items.some((item) => /siguiente/.test(item.title))).toBe(false);
  expect(formatTaskDictation("Preparar la siguiente semana 2 horas", "es-ES")).toBe(
    "Preparar la siguiente semana 2 horas"
  );
});
