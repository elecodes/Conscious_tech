import { useState } from "react";
import {
  buildEmailSummary,
  EmailSummaryItem,
  EmailSummaryReflections,
} from "../../domain/email-summary";

export interface EmailSummaryCardProps {
  targetWeek: {
    startDate: string;
    endDate: string;
  };
  items: EmailSummaryItem[];
  reflections?: EmailSummaryReflections;
  compact?: boolean;
}

export function EmailSummaryCard({
  targetWeek,
  items,
  reflections,
  compact = false,
}: EmailSummaryCardProps) {
  const [copied, setCopied] = useState(false);

  const summary = buildEmailSummary({
    targetWeek,
    items,
    reflections,
  });

  const handleCopy = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(summary.fullBody);
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
      }
    } catch {
      // Fallback if clipboard API is not permitted
    }
  };

  return (
    <div
      className="email-summary-card"
      data-testid="email-summary-card"
      style={{
        padding: compact ? "10px 12px" : "14px 16px",
        background: "var(--surface-warm, #fcfbf8)",
        border: "1px solid var(--border-color, #e6ded1)",
        borderRadius: "8px",
        fontSize: compact ? "0.82rem" : "0.88rem",
      }}
    >
      <div style={{ marginBottom: "8px" }}>
        <h4 style={{ margin: "0 0 4px 0", fontSize: compact ? "0.88rem" : "0.95rem" }}>
          ✉️ Enviarme el resumen por correo
        </h4>
        <span className="calm-muted" style={{ fontSize: "0.78rem" }}>
          Asunto previsto: <strong>{summary.subject}</strong>
        </span>
      </div>

      <div
        style={{
          margin: "8px 0",
          padding: "8px 10px",
          background: "#ffffff",
          border: "1px solid var(--border-color, #e6ded1)",
          borderRadius: "6px",
          fontFamily: "monospace",
          fontSize: "0.76rem",
          whiteSpace: "pre-wrap",
          maxHeight: "130px",
          overflowY: "auto",
          color: "#334155",
        }}
        data-testid="email-summary-preview"
      >
        {summary.truncatedBody}
      </div>

      {summary.isTruncated && (
        <p
          className="calm-muted"
          style={{ fontSize: "0.74rem", margin: "4px 0 8px 0", color: "#b45309" }}
        >
          ℹ️ El texto se ha abreviado para no sobrepasar el límite de la URL. Puedes pulsar «Copiar
          resumen» para obtener el contenido completo.
        </p>
      )}

      <p
        className="calm-muted"
        style={{
          margin: "0 0 10px 0",
          fontSize: "0.76rem",
          lineHeight: 1.35,
          color: "#64748b",
        }}
      >
        🔒 <strong>Privacidad:</strong> Ningún dato se envía automáticamente. Al abrir el enlace, el
        proveedor de correo podrá ver el texto del resumen. El destinatario queda vacío para que
        escribas tu propia dirección.
      </p>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
        <a
          href={summary.gmailUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="button primary small"
          style={{
            fontSize: "0.82rem",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
          }}
          data-testid="open-gmail-summary-button"
        >
          <span>✉️</span>
          <span>Abrir en Gmail</span>
        </a>

        <a
          href={summary.mailtoUrl}
          className="button secondary small"
          style={{
            fontSize: "0.82rem",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
          }}
          data-testid="open-mailto-summary-button"
        >
          <span>📬</span>
          <span>Usar mi programa de correo</span>
        </a>

        <button
          type="button"
          className="secondary small"
          style={{ fontSize: "0.82rem" }}
          onClick={handleCopy}
          data-testid="copy-email-summary-button"
        >
          {copied ? "✓ Copiado" : "📋 Copiar resumen"}
        </button>
      </div>
      {copied && (
        <span
          className="calm-text"
          style={{
            display: "block",
            marginTop: "6px",
            fontSize: "0.76rem",
            color: "var(--color-text-success, #166534)",
          }}
          role="status"
        >
          Resumen completo copiado al portapapeles.
        </span>
      )}
    </div>
  );
}
