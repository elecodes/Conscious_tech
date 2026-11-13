import { useEffect, useRef, useState } from "react";
import type { StoredWeeklyPlan, StoredCloseWeekReport } from "../../domain/repositories/types";
import type { WeeklySchedule } from "../../domain/schedule";
import type { GoogleCalendarExport } from "../../application/google-calendar-export";
import { notionExportRows } from "../notion-export";
import { extractPlanItems } from "./weekly-session-formatters";

type Calendar = { id: string; summary: string };
type Preview = {
  nonce: string;
  create: number;
  update: number;
  remove: number;
  unchanged: number;
  undated: number;
  conflicts: number;
};
const iso = (date: string) =>
  date ? `${date.slice(6, 10)}-${date.slice(0, 2)}-${date.slice(3, 5)}` : "";
function notebookId() {
  const key = "conscious_tech_google_calendar_notebook_id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}
async function request(path: string, body?: unknown) {
  const response = await fetch("/api/google-calendar/" + path, {
    cache: "no-store",
    credentials: "same-origin",
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      `${data.message ?? "No se pudo conectar con Google Calendar."}${data.code ? ` (${data.code})` : ""}`
    );
  return data;
}
export function GoogleCalendarConnection({
  plan,
  schedule,
  report,
}: {
  plan: StoredWeeklyPlan;
  schedule: WeeklySchedule | null;
  report?: StoredCloseWeekReport;
}) {
  const [status, setStatus] = useState<{
    configured: boolean;
    connected: boolean;
    message?: string;
  } | null>(null);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [selected, setSelected] = useState("");
  const [timeZone, setTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ data: Preview; input: GoogleCalendarExport } | null>(
    null
  );
  const [result, setResult] = useState<{ verified: number; url: string } | null>(null);
  const mounted = useRef(true);
  const sending = useRef(false);
  const refresh = async () => {
    try {
      const data = await request("status");
      if (!mounted.current) return;
      setStatus(data);
      if (data.connected) {
        setConnecting(false);
        const response = await request("calendars");
        if (mounted.current) setCalendars(response.calendars);
      }
      if (data.message && data.configured) {
        setError(data.message);
        setConnecting(false);
      }
    } catch {
      if (mounted.current) setError("No se puede comprobar la conexión de Google Calendar.");
    }
  };
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const listener = (event: MessageEvent) => {
      if (event.origin === location.origin && event.data?.type === "conscious-google-connected")
        void refresh();
    };
    const focus = () => {
      void refresh();
    };
    window.addEventListener("message", listener);
    window.addEventListener("focus", focus);
    return () => {
      mounted.current = false;
      window.removeEventListener("message", listener);
      window.removeEventListener("focus", focus);
    };
  }, []);
  useEffect(() => {
    if (!connecting) return;
    const interval = setInterval(() => {
      void refresh();
    }, 4000);
    const timeout = setTimeout(() => {
      setConnecting(false);
      setError("La autorización ha caducado. Vuelve a conectar.");
    }, 600000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [connecting]);
  useEffect(() => {
    setPreview(null);
  }, [plan.planId, plan.updatedAt, schedule?.version]);
  return (
    <section
      className="notion-export"
      data-testid="google-calendar-connection"
      aria-label="Google Calendar"
    >
      <h4>Tu semana en Google Calendar</h4>
      <p>
        Elige calendario y revisa antes de enviar. Los cambios posteriores se envían cuando tú lo
        decides.
      </p>
      {!status?.connected ? (
        <>
          <button
            type="button"
            className="secondary small"
            disabled={busy || !status?.configured}
            onClick={async () => {
              const popup = window.open(
                "about:blank",
                "conscious-google-connect",
                "popup,width=650,height=750"
              );
              if (!popup) {
                setError("Permite la ventana de autorización para conectar Google Calendar.");
                return;
              }
              setBusy(true);
              setError(null);
              setConnecting(true);
              try {
                const data = await request("connect", {});
                const url = new URL(data.authorizationUrl);
                if (url.origin !== "https://accounts.google.com")
                  throw new Error("La autorización de Google no es válida.");
                popup.location.href = url.href;
              } catch (e) {
                popup.close();
                setConnecting(false);
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Conectar Google Calendar
          </button>
          {connecting && (
            <p role="status">
              Autoriza la cuenta en la ventana de Google. Todavía no se enviará ningún evento.
            </p>
          )}
          {status?.configured === false && (
            <details>
              <summary>Configurar Google Calendar</summary>
              <p>
                Esta instalación necesita un cliente OAuth de Google Cloud y la API de Calendar
                habilitada. Consulta «Conectar Google Calendar» en el README. Las claves se
                configuran en el servidor, nunca aquí.
              </p>
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noopener noreferrer"
              >
                Abrir credenciales de Google Cloud
              </a>
            </details>
          )}
        </>
      ) : (
        <>
          <p>Cuenta conectada.</p>
          <label>
            Calendario de destino{" "}
            <select
              aria-label="Calendario de destino"
              value={selected}
              disabled={busy}
              onChange={(event) => {
                setSelected(event.target.value);
                setPreview(null);
                setResult(null);
              }}
            >
              <option value="">Elige un calendario</option>
              {calendars.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.summary}
                </option>
              ))}
            </select>
          </label>
          {!calendars.length && (
            <p>
              No hay calendarios propios disponibles. Solo se muestran calendarios de los que eres
              propietario.
            </p>
          )}
          <label>
            Zona horaria{" "}
            <input
              aria-label="Zona horaria de Google Calendar"
              value={timeZone}
              disabled={busy}
              onChange={(event) => {
                setTimeZone(event.target.value);
                setPreview(null);
              }}
            />
          </label>
          <button
            type="button"
            className="secondary small"
            disabled={busy || !selected}
            onClick={async () => {
              setBusy(true);
              setError(null);
              setResult(null);
              setPreview(null);
              try {
                const input: GoogleCalendarExport = {
                  notebookId: notebookId(),
                  planId: plan.planId,
                  calendarId: selected,
                  timeZone,
                  snapshot: {
                    title: `Conscious Tech · ${plan.targetWeek.startDate} – ${plan.targetWeek.endDate}`,
                    rows: notionExportRows(
                      plan,
                      schedule,
                      extractPlanItems(plan, schedule),
                      report
                    ).map((row) => ({ ...row, date: iso(row.date), deadline: iso(row.deadline) })),
                  },
                };
                const data = await request("preview", input);
                setPreview({ input, data });
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Revisar envío a Google Calendar
          </button>
          <button
            type="button"
            className="secondary small"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await request("disconnect", {});
                setPreview(null);
                setResult(null);
                setCalendars([]);
                setSelected("");
                await refresh();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Desconectar Google Calendar
          </button>
          <p>
            Desconectar conserva los eventos enviados. Puedes revocar el permiso desde tu cuenta de
            Google.
          </p>
        </>
      )}
      {preview && (
        <div className="notion-send-preview" data-testid="google-calendar-preview">
          <strong>
            {calendars.find((calendar) => calendar.id === selected)?.summary} ·{" "}
            {preview.input.snapshot.title}
          </strong>
          <p>
            {preview.data.create} nuevos · {preview.data.update} actualizaciones ·{" "}
            {preview.data.remove} eliminaciones de eventos enviados por esta app ·{" "}
            {preview.data.unchanged} sin cambios.
          </p>
          <p>
            {preview.data.undated} entradas sin fecha seguirán en la app. Las horas sin horario se
            envían como eventos de día completo, sin bloquear tu disponibilidad.
          </p>
          <ul className="notion-preview-rows">
            {preview.input.snapshot.rows
              .filter((row) => row.date)
              .map((row, index) => (
                <li key={index}>
                  {row.date} · {row.name}
                  {row.hours !== null ? ` · ${row.hours} h` : ""}
                  {row.time ? ` · ${row.time}` : ""}
                </li>
              ))}
          </ul>
          {preview.data.conflicts > 0 && (
            <p role="alert">
              Hay cambios hechos directamente en Google Calendar. Revísalos allí antes de
              actualizar; no se sobrescribirán.
            </p>
          )}
          <button
            type="button"
            className="primary small"
            disabled={busy || preview.data.conflicts > 0}
            onClick={async () => {
              if (sending.current) return;
              sending.current = true;
              setBusy(true);
              setError(null);
              try {
                const data = await request("send", {
                  input: preview.input,
                  nonce: preview.data.nonce,
                });
                setResult(data);
                setPreview(null);
              } catch (e) {
                setError((e as Error).message);
                setPreview(null);
                void refresh();
              } finally {
                sending.current = false;
                setBusy(false);
              }
            }}
          >
            {busy ? "Enviando…" : "Confirmar cambios en Google Calendar"}
          </button>
          <button
            type="button"
            className="secondary small"
            disabled={busy}
            onClick={() => setPreview(null)}
          >
            Cancelar envío a Google Calendar
          </button>
        </div>
      )}
      {result && (
        <p role="status">
          {result.verified} eventos comprobados en Google Calendar.{" "}
          <a href={result.url} target="_blank" rel="noopener noreferrer">
            Abrir Google Calendar
          </a>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
