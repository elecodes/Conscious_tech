import { useState, useEffect } from "react";
import { ExtractedItem, ExtractedItems } from "../domain/items";
import { MockProvider } from "../providers/mock-provider";
import { RemoteAIProvider } from "../providers/remote-ai-provider";
import { extractItems } from "../skills/extract-items";
import sampleDumpsData from "../../cases/sample-dumps.json";
import { WeeklySessionProvider, useWeeklySession } from "./context/weekly-session-context";
import { WeeklySessionView } from "./components/weekly-session-view";
import { WeeklySessionService } from "../application/weekly-session-service";

export type NavigationSpace = "capture" | "prepare" | "active" | "review";

export interface AppProps {
  service?: WeeklySessionService;
  initialTab?: "dump" | "weekly" | NavigationSpace;
}

const STORAGE_KEY_CAPTURE_TEXT = "conscious_tech_transient_dump_text";
const STORAGE_KEY_CAPTURE_RESULT = "conscious_tech_transient_dump_result";

function ProcessStatusBadge() {
  const { state } = useWeeklySession();
  const activePlan =
    state.activePlan && state.activePlan.status === "active" ? state.activePlan : null;
  const draftPlan =
    state.draftPlan ||
    (state.draftPlans && state.draftPlans.length > 0 ? state.draftPlans[0] : null);

  return (
    <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
      {activePlan ? (
        <span className="badge badge-task" data-testid="process-status-badge">
          🟢 Semana activa ({activePlan.targetWeek.startDate} al {activePlan.targetWeek.endDate})
        </span>
      ) : state.latestClosedWeek ? (
        <span className="badge badge-muted" data-testid="process-status-badge">
          Última semana cerrada ({state.latestClosedWeek.plan.targetWeek.startDate})
        </span>
      ) : (
        <span className="badge badge-idea" data-testid="process-status-badge">
          Borrador / Sin semana activa
        </span>
      )}

      {draftPlan && activePlan && (
        <span
          className="badge badge-idea"
          data-testid="future-draft-badge"
          style={{ background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }}
        >
          📝 Borrador futuro ({draftPlan.targetWeek.startDate} al {draftPlan.targetWeek.endDate})
        </span>
      )}
    </div>
  );
}

