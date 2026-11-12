import { useEffect, useId, useState } from "react";
import { useSpeechRecognition } from "../hooks/use-speech-recognition";

export interface VoiceDictationButtonProps {
  /** Complete field value, including existing notes; replace the value instead of appending it. */
  onTranscript: (newText: string) => void;
  getText: () => string;
  defaultLang?: string;
  taskList?: boolean;
  separateTasksValue?: boolean;
  onSeparateTasksChange?: (value: boolean) => void;
  disabled?: boolean;
}

export function VoiceDictationButton({
  onTranscript,
  getText,
  defaultLang = "es-ES",
  taskList = false,
  separateTasksValue,
  onSeparateTasksChange,
  disabled = false,
}: VoiceDictationButtonProps) {
  const [localSeparateTasks, setLocalSeparateTasks] = useState(taskList);
  const separateTasks = separateTasksValue ?? localSeparateTasks;
  const setSeparateTasks = (value: boolean) => {
    setLocalSeparateTasks(value);
    onSeparateTasksChange?.(value);
  };
  const {
    isSupported,
    isListening,
    isStarting,
    isStopping,
    statusMessage,
    stopListening,
    lang,
    setLang,
    toggleListening,
    errorMessage,
  } = useSpeechRecognition({
    initialLang: defaultLang,
    separateTasks,
    onTranscript,
    getText,
  });

  const languageId = useId();
  const active = isListening || isStarting || isStopping;
  useEffect(() => {
    if (disabled) stopListening();
  }, [disabled, stopListening]);

  if (!isSupported) {
    return (
      <span
        className="calm-muted"
        style={{ fontSize: "0.78rem" }}
        title="Web Speech API no disponible en este navegador"
      >
        🎙️ Voz no soportada. Usa el dictado de macOS o un navegador compatible.
      </span>
    );
  }

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        flexWrap: "wrap",
        maxWidth: "100%",
        gap: "4px",
        position: "relative",
      }}
    >
      <button
        type="button"
        data-testid="voice-dictation-btn"
        className={active ? "primary small" : "secondary small"}
        onClick={toggleListening}
        disabled={disabled || isStopping}
        aria-pressed={active}
        aria-label={active ? "Detener dictado por voz" : "Iniciar dictado por voz"}
        title="Dictar por voz (Web Speech API)"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: "3px 8px",
          fontSize: "0.82rem",
          borderRadius: "6px",
          background: isListening ? "#dc2626" : undefined,
          color: isListening ? "#ffffff" : undefined,
          borderColor: isListening ? "#b91c1c" : undefined,
          transition: "all 0.2s ease",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        <span
          style={{
            display: "inline-block",
            transform: isListening ? "scale(1.15)" : "none",
            transition: "transform 0.15s ease",
          }}
        >
          {isListening ? "🔴" : "🎙️"}
        </span>
        <span>
          {isStarting
            ? "Conectando… (Parar)"
            : isStopping
              ? "Terminando…"
              : isListening
                ? "Escuchando… (Parar)"
                : "Dictar por voz"}
        </span>
      </button>

      {/* Language selector and privacy notice inside compact options popover/details */}
      <details
        data-testid="voice-options-popover"
        style={{
          display: "inline-block",
          position: "relative",
          margin: 0,
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            fontSize: "0.78rem",
            listStyle: "none",
            padding: "3px 5px",
            borderRadius: "4px",
            border: "1px solid var(--border-color, #cbd5e1)",
            background: "#ffffff",
            color: "var(--text-muted, #64748b)",
            lineHeight: 1,
            userSelect: "none",
          }}
          title="Opciones e idioma de dictado"
          aria-label="Opciones de dictado por voz"
        >
          ⚙️
        </summary>
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 4px)",
            zIndex: 30,
            background: "#ffffff",
            border: "1px solid var(--border-color, #cbd5e1)",
            borderRadius: "6px",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.12)",
            padding: "8px 10px",
            minWidth: "220px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label
              htmlFor={languageId}
              style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-main)" }}
            >
              Idioma:
            </label>
            <select
              id={languageId}
              data-testid="voice-lang-select"
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              aria-label="Idioma del dictado por voz"
              disabled={disabled || active}
              style={{
                fontSize: "0.78rem",
                padding: "2px 6px",
                borderRadius: "4px",
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                cursor: isListening ? "not-allowed" : "pointer",
              }}
            >
              <option value="es-ES">es-ES</option>
              <option value="en-US">en-US</option>
            </select>
          </div>
          {taskList && (
            <label style={{ fontSize: "0.78rem", display: "flex", gap: "6px" }}>
              <input
                type="checkbox"
                checked={separateTasks}
                disabled={disabled || active}
                onChange={(event) => setSeparateTasks(event.target.checked)}
              />
              Separar tareas por voz
            </label>
          )}
          <span
            data-testid="voice-dictation-privacy-notice"
            style={{
              fontSize: "0.72rem",
              color: "var(--text-muted, #64748b)",
              lineHeight: 1.3,
            }}
          >
            (El audio puede ser procesado por el proveedor de tu navegador)
          </span>
        </div>
      </details>

      {taskList && separateTasks && (
        <span
          data-testid="voice-task-hint"
          style={{ flexBasis: "100%", fontSize: "0.78rem", lineHeight: 1.4 }}
        >
          {lang.startsWith("en")
            ? "Say “next” between tasks."
            : "Di «siguiente» entre tareas. Ejemplo: «Comprar pan, siguiente, estudiar Python»."}
        </span>
      )}
      {statusMessage && !errorMessage && (
        <span
          role="status"
          data-testid="voice-status"
          style={{ flexBasis: "100%", fontSize: "0.78rem", lineHeight: 1.4 }}
        >
          {statusMessage}
        </span>
      )}
      {errorMessage && (
        <span
          role="alert"
          data-testid="voice-error"
          style={{
            flexBasis: "100%",
            fontSize: "0.78rem",
            color: "#dc2626",
            marginLeft: "4px",
          }}
        >
          {errorMessage}
        </span>
      )}
    </div>
  );
}
