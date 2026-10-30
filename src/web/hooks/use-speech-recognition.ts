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
  onTranscript?: (newText: string) => void;
  getText?: () => string;
}

export interface UseSpeechRecognitionReturn {
  isSupported: boolean;
  isListening: boolean;
  lang: string;
  setLang: (lang: string) => void;
  startListening: () => void;
  stopListening: () => void;
  toggleListening: () => void;
  errorMessage: string | null;
}

export function useSpeechRecognition({
  initialLang = "es-ES",
  onTranscript,
  getText,
}: UseSpeechRecognitionOptions = {}): UseSpeechRecognitionReturn {
  const [isListening, setIsListening] = useState(false);
  const [lang, setLang] = useState(initialLang);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const isExplicitlyStoppedRef = useRef(true);
  const baseTextRef = useRef("");
  const accumulatedFinalRef = useRef("");

  const SpeechRecognitionClass = getSpeechRecognitionClass();
  const isSupported = Boolean(SpeechRecognitionClass);

  const cleanupRecognition = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.onstart = null;
        recognitionRef.current.abort();
      } catch {
        // Ignore abort errors during cleanup
      }
      recognitionRef.current = null;
    }
  }, []);

  const stopListening = useCallback(() => {
    isExplicitlyStoppedRef.current = true;
    setIsListening(false);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore
      }
    }
  }, []);

  const startListening = useCallback(() => {
    if (!SpeechRecognitionClass) {
      setErrorMessage("Tu navegador no soporta reconocimiento de voz nativo (Web Speech API).");
      return;
    }

    cleanupRecognition();
    setErrorMessage(null);
    isExplicitlyStoppedRef.current = false;

    // Capture initial text before starting speech
    baseTextRef.current = getText ? getText() : "";
    accumulatedFinalRef.current = "";

    try {
      const recognition = new SpeechRecognitionClass();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = lang;

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interimText = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i]!;
          const transcriptPiece = res[0]?.transcript || "";
          if (res.isFinal) {
            accumulatedFinalRef.current +=
              (accumulatedFinalRef.current ? " " : "") + transcriptPiece.trim();
          } else {
            interimText += (interimText ? " " : "") + transcriptPiece.trim();
          }
        }

        const currentSpeech = (accumulatedFinalRef.current + " " + interimText).trim();
        if (currentSpeech && onTranscript) {
          const combined = baseTextRef.current.trim()
            ? `${baseTextRef.current.trim()} ${currentSpeech}`
            : currentSpeech;
          onTranscript(combined);
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === "no-speech") {
          // Normal timeout on silence, continue listening unless explicitly stopped
          return;
        }
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          setErrorMessage("Permiso de micrófono no otorgado.");
          isExplicitlyStoppedRef.current = true;
          setIsListening(false);
          return;
        }
        setErrorMessage(`Aviso de voz: ${event.error}`);
      };

      recognition.onend = () => {
        // If the browser prematurely closes the stream but user didn't stop, seamlessly restart
        if (!isExplicitlyStoppedRef.current) {
          try {
            // Update baseText with whatever was finalized before restart
            if (getText) {
              baseTextRef.current = getText();
              accumulatedFinalRef.current = "";
            }
            recognition.start();
            return;
          } catch {
            // Fallthrough to stopped
          }
        }
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      setErrorMessage((err as Error).message || "No se pudo iniciar el micrófono.");
      setIsListening(false);
    }
  }, [SpeechRecognitionClass, cleanupRecognition, getText, lang, onTranscript]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  // Clean up when unmounting or changing language
  useEffect(() => {
    return () => {
      cleanupRecognition();
    };
  }, [cleanupRecognition]);

  return {
    isSupported,
    isListening,
    lang,
    setLang,
    startListening,
    stopListening,
    toggleListening,
    errorMessage,
  };
}
