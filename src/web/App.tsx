import { useState, useEffect } from "react";
import { ExtractedItem, ExtractedItems } from "../domain/items";
import { MockProvider } from "../providers/mock-provider";
import { GroqProvider } from "../providers/groq-provider";
import { GeminiProvider } from "../providers/gemini-provider";
import { extractItems } from "../skills/extract-items";
import realDumpsData from "../../cases/real-dumps.json";

export function App() {
  const [providerType, setProviderType] = useState<"mock" | "groq" | "gemini">("mock");
  const [groqKey, setGroqKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractedItems | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [showRawJson, setShowRawJson] = useState(false);

  useEffect(() => {
    const savedGroq = localStorage.getItem("CT_GROQ_KEY") || "";
    const savedGemini = localStorage.getItem("CT_GEMINI_KEY") || "";
    setGroqKey(savedGroq);
    setGeminiKey(savedGemini);

    // Default sample text
    if (realDumpsData.length > 0) {
      const first = realDumpsData[0];
      if (first) {
        setText(first.text);
        setSelectedCaseId(first.id);
      }
    }
  }, []);

  const handleGroqKeyChange = (val: string) => {
    setGroqKey(val);
    localStorage.setItem("CT_GROQ_KEY", val);
  };

  const handleGeminiKeyChange = (val: string) => {
    setGeminiKey(val);
    localStorage.setItem("CT_GEMINI_KEY", val);
  };

  const handleCaseSelect = (caseId: string) => {
    setSelectedCaseId(caseId);
    const found = realDumpsData.find((c) => c.id === caseId);
    if (found) {
      setText(found.text);
    }
  };

  const handleExtract = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      let providerInstance;
      if (providerType === "groq") {
        providerInstance = new GroqProvider({ apiKey: groqKey });
      } else if (providerType === "gemini") {
        providerInstance = new GeminiProvider({ apiKey: geminiKey });
      } else {
        // Mock provider: returns structured items based on sample cases or heuristics
        providerInstance = new MockProvider(async (input) => {
          // If input text matches a preset case, we can provide a rich mock structure
          return {
            items: [
              {
                id: "item-1",
                rawText: input.text.slice(0, 45) + "...",
                title: "Elemento detectado (modo Mock)",
                type: "task",
                status: "pending",
                commitment: "personal",
              },
            ],
          };
        });
      }

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
        <h1>Tecnología Consciente</h1>
        <p className="subtitle">Cuaderno de claridad y extracción semántica · extract_items</p>
      </header>

      <section className="config-bar">
        <div className="config-row">
          <span className="config-label">Proveedor:</span>
          <select
            value={providerType}
            onChange={(e) => setProviderType(e.target.value as "mock" | "groq" | "gemini")}
          >
            <option value="mock">Mock (Prueba local determinista)</option>
            <option value="groq">Groq (Llama 3.3 70B / Free Tier)</option>
            <option value="gemini">Gemini (Gemini 2.5 Flash / Free Tier)</option>
          </select>

          <span className="config-label" style={{ marginLeft: "auto" }}>Caso real:</span>
          <select
            value={selectedCaseId}
            onChange={(e) => handleCaseSelect(e.target.value)}
          >
            {realDumpsData.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} - {c.title}
              </option>
            ))}
          </select>
        </div>

        {providerType === "groq" && (
          <div className="config-row">
            <span className="config-label">Groq API Key:</span>
            <input
              type="password"
              placeholder="gsk_..."
              value={groqKey}
              onChange={(e) => handleGroqKeyChange(e.target.value)}
              style={{ flex: 1 }}
            />
          </div>
        )}

        {providerType === "gemini" && (
          <div className="config-row">
            <span className="config-label">Gemini Key:</span>
            <input
              type="password"
              placeholder="AIza..."
              value={geminiKey}
              onChange={(e) => handleGeminiKeyChange(e.target.value)}
              style={{ flex: 1 }}
            />
          </div>
        )}
      </section>

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

          <button
            className="inspector-toggle"
            onClick={() => setShowRawJson(!showRawJson)}
          >
            {showRawJson ? "Ocultar datos JSON" : "Inspeccionar estructura JSON completa"}
          </button>

          {showRawJson && (
            <pre className="raw-json-box">
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
        </section>
      )}
    </div>
  );
}
