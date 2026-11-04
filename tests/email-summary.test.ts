import { describe, it, expect } from "vitest";
import { buildEmailSummary, EmailSummaryInput } from "../src/domain/email-summary";

describe("Email summary builder", () => {
  const baseInput: EmailSummaryInput = {
    targetWeek: {
      startDate: "2026-10-19",
      endDate: "2026-10-25",
    },
    items: [
      {
        title: "Reunión de coordinación estratégica",
        day: "2026-10-19",
        startTime: "09:30",
        source: "Compromiso",
      },
      {
        title: "Entrega de propuesta técnica",
        day: "2026-10-21",
        source: "Foco",
      },
      {
        title: "Revisar documentación",
        source: "Tarea",
      },
    ],
  };

  it("generates subject with exact format 'Mi semana · <rango de fechas>'", () => {
    const summary = buildEmailSummary(baseInput);
    expect(summary.subject).toBe("Mi semana · 2026-10-19 al 2026-10-25");
  });

  it("produces plain text body without internal IDs, JSON, or voseo", () => {
    const summary = buildEmailSummary(baseInput);
    expect(summary.fullBody).toContain("Mi semana (2026-10-19 al 2026-10-25)");
    expect(summary.fullBody).toContain("Reunión de coordinación estratégica (2026-10-19 09:30)");
    expect(summary.fullBody).toContain("Entrega de propuesta técnica (2026-10-21)");
    expect(summary.fullBody).toContain("Revisar documentación");
    expect(summary.fullBody).not.toContain("{");
    expect(summary.fullBody).not.toContain("}");
    expect(summary.fullBody).not.toContain("item-");
    expect(summary.fullBody).not.toContain("planId");
  });

  it("includes reflections and what was learned when provided in Cierre", () => {
    const cierreInput: EmailSummaryInput = {
      ...baseInput,
      reflections: {
        notes: "Semana productiva y con buen foco matutino.",
        learned: [
          "Mantener las mañanas libres de reuniones protege la atención.",
          "Las tareas de más de 2h conviene partirlas.",
        ],
      },
    };

    const summary = buildEmailSummary(cierreInput);
    expect(summary.fullBody).toContain("Lo que he aprendido:");
    expect(summary.fullBody).toContain(
      "Mantener las mañanas libres de reuniones protege la atención."
    );
    expect(summary.fullBody).toContain("Reflexión personal:");
    expect(summary.fullBody).toContain("Semana productiva y con buen foco matutino.");
  });

  it("leaves the recipient empty in both Gmail and mailto URLs", () => {
    const summary = buildEmailSummary(baseInput);
    expect(summary.gmailUrl).toContain("https://mail.google.com/mail/?view=cm&fs=1");
    // Should NOT contain to= or any email address
    expect(summary.gmailUrl).not.toContain("&to=");
    expect(summary.gmailUrl).not.toContain("?to=");
    expect(summary.mailtoUrl.startsWith("mailto:?subject=")).toBe(true);
  });

  it("caps body at ~1,500 characters and truncates gracefully with fallback note", () => {
    // Generate lots of items to exceed 1,500 chars
    const manyItems = Array.from({ length: 50 }, (_, i) => ({
      title: `Tarea extendida número ${i + 1} para verificar el límite de caracteres en la URL`,
      day: "2026-10-20",
      source: "Tarea",
    }));

    const summary = buildEmailSummary({
      ...baseInput,
      items: manyItems,
    });

    expect(summary.fullBody.length).toBeGreaterThan(1500);
    expect(summary.isTruncated).toBe(true);
    expect(summary.truncatedBody.length).toBeLessThanOrEqual(1550);
    expect(summary.truncatedBody).toContain("… (ver el resto en la app)");
    expect(summary.gmailUrl.length).toBeLessThan(3000);
  });
});
