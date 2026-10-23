import { useSpeechRecognition } from "../hooks/use-speech-recognition";

export interface VoiceDictationButtonProps {
  onTranscript: (newText: string) => void;
  getText: () => string;
  defaultLang?: string;
  disabled?: boolean;
}

export function VoiceDictationButton({
  onTranscript,
  getText,
  defaultLang = "es-ES",
  disabled = false,
}: VoiceDictationButtonProps) {
  const {
    isSupported,
    isListening,
    lang,
    setLang,
    toggleListening,
    errorMessage,
  } = useSpeechRecognition({
    initialLang: defaultLang,
    onTranscript,
    getText,
  });

  if (!isSupported) {
    return (
      <span
        className="calm-muted"
        style={{ fontSize: "0.78rem" }}
        title="Web Speech API no disponible en este navegador"
      >
        🎙️ (Voz no soportada)
      </span>
    );
  }

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
      }}
    >
      <button
        type="button"
        data-testid="voice-dictation-btn"
        className={isListening ? "primary small" : "secondary small"}
        onClick={toggleListening}
        disabled={disabled}
        aria-pressed={isListening}
        aria-label={isListening ? "Detener dictado por voz" : "Iniciar dictado por voz"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          padding: "4px 10px",
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
        <span>{isListening ? "Escuchando... (Parar)" : "Dictar por voz"}</span>
      </button>

      {/* Language switcher */}
      <select
        data-testid="voice-lang-select"
        value={lang}
        onChange={(e) => setLang(e.target.value)}
        aria-label="Idioma del dictado por voz"
        disabled={disabled || isListening}
        style={{
          fontSize: "0.78rem",
          padding: "3px 6px",
          borderRadius: "4px",
          border: "1px solid #cbd5e1",
          background: "#ffffff",
          cursor: isListening ? "not-allowed" : "pointer",
        }}
      >
        <option value="es-ES">ES</option>
        <option value="en-US">EN</option>
      </select>

      {errorMessage && (
        <span
          style={{
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
