import { useState, useEffect, useRef, useCallback } from "react";

// Web Speech API interface abstractions for TypeScript
export interface SpeechRecognitionResultItem {
  transcript: string;
  confidence: number;
}

export interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionResultItem;
}

export interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

export interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

export interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

export interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

export function getSpeechRecognitionClass(): { new (): ISpeechRecognition } | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: { new (): ISpeechRecognition };
    webkitSpeechRecognition?: { new (): ISpeechRecognition };
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export interface UseSpeechRecognitionOptions {
  initialLang?: string;
  /** Receives the complete updated field value, including interim corrections. */
  onTranscript?: (newText: string) => void;
  getText?: () => string;
}

export interface UseSpeechRecognitionReturn {
  isSupported: boolean;
  isListening: boolean;
  isStarting: boolean;
  isStopping: boolean;
  statusMessage: string | null;
  lang: string;
  setLang: (lang: string) => void;
  startListening: () => void;
  stopListening: () => void;
  toggleListening: () => void;
  errorMessage: string | null;
}

export function speechErrorMessage(code: string) {
  const messages: Record<string, string> = {
    "not-allowed":
      "El micrófono está bloqueado. Permite su uso para esta página en el navegador y en Ajustes del Sistema → Privacidad y seguridad → Micrófono de tu Mac.",
    "service-not-allowed":
      "El navegador no permite el servicio de dictado. Revisa sus ajustes de voz o prueba otro navegador compatible.",
    "audio-capture":
      "No se puede acceder al micrófono. Comprueba que esté conectado, seleccionado y permitido en los ajustes del sistema.",
    "no-speech":
      "No se ha detectado voz. Comprueba el micrófono y pulsa Dictar por voz para intentarlo de nuevo.",
    network:
      "No se pudo conectar con el servicio de dictado del navegador. Comprueba la conexión y vuelve a intentarlo.",
    "language-not-supported":
      "El servicio de dictado no admite este idioma. Prueba otro idioma en las opciones de voz.",
    aborted: "El dictado se ha interrumpido. Puedes iniciarlo de nuevo.",
  };
  return (
    messages[code] ??
    "El navegador no pudo completar el dictado. Puedes volver a intentarlo o escribir el texto."
  );
}

export function useSpeechRecognition({
  initialLang = "es-ES",
  onTranscript,
  getText,
}: UseSpeechRecognitionOptions = {}): UseSpeechRecognitionReturn {
  const [status, setStatus] = useState<"idle" | "starting" | "listening" | "stopping">("idle");
  const [lang, updateLang] = useState(initialLang);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const callbacks = useRef({ onTranscript, getText });
  callbacks.current = { onTranscript, getText };
  const stopping = useRef(false);
  const SpeechRecognitionClass = getSpeechRecognitionClass();

  const cleanupRecognition = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;
    recognition.onresult = recognition.onerror = null;
    recognition.onend = recognition.onstart = null;
    try {
      recognition.abort();
    } catch {
      /* Already ended. */
    }
  }, []);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current || stopping.current) return;
    stopping.current = true;
    setStatus("stopping");
    try {
      recognitionRef.current.stop();
    } catch {
      cleanupRecognition();
      setStatus("idle");
      setStatusMessage("Dictado detenido. El texto se conserva.");
    }
  }, [cleanupRecognition]);

  const startListening = useCallback(() => {
    if (recognitionRef.current) return;
    if (!SpeechRecognitionClass) {
      setErrorMessage(
        "Este navegador no admite el dictado. Puedes usar el dictado de macOS o un navegador compatible."
      );
      return;
    }
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      setErrorMessage("Abre la app en localhost o con HTTPS para usar el micrófono.");
      return;
    }
    setErrorMessage(null);
    setStatusMessage("Conectando con el micrófono. Acepta el permiso si el navegador lo solicita.");
    setStatus("starting");
    stopping.current = false;
    const base = callbacks.current.getText?.() ?? "";
    let lastPublished = base;
    let receivedText = false;
    try {
      const recognition = new SpeechRecognitionClass();
      recognitionRef.current = recognition;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = lang;
      recognition.onstart = () => {
        if (recognitionRef.current !== recognition || stopping.current) return;
        setStatus("listening");
        setStatusMessage("Escuchando. Habla y el texto aparecerá aquí.");
      };
      recognition.onresult = (event: SpeechRecognitionEvent) => {
        if (recognitionRef.current !== recognition) return;
        // Browser results contain the whole session, including revised interim results.
        // Rebuild instead of appending a final result again on repeated events.
        const current = callbacks.current.getText?.();
        if (current !== undefined && current !== lastPublished) {
          cleanupRecognition();
          setStatus("idle");
          setStatusMessage(
            "Has editado el texto. El dictado se ha detenido para conservar tus cambios; puedes iniciarlo de nuevo."
          );
          return;
        }
        const parts: string[] = [];
        for (let i = 0; i < event.results.length; i++) {
          const text = event.results[i]?.[0]?.transcript.trim();
          if (text) parts.push(text);
        }
        const speech = parts.join(" ");
        if (!speech) return;
        lastPublished = base + (base && !/\s$/.test(base) ? " " : "") + speech;
        receivedText = true;
        callbacks.current.onTranscript?.(lastPublished);
      };
      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (recognitionRef.current !== recognition) return;
        const explicitAbort = stopping.current && event.error === "aborted";
        cleanupRecognition();
        setStatus("idle");
        setStatusMessage(explicitAbort ? "Dictado detenido. El texto se conserva." : null);
        if (!explicitAbort) setErrorMessage(speechErrorMessage(event.error));
      };
      recognition.onend = () => {
        if (recognitionRef.current !== recognition) return;
        cleanupRecognition();
        setStatus("idle");
        setStatusMessage(
          receivedText || stopping.current
            ? "Dictado detenido. El texto se conserva; puedes continuar dictando cuando quieras."
            : "El dictado terminó sin recibir texto. Comprueba el micrófono e inténtalo de nuevo."
        );
      };
      recognition.start();
    } catch {
      cleanupRecognition();
      setStatus("idle");
      setStatusMessage(null);
      setErrorMessage(
        "No se pudo iniciar el dictado. Revisa el permiso del micrófono y vuelve a intentarlo."
      );
    }
  }, [SpeechRecognitionClass, cleanupRecognition, lang]);

  const toggleListening = useCallback(() => {
    if (recognitionRef.current) stopListening();
    else startListening();
  }, [startListening, stopListening]);
  const setLang = useCallback(
    (value: string) => {
      cleanupRecognition();
      stopping.current = true;
      setStatus("idle");
      setErrorMessage(null);
      setStatusMessage(null);
      updateLang(value);
    },
    [cleanupRecognition]
  );
  useEffect(() => cleanupRecognition, [cleanupRecognition]);

  return {
    isSupported: Boolean(SpeechRecognitionClass),
    isListening: status === "listening",
    isStarting: status === "starting",
    isStopping: status === "stopping",
    statusMessage,
    lang,
    setLang,
    startListening,
    stopListening,
    toggleListening,
    errorMessage,
  };
}
