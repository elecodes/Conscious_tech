import { useState } from "react";
import { MockProvider } from "../providers/mock-provider";
import { RemoteAIProvider } from "../providers/remote-ai-provider";
import {
  WeeklySessionProvider,
  useWeeklySession,
  WeeklySessionUIState,
} from "./context/weekly-session-context";
import { WeeklySessionView } from "./components/weekly-session-view";
import { WeeklySessionService } from "../application/weekly-session-service";
import { CalendarReminderSettings } from "./components/calendar-reminder-settings";

export type NavigationSpace = "capture" | "prepare" | "active" | "review";

export interface AppProps {
  service?: WeeklySessionService;
  initialTab?: "dump" | "weekly" | NavigationSpace;
  initialState?: WeeklySessionUIState;
}

export const STORAGE_KEY_CAPTURE_TEXT = "conscious_tech_transient_dump_text";
export const STORAGE_KEY_CAPTURE_RESULT = "conscious_tech_transient_dump_result";
export const STORAGE_KEY_WELCOME_DISMISSED = "conscious_tech_welcome_dismissed";

function ProcessStatusBadge() {
  const { state } = useWeeklySession();
  const activePlan =
    state.activePlan && state.activePlan.status === "active" ? state.activePlan : null;

  return (
    <div>
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
    </div>
  );
}

export interface NextStepInfo {
  message: string;
  targetSpace: NavigationSpace;
  buttonText: string;
}

export function resolveNextStep({
  state,
  extractedCount,
  hasPendingProposal = false,
}: {
  state: {
    activePlan: { status: string; targetWeek: { endDate: string } } | null;
    draftPlan?: unknown;
    draftPlans?: unknown[];
  };
  extractedCount: number;
  hasPendingProposal?: boolean;
}): NextStepInfo {
  const todayStr = new Date().toISOString().slice(0, 10);
  const activePlan = state.activePlan;

  // 1. Week ending
  if (activePlan && activePlan.status === "active" && activePlan.targetWeek.endDate <= todayStr) {
    return {
      message: "Cierra la semana y apunta lo aprendido",
      targetSpace: "review",
      buttonText: "Cerrar semana",
    };
  }

  // 2. Active week
  if (activePlan && activePlan.status === "active") {
    return {
      message: "Esta es tu semana",
      targetSpace: "active",
      buttonText: "Ver mi semana",
    };
  }

  // 3. Proposal pending
  if (hasPendingProposal || state.draftPlan || (state.draftPlans && state.draftPlans.length > 0)) {
    return {
      message: "Revisa y confirma la propuesta",
      targetSpace: "prepare",
      buttonText: "Revisar propuesta",
    };
  }

  // 4. Items extracted, no plan
  if (extractedCount > 0) {
    return {
      message: `Planifica tu semana con estas ${extractedCount} ideas`,
      targetSpace: "prepare",
      buttonText: "Planificar semana",
    };
  }

  // 5. Nothing captured (default)
  return {
    message: "Escribe lo que tienes en la cabeza",
    targetSpace: "capture",
    buttonText: "Nueva semana",
  };
}

export function resolveLandingTab(
  state: {
    status?: string;
    activePlan: { status: string } | null;
    draftPlan?: unknown;
    draftPlans?: unknown[];
  },
  hasPendingProposal: boolean = false
): NavigationSpace {
  if (state.activePlan && state.activePlan.status === "active") {
    return "active";
  }
  if (hasPendingProposal || state.draftPlan || (state.draftPlans && state.draftPlans.length > 0)) {
    return "prepare";
  }
  return "capture";
}

