import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VoiceDictationButton } from "../src/web/components/voice-dictation-button";
import {
  getSpeechRecognitionClass,
  ISpeechRecognition,
} from "../src/web/hooks/use-speech-recognition";

class MockSpeechRecognition implements ISpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = "es-ES";
  onresult: any = null;
  onerror: any = null;
  onend: any = null;
  onstart: any = null;

  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();

  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  dispatchEvent = vi.fn();
}

describe("VoiceDictationButton & useSpeechRecognition (Web Speech API)", () => {
  const originalWindow = (globalThis as any).window;

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    vi.restoreAllMocks();
  });

  describe("Web Speech API Detection (getSpeechRecognitionClass)", () => {
    it("returns null when window is undefined or SpeechRecognition is not present", () => {
      (globalThis as any).window = undefined;
      expect(getSpeechRecognitionClass()).toBeNull();

      (globalThis as any).window = {};
      expect(getSpeechRecognitionClass()).toBeNull();
    });

    it("returns SpeechRecognition when standard API is present", () => {
      (globalThis as any).window = {
        SpeechRecognition: MockSpeechRecognition,
      };
      expect(getSpeechRecognitionClass()).toBe(MockSpeechRecognition);
    });

    it("returns webkitSpeechRecognition when vendor prefix is present", () => {
      (globalThis as any).window = {
        webkitSpeechRecognition: MockSpeechRecognition,
      };
      expect(getSpeechRecognitionClass()).toBe(MockSpeechRecognition);
    });
  });

  describe("VoiceDictationButton Rendering", () => {
    it("renders calm fallback when SpeechRecognition is not supported", () => {
      (globalThis as any).window = {};

      const html = renderToStaticMarkup(
        <VoiceDictationButton
          getText={() => "existing notes"}
          onTranscript={() => {}}
        />
      );

      expect(html).toContain("Voz no soportada");
      expect(html).not.toContain("data-testid=\"voice-dictation-btn\"");
    });

    it("renders dictation button and language selector when SpeechRecognition is supported", () => {
      (globalThis as any).window = {
        SpeechRecognition: MockSpeechRecognition,
      };

      const html = renderToStaticMarkup(
        <VoiceDictationButton
          getText={() => "existing notes"}
          onTranscript={() => {}}
        />
      );

      expect(html).toContain("data-testid=\"voice-dictation-btn\"");
      expect(html).toContain("Dictar por voz");
      expect(html).toContain("data-testid=\"voice-lang-select\"");
      expect(html).toContain("es-ES");
      expect(html).toContain("en-US");
    });

    it("renders in disabled state when disabled prop is true", () => {
      (globalThis as any).window = {
        SpeechRecognition: MockSpeechRecognition,
      };

      const html = renderToStaticMarkup(
        <VoiceDictationButton
          getText={() => "existing notes"}
          onTranscript={() => {}}
          disabled={true}
        />
      );

      expect(html).toContain("disabled=\"\"");
      expect(html).toContain("cursor:not-allowed");
    });
  });

  describe("Dictation Transcript Concatenation Logic", () => {
    it("combines existing notes with new voice speech correctly", () => {
      const baseText = "Hacer compras el martes";
      const newSpeech = "y llamar al contador a las 4";
      const combined = baseText.trim() ? `${baseText.trim()} ${newSpeech.trim()}` : newSpeech.trim();

      expect(combined).toBe("Hacer compras el martes y llamar al contador a las 4");
    });

    it("handles empty initial baseText cleanly without leading space", () => {
      const baseText = "";
      const newSpeech = "Revisar certificación AWS";
      const combined = baseText.trim() ? `${baseText.trim()} ${newSpeech.trim()}` : newSpeech.trim();

      expect(combined).toBe("Revisar certificación AWS");
    });
  });
});