function AppContent({
  initialTab = "active",
}: {
  initialTab?: "dump" | "weekly" | NavigationSpace;
}) {
  const { state, exportBackup, importBackup } = useWeeklySession();
  const resolveInitialSpace = (): NavigationSpace => {
    if (initialTab === "dump") return "capture";
    if (initialTab === "weekly") return "active";
    return initialTab;
  };

  const [activeSpace, setActiveSpace] = useState<NavigationSpace>(resolveInitialSpace);
  const [providerType, setProviderType] = useState<"mock" | "groq" | "gemini">("mock");
  const [text, setText] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_CAPTURE_TEXT) || "";
    } catch {
      return "";
    }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractedItems | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_CAPTURE_RESULT);
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore
    }
    return null;
  });
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [showRawJson, setShowRawJson] = useState(false);
  const [planningItems, setPlanningItems] = useState<ExtractedItem[] | null>(null);
  const [backupStatus, setBackupStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Autosave mental dump text
  useEffect(() => {
    try {
      if (text) {
        localStorage.setItem(STORAGE_KEY_CAPTURE_TEXT, text);
      } else {
        localStorage.removeItem(STORAGE_KEY_CAPTURE_TEXT);
      }
    } catch {
      // ignore
    }
  }, [text]);

  // Autosave extracted result
  useEffect(() => {
    try {
      if (result) {
        localStorage.setItem(STORAGE_KEY_CAPTURE_RESULT, JSON.stringify(result));
      } else {
        localStorage.removeItem(STORAGE_KEY_CAPTURE_RESULT);
      }
    } catch {
      // ignore
    }
  }, [result]);

  const handleClearDump = () => {
    setText("");
    setResult(null);
    setSelectedCaseId("");
    try {
      localStorage.removeItem(STORAGE_KEY_CAPTURE_TEXT);
      localStorage.removeItem(STORAGE_KEY_CAPTURE_RESULT);
    } catch {
      // ignore
    }
  };

  const handleExportBackup = async () => {
    if (!exportBackup) return;
    try {
      setBackupStatus(null);
      const backupData = await exportBackup();
      const jsonStr = JSON.stringify(backupData, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const today = new Date().toISOString().split("T")[0];
      a.href = url;
      a.download = `conscious_tech_backup_${today}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setBackupStatus({
        type: "success",
        message: `Copia descargada correctamente (${backupData.data.plans.length} planes, ${backupData.data.schedules.length} agendas, ${backupData.data.closeReports.length} cierres, ${backupData.data.memories.length} recuerdos).`,
      });
    } catch (err) {
      setBackupStatus({
        type: "error",
        message: `Error al exportar la copia: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const handleImportBackupFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !importBackup) return;
    try {
      setBackupStatus(null);
      const content = await file.text();
      const res = await importBackup(content);
      setBackupStatus({
        type: "success",
        message: `Copia restaurada con éxito: ${res.importedCounts.plans} planes, ${res.importedCounts.schedules} agendas, ${res.importedCounts.closeReports} cierres, ${res.importedCounts.memories} recuerdos.`,
      });
    } catch (err) {
      setBackupStatus({
        type: "error",
        message: `Error al restaurar la copia: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      e.target.value = "";
    }
  };

  const handlePrepareWeekFromExtracted = () => {
    if (!result || !result.items || result.items.length === 0) return;
    setPlanningItems(result.items);
    setActiveSpace("prepare");
  };

  const handleCaseSelect = (caseId: string) => {
    setSelectedCaseId(caseId);
    if (!caseId) {
      handleClearDump();
      return;
    }
    const found = sampleDumpsData.find((c) => c.id === caseId);
    if (found) {
      setText(found.text);
    }
  };

  const getProviderInstance = () => {
    if (providerType === "groq") {
      return new RemoteAIProvider({ id: "groq" });
    } else if (providerType === "gemini") {
      return new RemoteAIProvider({ id: "gemini" });
    }
    return new MockProvider();
  };

  const handleExtract = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const providerInstance = getProviderInstance();

      const currentDate = new Date().toISOString().split("T")[0] || "2026-10-06";
      const data = await extractItems(providerInstance, {
        text,
        currentDate,
        locale: "es-ES",
      });
      setResult(data);
    } catch (err) {
      setError((err as Error).message || "Error procesando el volcado mental");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <header>
        <div className="notebook-meta-strip">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "1rem" }}>✏️</span>
            <span
              style={{
                fontWeight: 600,
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "0.95rem",
              }}
            >
              Cuaderno de Foco
            </span>
            <span style={{ color: "var(--text-faint)" }}>·</span>
            <span>Cuaderno personal</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span className="notebook-pill">🌱 Presencia</span>
            <div
              style={{
                width: "24px",
                height: "24px",
                borderRadius: "50%",
                background: "#ede4d6",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.75rem",
              }}
            >
              👤
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: "10px",
          }}
        >
          <div>
            <h1>Tecnología Consciente</h1>
            <p className="subtitle">
              Cuaderno de claridad y ciclo semanal · AI propone, tú decides
            </p>
          </div>
          <ProcessStatusBadge />
        </div>

        <nav
          className="tab-nav"
          style={{ display: "flex", gap: "10px", marginTop: "16px", flexWrap: "wrap" }}
          aria-label="Espacios principales"
        >
          <button
            type="button"
            className={activeSpace === "capture" ? "primary" : "secondary"}
            onClick={() => setActiveSpace("capture")}
            data-testid="nav-tab-capture"
          >
            1. Capturar ideas
          </button>
          <button
            type="button"
            className={activeSpace === "prepare" ? "primary" : "secondary"}
            onClick={() => setActiveSpace("prepare")}
            data-testid="nav-tab-prepare"
          >
            2. Preparar semana
            {(state.draftPlan || (state.draftPlans && state.draftPlans.length > 0)) && (
              <span
                style={{
                  marginLeft: "6px",
                  fontSize: "0.75rem",
                  padding: "1px 6px",
                  borderRadius: "10px",
                  background: activeSpace === "prepare" ? "rgba(255,255,255,0.25)" : "#fef3c7",
                  color: activeSpace === "prepare" ? "inherit" : "#92400e",
                }}
              >
                📝 Borrador
              </span>
            )}
          </button>
          <button
            type="button"
            className={activeSpace === "active" ? "primary" : "secondary"}
            onClick={() => setActiveSpace("active")}
            data-testid="nav-tab-active"
          >
            3. Mi semana
            {state.activePlan && state.activePlan.status === "active" && (
              <span
                style={{
                  marginLeft: "6px",
                  fontSize: "0.75rem",
                  padding: "1px 6px",
                  borderRadius: "10px",
                  background: activeSpace === "active" ? "rgba(255,255,255,0.25)" : "#e6f4ea",
                  color: activeSpace === "active" ? "inherit" : "#137333",
                }}
              >
                Activa
              </span>
            )}
          </button>
          <button
            type="button"
            className={activeSpace === "review" ? "primary" : "secondary"}
            onClick={() => setActiveSpace("review")}
            data-testid="nav-tab-review"
          >
            4. Revisar y aprender
          </button>
        </nav>
      </header>

      <section className="config-bar" style={{ marginTop: "16px" }}>
        <div className="config-row">
          <span className="config-label">Proveedor IA:</span>
          <select
            value={providerType}
            onChange={(e) => setProviderType(e.target.value as "mock" | "groq" | "gemini")}
          >
            <option value="mock">Mock (Prueba local determinista)</option>
            <option value="groq">Groq (Servidor local / Qwen 2.5 32B)</option>
            <option value="gemini">Gemini (Servidor local / Gemini 2.5 Flash)</option>
          </select>

          {activeSpace === "capture" && (
            <>
              <span className="config-label" style={{ marginLeft: "auto" }}>
                Caso real:
              </span>
              <select value={selectedCaseId} onChange={(e) => handleCaseSelect(e.target.value)}>
                <option value="">-- Escribe tus ideas o elige un ejemplo --</option>
                {sampleDumpsData.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} - {c.title}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>

        {providerType !== "mock" && (
          <div
            className="calm-box"
            style={{
              marginTop: "8px",
              fontSize: "0.85rem",
              background: "#f7f9fa",
              borderColor: "#e1e4e8",
              color: "#444",
            }}
          >
            🔒 <strong>Aislamiento seguro de credenciales:</strong> Las llamadas con IA real se
            procesan a través del proxy local del servidor. Las claves API nunca se almacenan en el
            navegador ni se transmiten al cliente; se leen exclusivamente desde las variables de
            entorno del servidor (<code>GROQ_API_KEY</code> o <code>GEMINI_API_KEY</code>).
          </div>
        )}
      </section>

      {/* Render active space */}
      {activeSpace === "capture" && (
        <main>
          <section className="input-section">
            <label className="textarea-label">¿Qué tienes en la cabeza?</label>
            <textarea
              rows={5}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Escribe todo lo que te venga a la mente sin preocuparte por ordenar..."
            />
            <div
              className="actions"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "8px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.85rem", color: "#8c8273" }}>
                  {text.length} caracteres
                </span>
                {text.trim().length > 0 && (
                  <span
                    className="calm-muted"
                    style={{
                      fontSize: "0.8rem",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                    data-testid="dump-autosave-indicator"
                  >
                    💾 Borrador guardado automáticamente
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                {text.trim().length > 0 && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={handleClearDump}
                    data-testid="clear-dump-button"
                  >
                    ✨ Limpiar volcado
                  </button>
                )}
                <button
                  className="primary"
                  disabled={loading || !text.trim()}
                  onClick={handleExtract}
                >
                  {loading ? "Entendiendo..." : "Extraer"}
                </button>
              </div>
            </div>
          </section>

          {error && <div className="status-message status-error">{error}</div>}

          {result && (
            <section className="results-section">
              <h2 className="results-heading">Esto es lo que he entendido</h2>
              <div className="items-list">
                {result.items.map((item: ExtractedItem) => (
                  <div key={item.id} className="item-card">
                    <input type="checkbox" className="item-checkbox" readOnly />
                    <div className="item-content">
                      <div className="item-title">{item.title}</div>
                      <div className="item-tags">
                        <span className={`badge badge-${item.type}`}>{item.type}</span>
                        {item.project && (
                          <span className="badge badge-muted">📁 {item.project}</span>
                        )}
                        {item.status && (
                          <span className="badge badge-muted">estado: {item.status}</span>
                        )}
                        {item.commitment && item.commitment !== "none" && (
                          <span className="badge badge-muted">compromiso {item.commitment}</span>
                        )}
                        {item.estimatedEffort && (
                          <span className="badge badge-muted">
                            ⏱ {item.estimatedEffort.value} {item.estimatedEffort.unit}
                          </span>
                        )}
                        {item.deadline && (
                          <span className="badge badge-muted">
                            📅 {item.deadline.raw}{" "}
                            {item.deadline.resolved ? `(${item.deadline.resolved})` : ""}
                          </span>
                        )}
                        {item.importance && (
                          <span className="badge badge-muted">⭐ {item.importance}</span>
                        )}
                      </div>
                      <div className="item-raw">"{item.rawText}"</div>
                    </div>
                  </div>
                ))}
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: "16px",
                  flexWrap: "wrap",
                  gap: "10px",
                }}
              >
                <button
                  className="primary"
                  data-testid="prepare-week-from-extracted-button"
                  aria-label="Preparar semana con estos elementos"
                  onClick={handlePrepareWeekFromExtracted}
                >
                  🗓️ Preparar semana con estos elementos ({result.items.length})
                </button>
                <button className="inspector-toggle" onClick={() => setShowRawJson(!showRawJson)}>
                  {showRawJson ? "Ocultar datos JSON" : "Inspeccionar estructura JSON completa"}
                </button>
              </div>

              {showRawJson && <pre className="raw-json-box">{JSON.stringify(result, null, 2)}</pre>}
            </section>
          )}
        </main>
      )}

      {activeSpace === "prepare" && (
        <main>
          <WeeklySessionView
            provider={getProviderInstance()}
            activeSpace="prepare"
            initialPlanningItems={planningItems ?? undefined}
            onClearPlanningItems={() => setPlanningItems(null)}
            onNavigateSpace={(space) => setActiveSpace(space)}
          />
        </main>
      )}

      {activeSpace === "active" && (
        <main>
          <WeeklySessionView
            provider={getProviderInstance()}
            activeSpace="active"
            onNavigateSpace={(space) => setActiveSpace(space)}
          />
        </main>
      )}

      {activeSpace === "review" && (
        <main>
          <WeeklySessionView
            provider={getProviderInstance()}
            activeSpace="review"
            onNavigateSpace={(space) => setActiveSpace(space)}
          />
        </main>
      )}

      {/* Local Backup & Sovereignty Section */}
      <footer
        style={{
          marginTop: "48px",
          borderTop: "1px solid var(--border-color)",
          paddingTop: "24px",
          paddingBottom: "32px",
        }}
        aria-label="Soberanía y respaldo de datos"
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <div>
            <h4 style={{ margin: "0 0 4px 0", fontSize: "0.95rem" }}>
              💾 Soberanía de datos y respaldo local
            </h4>
            <p className="calm-muted" style={{ margin: 0, fontSize: "0.85rem" }}>
              Tus planes, agendas, cierres y recuerdos se guardan únicamente en tu navegador. Puedes
              descargar una copia de seguridad o restaurarla en cualquier momento.
            </p>
          </div>
          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              className="secondary"
              style={{ fontSize: "0.85rem" }}
              onClick={handleExportBackup}
              data-testid="export-backup-button"
            >
              📥 Descargar copia (.json)
            </button>
            <label
              className="button secondary"
              style={{
                fontSize: "0.85rem",
                cursor: "pointer",
                margin: 0,
                display: "inline-flex",
                alignItems: "center",
              }}
              data-testid="import-backup-label"
            >
              📤 Restaurar copia (.json)
              <input
                type="file"
                accept=".json"
                style={{ display: "none" }}
                onChange={handleImportBackupFile}
                data-testid="import-backup-input"
              />
            </label>
          </div>
        </div>

        {backupStatus && (
          <div
            className={`status-message status-${backupStatus.type}`}
            style={{ marginTop: "12px", fontSize: "0.85rem" }}
            role="status"
            data-testid="backup-status-message"
          >
            {backupStatus.message}
          </div>
        )}
      </footer>
    </div>
  );
}

export function App({ service, initialTab = "weekly" }: AppProps = {}) {
  return (
    <WeeklySessionProvider service={service}>
      <AppContent initialTab={initialTab} />
    </WeeklySessionProvider>
  );
}