function AppContent({ initialTab }: { initialTab?: "dump" | "weekly" | NavigationSpace }) {
  const { state, exportBackup, importBackup } = useWeeklySession();
  const [userSelectedTab, setUserSelectedTab] = useState<NavigationSpace | null>(null);

  const resolveExplicitSpace = (tab: "dump" | "weekly" | NavigationSpace): NavigationSpace => {
    if (tab === "dump") return "capture";
    if (tab === "weekly") return "active";
    return tab;
  };

  const [hasPendingProposal, setHasPendingProposal] = useState(false);

  const activeSpace: NavigationSpace =
    userSelectedTab ??
    (initialTab !== undefined
      ? resolveExplicitSpace(initialTab)
      : resolveLandingTab(state, hasPendingProposal));

  const setActiveSpace = (space: NavigationSpace) => {
    setUserSelectedTab(space);
  };
  const [providerType, setProviderType] = useState<"mock" | "groq" | "gemini">("mock");
  const [backupStatus, setBackupStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const [showWelcome, setShowWelcome] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_WELCOME_DISMISSED) !== "true";
    } catch {
      return true;
    }
  });

  const handleDismissWelcome = () => {
    setShowWelcome(false);
    try {
      localStorage.setItem(STORAGE_KEY_WELCOME_DISMISSED, "true");
    } catch {
      // ignore
    }
  };

  const handleReopenWelcome = () => {
    setShowWelcome(true);
    try {
      localStorage.removeItem(STORAGE_KEY_WELCOME_DISMISSED);
    } catch {
      // ignore
    }
  };

  const getStoredExtractedCount = (): number => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_CAPTURE_RESULT);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.items && Array.isArray(parsed.items)) return parsed.items.length;
      }
    } catch {
      // ignore
    }
    return 0;
  };

  const extractedCount = getStoredExtractedCount();
  const nextStep = resolveNextStep({ state, extractedCount, hasPendingProposal });

  const todayStr = new Date().toISOString().slice(0, 10);
  const hasActiveWeek = Boolean(state.activePlan && state.activePlan.status === "active");
  const isEnding = Boolean(hasActiveWeek && state.activePlan!.targetWeek.endDate <= todayStr);
  const isMiSemana = activeSpace === "active";
  const hideNextStepBar =
    (isMiSemana && hasActiveWeek && !isEnding) ||
    (activeSpace === "capture" && nextStep.targetSpace === "capture");

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

  const getProviderInstance = () => {
    if (providerType === "groq") {
      return new RemoteAIProvider({ id: "groq" });
    } else if (providerType === "gemini") {
      return new RemoteAIProvider({ id: "gemini" });
    }
    return new MockProvider();
  };

  if (initialTab === undefined && state.status === "loading" && userSelectedTab === null) {
    return (
      <div className="container" data-testid="app-loading-screen">
        <header className="app-header">
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
              <p className="subtitle">IA propone, tú decides.</p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <span className="badge badge-muted">Iniciando...</span>
            </div>
          </div>
        </header>
        <main style={{ marginTop: "32px", textAlign: "center" }}>
          <div className="calm-box" role="status" aria-live="polite">
            <p className="calm-text">Revisando tu cuaderno y agenda...</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="container">
      <header className="app-header">
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
            <p className="subtitle">IA propone, tú decides.</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            {(activeSpace !== "capture" ||
              hasActiveWeek ||
              state.draftPlans?.length ||
              state.draftPlan) && <ProcessStatusBadge />}
            {providerType === "mock" && (
              <span
                className="notebook-pill"
                data-testid="demo-mode-indicator"
                title="Modo de prueba local: no se envían tus notas a servicios de IA."
              >
                Modo de prueba · Sin IA externa
              </span>
            )}
            {providerType !== "mock" && (
              <span className="notebook-pill" data-testid="external-ai-indicator">
                IA externa: {providerType === "groq" ? "Groq" : "Gemini"} · Al generar se envían tus
                notas
              </span>
            )}
            <details
              className="calm-details"
              style={{ margin: 0, padding: "4px 10px", position: "relative" }}
              data-testid="settings-dropdown"
            >
              <summary
                style={{
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  listStyle: "none",
                }}
              >
                ⚙️ Ajustes
              </summary>
              <div
                style={{
                  marginTop: "8px",
                  padding: "12px",
                  background: "#ffffff",
                  border: "1px solid var(--border-color)",
                  borderRadius: "8px",
                  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
                  minWidth: "280px",
                  maxWidth: "340px",
                }}
              >
                <h4 style={{ margin: "0 0 6px 0", fontSize: "0.9rem" }}>
                  💾 Tus datos y copias de seguridad
                </h4>
                <p
                  className="calm-muted"
                  style={{ margin: "0 0 10px 0", fontSize: "0.8rem", lineHeight: 1.4 }}
                >
                  La app guarda tus planes, agendas, cierres y recuerdos en este navegador. Puedes
                  descargar una copia de seguridad o restaurarla en cualquier momento.
                </p>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="secondary small"
                    style={{ fontSize: "0.8rem" }}
                    onClick={handleExportBackup}
                    data-testid="export-backup-button"
                  >
                    📥 Descargar copia (.json)
                  </button>
                  <label
                    className="button secondary small"
                    style={{
                      fontSize: "0.8rem",
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
                {backupStatus && (
                  <div
                    className={`status-message status-${backupStatus.type}`}
                    style={{ marginTop: "10px", fontSize: "0.78rem" }}
                    role="status"
                    data-testid="backup-status-message"
                  >
                    {backupStatus.message}
                  </div>
                )}

                <div
                  style={{
                    marginTop: "14px",
                    paddingTop: "12px",
                    borderTop: "1px solid var(--border-color)",
                  }}
                  data-testid="settings-ai-assistant-section"
                >
                  <h4 style={{ margin: "0 0 6px 0", fontSize: "0.9rem" }}>🤖 Asistente de IA</h4>
                  <p
                    className="calm-muted"
                    style={{ margin: "0 0 8px 0", fontSize: "0.8rem", lineHeight: 1.4 }}
                  >
                    El almacenamiento en tu navegador y el procesamiento con IA son distintos. En
                    modo de prueba, tus notas no se envían a servicios de IA. Con Groq o Gemini, las
                    notas y el contexto necesario se envían al proveedor elegido a través del
                    servidor de la app.
                  </p>
                  <label
                    htmlFor="settings-provider-select"
                    style={{
                      display: "block",
                      fontSize: "0.8rem",
                      fontWeight: 500,
                      marginBottom: "4px",
                    }}
                  >
                    Proveedor:
                  </label>
                  <select
                    id="settings-provider-select"
                    data-testid="provider-select"
                    value={providerType}
                    onChange={(e) => setProviderType(e.target.value as "mock" | "groq" | "gemini")}
                    style={{ width: "100%", fontSize: "0.82rem", padding: "4px 8px" }}
                  >
                    <option value="mock">Mock (Prueba local determinista)</option>
                    <option value="groq">Groq (IA externa)</option>
                    <option value="gemini">Gemini (IA externa)</option>
                  </select>
                  {providerType === "mock" && (
                    <p
                      className="calm-muted"
                      data-testid="mock-provider-explanation"
                      style={{ margin: "6px 0 0 0", fontSize: "0.78rem", lineHeight: 1.4 }}
                    >
                      Ahora usas el modo de prueba (Mock): tus notas no se envían a servicios de IA.
                      Elige Groq o Gemini para propuestas con IA real.
                    </p>
                  )}
                  {providerType !== "mock" && (
                    <div
                      style={{
                        marginTop: "8px",
                        padding: "6px 8px",
                        fontSize: "0.76rem",
                        color: "#92400e",
                        background: "#fef3c7",
                        borderRadius: "4px",
                      }}
                    >
                      Al generar con IA, enviarás tus notas y contexto al proveedor seleccionado.
                      Las credenciales se gestionan en el servidor.
                    </div>
                  )}
                </div>

                <div
                  style={{
                    marginTop: "14px",
                    paddingTop: "12px",
                    borderTop: "1px solid var(--border-color)",
                  }}
                  data-testid="settings-reminders-section"
                >
                  <h4 style={{ margin: "0 0 6px 0", fontSize: "0.9rem" }}>
                    🔔 Recordatorios de calendario
                  </h4>
                  <p
                    className="calm-muted"
                    style={{ margin: "0 0 8px 0", fontSize: "0.8rem", lineHeight: 1.4 }}
                  >
                    Avisos automáticos que se incluirán en el archivo .ics al exportar a Google
                    Calendar.
                  </p>
                  <CalendarReminderSettings compact />
                </div>

                <div
                  style={{
                    marginTop: "14px",
                    paddingTop: "12px",
                    borderTop: "1px solid var(--border-color)",
                  }}
                  data-testid="settings-welcome-section"
                >
                  <h4 style={{ margin: "0 0 6px 0", fontSize: "0.9rem" }}>🌱 Guía de bienvenida</h4>
                  <p
                    className="calm-muted"
                    style={{ margin: "0 0 8px 0", fontSize: "0.8rem", lineHeight: 1.4 }}
                  >
                    Vuelve a mostrar la introducción con el ritmo del ciclo semanal.
                  </p>
                  <button
                    type="button"
                    className="secondary small"
                    style={{ fontSize: "0.8rem" }}
                    onClick={handleReopenWelcome}
                    data-testid="reopen-welcome-button"
                  >
                    Mostrar bienvenida
                  </button>
                </div>
              </div>
            </details>
          </div>
        </div>

        <nav
          className="tab-nav"
          style={{ display: "flex", gap: "10px", marginTop: "16px", flexWrap: "wrap" }}
          aria-label="Espacios principales"
        >
          <button
            type="button"
            className={
              activeSpace === "active" || activeSpace === "review" ? "primary" : "secondary"
            }
            onClick={() => setActiveSpace("active")}
            data-testid="nav-tab-active"
          >
            Mi semana
            {state.activePlan && state.activePlan.status === "active" && (
              <span
                style={{
                  marginLeft: "6px",
                  fontSize: "0.75rem",
                  padding: "1px 6px",
                  borderRadius: "10px",
                  background:
                    activeSpace === "active" || activeSpace === "review"
                      ? "rgba(255,255,255,0.25)"
                      : "#e6f4ea",
                  color:
                    activeSpace === "active" || activeSpace === "review" ? "inherit" : "#137333",
                }}
              >
                Activa
              </span>
            )}
          </button>
          <button
            type="button"
            className={
              activeSpace === "capture" || activeSpace === "prepare" ? "primary" : "secondary"
            }
            onClick={() => {
              if (
                hasPendingProposal ||
                state.draftPlan ||
                (state.draftPlans && state.draftPlans.length > 0)
              ) {
                setActiveSpace("prepare");
              } else {
                setActiveSpace("capture");
              }
            }}
            data-testid="nav-tab-new-week"
          >
            Nueva semana
            {(state.draftPlan || (state.draftPlans && state.draftPlans.length > 0)) && (
              <span
                style={{
                  marginLeft: "6px",
                  fontSize: "0.75rem",
                  padding: "1px 6px",
                  borderRadius: "10px",
                  background:
                    activeSpace === "capture" || activeSpace === "prepare"
                      ? "rgba(255,255,255,0.25)"
                      : "#fef3c7",
                  color:
                    activeSpace === "capture" || activeSpace === "prepare" ? "inherit" : "#92400e",
                }}
              >
                Borrador
              </span>
            )}
          </button>
        </nav>

        {/* First-run welcome card */}
        {showWelcome && (
          <div className="calm-box welcome-card" data-testid="welcome-card">
            <div>
              <h3
                style={{
                  margin: "0 0 8px 0",
                  fontSize: "0.98rem",
                  color: "var(--text-main, #333)",
                }}
              >
                Escribe → Revisa → Vive tu semana
              </h3>
            </div>
            <button
              type="button"
              className="secondary small"
              data-testid="dismiss-welcome-button"
              aria-label="Cerrar bienvenida"
              onClick={handleDismissWelcome}
              style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}
            >
              Entendido ✕
            </button>
          </div>
        )}

        {/* Barra de siguiente paso guiado (oculta en Mi semana con semana activa y sin pendientes) */}
        {!hideNextStepBar && (
          <div
            className="next-step-bar"
            data-testid="next-step-bar"
            style={{
              marginTop: "12px",
              padding: "8px 14px",
              background: "#fcfbf9",
              border: "1px solid var(--border-color, #e0ded9)",
              borderRadius: "8px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "10px",
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  fontSize: "0.72rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  fontWeight: 700,
                  color: "var(--accent-color, #2b6cb0)",
                  background: "#eef6ff",
                  padding: "2px 6px",
                  borderRadius: "4px",
                }}
              >
                Paso sugerido
              </span>
              <span
                data-testid="next-step-message"
                style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-main, #333)" }}
              >
                {nextStep.message}
              </span>
            </div>

            {/* No mostrar botón si apunta al mismo espacio o pestaña en la que ya se encuentra */}
            {!(
              activeSpace === nextStep.targetSpace ||
              ((activeSpace === "capture" || activeSpace === "prepare") &&
                (nextStep.targetSpace === "capture" || nextStep.targetSpace === "prepare")) ||
              ((activeSpace === "active" || activeSpace === "review") &&
                (nextStep.targetSpace === "active" || nextStep.targetSpace === "review"))
            ) && (
              <button
                type="button"
                className="primary small"
                data-testid="next-step-button"
                onClick={() => setActiveSpace(nextStep.targetSpace)}
                style={{ fontSize: "0.82rem", padding: "4px 10px", fontWeight: 600 }}
              >
                {nextStep.buttonText} →
              </button>
            )}
          </div>
        )}
      </header>

      {/* Render active space */}
      {(activeSpace === "capture" || activeSpace === "prepare") && (
        <main>
          <WeeklySessionView
            provider={getProviderInstance()}
            activeSpace={activeSpace}
            initialStep={activeSpace === "capture" ? "write" : undefined}
            onProposalStatusChange={setHasPendingProposal}
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
    </div>
  );
}

export function App({ service, initialTab, initialState }: AppProps = {}) {
  return (
    <WeeklySessionProvider service={service} initialState={initialState}>
      <AppContent initialTab={initialTab} />
    </WeeklySessionProvider>
  );
}
