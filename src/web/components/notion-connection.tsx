import { useEffect, useRef, useState } from "react";
import type { NotionExportRow } from "../notion-export";
import type { NotionSnapshot } from "../../application/notion-snapshot";

type Connection = {
  available: boolean;
  connected: boolean;
  workspace?: string;
  message?: string;
  code?: string;
};
type SendResult = {
  status: "complete" | "uncertain" | "sending";
  url?: string;
  message: string;
  sent: number;
};
async function request(path: string, body?: unknown) {
  const response = await fetch(`/api/notion/${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      (data.message ?? "No se pudo conectar con Notion.") + (data.code ? ` (${data.code})` : "")
    );
  return data;
}
const iso = (date: string) =>
  date ? `${date.slice(6, 10)}-${date.slice(0, 2)}-${date.slice(3, 5)}` : "";
export function NotionConnection({
  title,
  getRows,
}: {
  title: string;
  getRows: () => NotionExportRow[];
}) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<NotionSnapshot | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const sending = useRef(false);
  const connectRequested = useRef(false);
  const refreshVersion = useRef(0);
  const latest = useRef({ title, getRows });
  latest.current = { title, getRows };
  const preparePreview = () => {
    setError(null);
    setResult(null);
    try {
      setPreview({
        title: latest.current.title,
        rows: latest.current
          .getRows()
          .map((row) => ({ ...row, date: iso(row.date), deadline: iso(row.deadline) })),
      });
    } catch {
      setError("Revisa las asignaciones antes de enviar la semana.");
    }
  };
  const refresh = async () => {
    const version = ++refreshVersion.current;
    try {
      const data = await request("status");
      if (version !== refreshVersion.current) return;
      setConnection(data);
      if (data.message) {
        setError(data.message + (data.code ? ` (${data.code})` : ""));
        setConnecting(false);
        connectRequested.current = false;
      } else if (data.connected) {
        setConnecting(false);
        if (connectRequested.current) {
          connectRequested.current = false;
          preparePreview();
        }
      }
    } catch {
      if (version !== refreshVersion.current) return;
      setConnection({
        available: false,
        connected: false,
        message: "No se puede acceder a la conexión de Notion en este momento.",
      });
    }
  };
  useEffect(() => {
    void refresh();
    const listener = (event: MessageEvent) => {
      if (
        event.origin === window.location.origin &&
        event.data?.type === "conscious-notion-connected"
      ) {
        void refresh();
        setConnecting(false);
        window.dispatchEvent(new Event("notion-connection-changed"));
      }
    };
    const changed = () => {
      void refresh();
    };
    window.addEventListener("message", listener);
    window.addEventListener("focus", changed);
    window.addEventListener("notion-connection-changed", changed);
    return () => {
      window.removeEventListener("message", listener);
      window.removeEventListener("focus", changed);
      window.removeEventListener("notion-connection-changed", changed);
    };
  }, []);
  useEffect(() => {
    if (!connecting) return;
    // OAuth providers can detach window.opener. Observe completion without relying on it.
    const poll = window.setInterval(() => {
      void refresh();
    }, 3000);
    const timeout = window.setTimeout(() => {
      setConnecting(false);
      connectRequested.current = false;
      setError("La autorización ha caducado. Pulsa «Conectar Notion» para intentarlo de nuevo.");
    }, 10 * 60_000);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(timeout);
    };
  }, [connecting]);
  return (
    <section
      className="notion-connection"
      data-testid="notion-connection"
      aria-label="Conectar y enviar a Notion"
    >
      <h4>Tu calendario en Notion</h4>
      <p>
        Conectar la cuenta no crea el calendario. Revisa esta semana y pulsa «Confirmar y enviar»
        para crearlo en Notion.
      </p>
      {connection?.connected ? (
        <>
          <p data-testid="notion-connected">
            Conectado{connection.workspace ? ` a ${connection.workspace}` : " a Notion"}.
          </p>
          <button
            type="button"
            className="secondary small"
            disabled={busy}
            onClick={preparePreview}
          >
            Enviar calendario a Notion
          </button>
          <button
            type="button"
            className="secondary small"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await request("disconnect", {});
                setPreview(null);
                setResult(null);
                await refresh();
                window.dispatchEvent(new Event("notion-connection-changed"));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Desconectar
          </button>
          <p className="calm-muted">
            Desconectar retira el acceso desde esta app; las copias ya enviadas permanecen en
            Notion. Puedes revocar el permiso en los ajustes de Notion.
          </p>
        </>
      ) : (
        <>
          <button
            type="button"
            className="secondary small"
            disabled={busy || connection?.available === false}
            onClick={async () => {
              const tab = window.open(
                "about:blank",
                "conscious-notion-connect",
                "popup,width=650,height=750"
              );
              if (!tab) {
                setError("Permite abrir la ventana de autorización para conectar Notion.");
                return;
              }
              setBusy(true);
              setError(null);
              setConnecting(true);
              connectRequested.current = true;
              try {
                const data = await request("connect", {});
                const url = new URL(data.authorizationUrl);
                if (url.origin !== "https://mcp.notion.com")
                  throw new Error("La autorización de Notion no es válida.");
                tab.location.href = url.href;
              } catch (e) {
                tab.close();
                setConnecting(false);
                connectRequested.current = false;
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Conectar Notion
          </button>
          {connecting && (
            <p role="status">
              Autoriza la conexión en la ventana de Notion. Después{" "}
              <button
                type="button"
                className="secondary small"
                onClick={() => {
                  void refresh();
                }}
              >
                Comprobar conexión
              </button>
            </p>
          )}
          {connection?.available === false && <p>{connection.message}</p>}
          <p className="calm-muted">
            El permiso se solicita en Notion. No necesitas copiar claves ni contraseñas.
          </p>
        </>
      )}
      {preview && (
        <div className="notion-send-preview" data-testid="notion-send-preview">
          <strong>{preview.title}</strong>
          <p>
            Se creará una base privada nueva en {connection?.workspace ?? "tu espacio de Notion"},
            con una vista de calendario.
          </p>
          <p>
            {preview.rows.length} entradas: {preview.rows.filter((row) => row.date).length} con
            fecha y {preview.rows.filter((row) => !row.date).length} sin día. Cada parte repartida
            conserva sus horas.
          </p>
          <ul className="notion-preview-rows">
            {preview.rows.map((row, index) => (
              <li key={index}>
                {row.name} · {row.date || "Sin día"}
                {row.hours !== null ? ` · ${row.hours} h` : ""} · {row.status}
              </li>
            ))}
          </ul>
          <p>
            Se enviarán nombres, fechas, estados y horas, incluidos los elementos sin día. No se
            enviarán notas originales ni la copia completa del cuaderno. Si la semana ha cambiado o
            has conectado la cuenta de nuevo, se creará otra copia.
          </p>
          <button
            type="button"
            className="primary small"
            disabled={busy || !preview.rows.length || preview.rows.length > 300}
            onClick={async () => {
              if (sending.current) return;
              sending.current = true;
              setBusy(true);
              setError(null);
              try {
                const data = await request("send", preview);
                setResult(data);
                setPreview(null);
              } catch (e) {
                setError((e as Error).message);
                void refresh();
              } finally {
                sending.current = false;
                setBusy(false);
              }
            }}
          >
            {busy ? "Enviando…" : "Confirmar y enviar"}
          </button>
          <button
            type="button"
            className="secondary small"
            disabled={busy}
            onClick={() => setPreview(null)}
          >
            Cancelar
          </button>
          {preview.rows.length > 300 && (
            <p role="alert">
              Esta semana supera el límite de 300 entradas. Puedes usar la exportación CSV.
            </p>
          )}
        </div>
      )}
      {result && (
        <div role="status">
          <p>{result.message}</p>
          {result.url && /^https:\/\/(www\.)?notion\.so\//.test(result.url) && (
            <a href={result.url} target="_blank" rel="noopener noreferrer">
              {result.status === "complete"
                ? "Abrir calendario en Notion"
                : "Revisar copia en Notion"}
            </a>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
