import { useState } from "react";
import { ExtractedItem, ExtractedItems } from "../domain/items";
import { MockProvider } from "../providers/mock-provider";
import { RemoteAIProvider } from "../providers/remote-ai-provider";
import { extractItems } from "../skills/extract-items";
import realDumpsData from "../../cases/real-dumps.json";
import { WeeklySessionProvider, useWeeklySession } from "./context/weekly-session-context";
import { WeeklySessionView } from "./components/weekly-session-view";
import { WeeklySessionService } from "../application/weekly-session-service";

export type NavigationSpace = "capture" | "prepare" | "active" | "review";

export interface AppProps {
  service?: WeeklySessionService;
  initialTab?: "dump" | "weekly" | NavigationSpace;
}

function ProcessStatusBadge() {
  const { state } = useWeeklySession();

  if (state.activePlan && state.activePlan.status === "active") {
    return (
      <span className="badge badge-task" data-testid="process-status-badge">
        Semana en curso ({state.activePlan.targetWeek.startDate} al {state.activePlan.targetWeek.endDate})
      </span>
    );
  }
  if (state.latestClosedWeek) {
    return (
      <span className="badge badge-muted" data-testid="process-status-badge">
        Última semana cerrada ({state.latestClosedWeek.plan.targetWeek.startDate})
      </span>
    );
  }
  return (
    <span className="badge badge-idea" data-testid="process-status-badge">
      Borrador / Sin semana activa
    </span>
  );
}

function AppContent({ initialTab = "active" }: { initialTab?: "dump" | "weekly" | NavigationSpace }) {
  const resolveInitialSpace = (): NavigationSpace => {
    if (initialTab === "dump") return "capture";
    if (initialTab === "weekly") return "active";
    return initialTab;
  };

  const [activeSpace, setActiveSpace] = useState<NavigationSpace>(resolveInitialSpace);
  const [providerType, setProviderType] = useState<"mock" | "groq" | "gemini">("mock");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractedItems | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [showRawJson, setShowRawJson] = useState(false);
  const [planningItems, setPlanningItems] = useState<ExtractedItem[] | null>(null);

  const handlePrepareWeekFromExtracted = () => {
    if (!result || !result.items || result.items.length === 0) return;
    setPlanningItems(result.items);
    setActiveSpace("prepare");
  };

  const handleCaseSelect = (caseId: string) => {
    setSelectedCaseId(caseId);
    if (!caseId) {
      setText("");
      return;
    }
    const found = realDumpsData.find((c) => c.id === caseId);
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
            <span style={{ fontWeight: 600, fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: "0.95rem" }}>
              Cuaderno de Foco
            </span>
            <span style={{ color: "var(--text-faint)" }}>·</span>
            <span>Cuaderno personal</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span className="notebook-pill">🌱 Presencia</span>
            <div style={{ width: "24px", height: "24px", borderRadius: "50%", background: "#ede4d6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem" }}>
              👤
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px" }}>
          <div>
            <h1>Tecnología Consciente</h1>
            <p className="subtitle">Cuaderno de claridad y ciclo semanal · AI propone, tú decides</p>
          </div>
          <ProcessStatusBadge />
        </div>

        <nav className="tab-nav" style={{ display: "flex", gap: "10px", marginTop: "16px", flexWrap: "wrap" }} aria-label="Espacios principales">
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
          </button>
          <button
            type="button"
            className={activeSpace === "active" ? "primary" : "secondary"}
            onClick={() => setActiveSpace("active")}
            data-testid="nav-tab-active"
          >
            3. Mi semana
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
            <option value="groq">Groq (Servidor local / Llama 3.3 70B)</option>
            <option value="gemini">Gemini (Servidor local / Gemini 2.5 Flash)</option>
          </select>

          {activeSpace === "capture" && (
            <>
              <span className="config-label" style={{ marginLeft: "auto" }}>Caso real:</span>
              <select
                value={selectedCaseId}
                onChange={(e) => handleCaseSelect(e.target.value)}
              >
                <option value="">-- Escribe tus ideas o elige un ejemplo --</option>
                {realDumpsData.map((c) => (
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
            🔒 <strong>Aislamiento seguro de credenciales:</strong> Las llamadas con IA real se procesan a través del proxy local del servidor. Las claves API nunca se almacenan en el navegador ni se transmiten al cliente; se leen exclusivamente desde las variables de entorno del servidor (<code>GROQ_API_KEY</code> o <code>GEMINI_API_KEY</code>).
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
            <div className="actions">
              <span style={{ fontSize: "0.85rem", color: "#8c8273" }}>
                {text.length} caracteres
              </span>
              <button
                className="primary"
                disabled={loading || !text.trim()}
                onClick={handleExtract}
              >
                {loading ? "Entendiendo..." : "Extraer"}
              </button>
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
                          <span className="badge badge-muted">
                            compromiso {item.commitment}
                          </span>
                        )}
                        {item.estimatedEffort && (
                          <span className="badge badge-muted">
                            ⏱ {item.estimatedEffort.value} {item.estimatedEffort.unit}
                          </span>
                        )}
                        {item.deadline && (
                          <span className="badge badge-muted">
                            📅 {item.deadline.raw} {item.deadline.resolved ? `(${item.deadline.resolved})` : ""}
                          </span>
                        )}
                        {item.importance && (
                          <span className="badge badge-muted">
                            ⭐ {item.importance}
                          </span>
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
                <button
                  className="inspector-toggle"
                  onClick={() => setShowRawJson(!showRawJson)}
                >
                  {showRawJson ? "Ocultar datos JSON" : "Inspeccionar estructura JSON completa"}
                </button>
              </div>

              {showRawJson && (
                <pre className="raw-json-box">
                  {JSON.stringify(result, null, 2)}
                </pre>
              )}
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
            initialPlanningItems={planningItems ?? undefined}
            onClearPlanningItems={() => setPlanningItems(null)}
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
