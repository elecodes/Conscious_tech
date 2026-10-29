import { useState, useEffect } from "react";
import { TargetWeek } from "../../domain/week";
import {
  CalendarWeekSummary,
  calculateCalendarWeekSummary,
} from "../../domain/calendar";
import { parseIcalContent } from "../../infrastructure/calendar/ical-parser";

export interface CalendarSyncCardProps {
  targetWeek: TargetWeek;
  onCalendarApplied: (summary: CalendarWeekSummary) => void;
  baseDailyHours?: number;
}

const STORAGE_KEY_ICAL_URL = "conscious_tech_google_ical_url";

export function CalendarSyncCard({
  targetWeek,
  onCalendarApplied,
  baseDailyHours = 8,
}: CalendarSyncCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [icalUrl, setIcalUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<CalendarWeekSummary | null>(null);

  // Load saved iCal URL
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_ICAL_URL);
      if (saved) setIcalUrl(saved);
    } catch {
      // Ignore localStorage unavailable in some test/sandbox environments
    }
  }, []);

  const handleSyncFromUrl = async () => {
    if (!icalUrl.trim()) {
      setErrorMessage("Por favor ingresá la URL secreta de iCal de tu Google Calendar.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      // Save for future planning sessions
      try {
        localStorage.setItem(STORAGE_KEY_ICAL_URL, icalUrl.trim());
      } catch {
        // Ignore
      }

      const res = await fetch("/api/calendar/fetch-ical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: icalUrl.trim() }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "No se pudo sincronizar con el calendario.");
      }

      const events = parseIcalContent(data.ics, {
        startDate: targetWeek.startDate,
        endDate: targetWeek.endDate,
      });

      const summary = calculateCalendarWeekSummary(events, targetWeek, baseDailyHours);
      setLastSummary(summary);
      onCalendarApplied(summary);
    } catch (err: unknown) {
      setErrorMessage((err as Error).message || "Error al sincronizar el calendario.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setErrorMessage(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        if (!content) throw new Error("El archivo está vacío.");

        const events = parseIcalContent(content, {
          startDate: targetWeek.startDate,
          endDate: targetWeek.endDate,
        });

        const summary = calculateCalendarWeekSummary(events, targetWeek, baseDailyHours);
        setLastSummary(summary);
        onCalendarApplied(summary);
      } catch (err: unknown) {
        setErrorMessage((err as Error).message || "Error al procesar el archivo .ics.");
      } finally {
        setIsLoading(false);
      }
    };
    reader.onerror = () => {
      setErrorMessage("Error de lectura al cargar el archivo.");
      setIsLoading(false);
    };
    reader.readAsText(file);
  };

  return (
    <div
      data-testid="calendar-sync-card"
      style={{
        border: "1px solid var(--border-subtle, #e2e8f0)",
        borderRadius: "8px",
        padding: "12px 16px",
        background: "var(--card-bg, #f8fafc)",
        marginBottom: "16px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          cursor: "pointer",
        }}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "1.1rem" }}>📅</span>
          <div>
            <strong style={{ fontSize: "0.92rem", color: "var(--text-main, #0f172a)" }}>
              Google Calendar (Compromisos fijos)
            </strong>
            <div style={{ fontSize: "0.78rem", color: "var(--text-muted, #64748b)" }}>
              {lastSummary
                ? `${lastSummary.events.length} eventos para esta semana (${lastSummary.totalCommittedHours}h comprometidas)`
                : "Sincronizá tus reuniones para calcular tu capacidad real honesta"}
            </div>
          </div>
        </div>
        <button
          type="button"
          className="secondary small"
          style={{ padding: "3px 8px", fontSize: "0.8rem" }}
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(!isOpen);
          }}
        >
          {isOpen ? "Ocultar" : "Conectar / Sincronizar"}
        </button>
      </div>

      {isOpen && (
        <div style={{ marginTop: "14px", borderTop: "1px solid #e2e8f0", paddingTop: "12px" }}>
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted, #475569)", marginBottom: "10px" }}>
            Pegá la <strong>Dirección secreta en formato iCal</strong> de tu Google Calendar (la encontrás en <em>Google Calendar &gt; Configuración &gt; Tu calendario &gt; Integrar el calendario</em>) o subí tu archivo <code>.ics</code>:
          </p>

          <div style={{ display: "flex", gap: "8px", marginBottom: "8px", flexWrap: "wrap" }}>
            <input
              type="url"
              data-testid="ical-url-input"
              placeholder="https://calendar.google.com/calendar/ical/.../private-.../basic.ics"
              value={icalUrl}
              onChange={(e) => setIcalUrl(e.target.value)}
              disabled={isLoading}
              style={{
                flex: 1,
                minWidth: "260px",
                padding: "7px 10px",
                fontSize: "0.85rem",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
              }}
            />
            <button
              type="button"
              data-testid="sync-calendar-btn"
              className="primary small"
              onClick={handleSyncFromUrl}
              disabled={isLoading || !icalUrl.trim()}
              style={{ padding: "7px 14px", fontSize: "0.85rem" }}
            >
              {isLoading ? "Sincronizando..." : "Sincronizar"}
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
            <span style={{ fontSize: "0.78rem", color: "#64748b" }}>o cargar archivo .ics:</span>
            <input
              type="file"
              accept=".ics,text/calendar"
              data-testid="ical-file-input"
              onChange={handleFileUpload}
              disabled={isLoading}
              style={{ fontSize: "0.78rem" }}
            />
          </div>

          <div
            style={{
              fontSize: "0.74rem",
              color: "var(--text-muted, #64748b)",
              marginBottom: "12px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span>🔒</span>
            <span>
              <strong>Privacidad:</strong> La URL privada se procesa localmente en tu máquina (POST seguro) para sincronizar reuniones sin almacenarse en servidores de terceros ni en registros de URL.
            </span>
          </div>

          {errorMessage && (
            <div
              data-testid="calendar-error"
              style={{
                fontSize: "0.82rem",
                color: "#dc2626",
                background: "#fef2f2",
                padding: "6px 10px",
                borderRadius: "4px",
                marginBottom: "8px",
              }}
            >
              ⚠️ {errorMessage}
            </div>
          )}

          {lastSummary && (
            <div
              data-testid="calendar-summary-preview"
              style={{
                marginTop: "10px",
                padding: "10px",
                borderRadius: "6px",
                background: "#f1f5f9",
                fontSize: "0.82rem",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                <strong style={{ color: "#1e293b" }}>
                  Semana {lastSummary.targetWeek.startDate} al {lastSummary.targetWeek.endDate}
                </strong>
                <span style={{ fontWeight: 600, color: "#0369a1" }}>
                  {lastSummary.totalCommittedHours}h comprometidas en reuniones
                </span>
              </div>

              {lastSummary.events.length === 0 ? (
                <div style={{ color: "#64748b", fontStyle: "italic" }}>
                  No se encontraron eventos con horario para esta semana. Tenés tu capacidad 100% libre.
                </div>
              ) : (
                <ul style={{ margin: 0, paddingLeft: "18px", color: "#334155" }}>
                  {lastSummary.events.slice(0, 5).map((ev) => (
                    <li key={ev.id} style={{ marginBottom: "3px" }}>
                      <strong>{ev.day}</strong> {ev.startTime !== "00:00" ? `(${ev.startTime} - ${ev.endTime})` : "(Todo el día)"}: {ev.title} {ev.durationHours > 0 ? `· ${ev.durationHours}h` : ""}
                    </li>
                  ))}
                  {lastSummary.events.length > 5 && (
                    <li style={{ color: "#64748b", listStyle: "none" }}>
                      ... y {lastSummary.events.length - 5} eventos más.
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
