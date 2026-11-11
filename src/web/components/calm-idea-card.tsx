import { useState, type ReactNode } from "react";
import { extractItemHours } from "../../skills/build-week/deterministic";
import { ExtractedItem } from "../../domain/items";
import {
  formatItemType,
  formatItemStatus,
  formatCommitmentType,
  formatImportance,
} from "../labels";

export interface CalmIdeaCardProps {
  item: ExtractedItem;
  isAccepted: boolean;
  onToggle: () => void;
  onUpdateEffort?: (itemId: string, hours: number | null) => void;
  onUpdateDeadline?: (itemId: string, dateStr: string | null) => void;
  detailsOnly?: boolean;
  selectionLabel?: string;
  placement?: ReactNode;
  placementLabel?: string;
}

export function CalmIdeaCard({
  item,
  isAccepted,
  onToggle,
  onUpdateEffort,
  onUpdateDeadline,
  detailsOnly = false,
  selectionLabel,
  placement,
  placementLabel,
}: CalmIdeaCardProps) {
  const [isExpanded, setIsExpanded] = useState(detailsOnly);

  return (
    <li
      className="item-card calm-idea-card"
      data-testid={`idea-card-${item.id}`}
      id={`review-source-${item.id}`}
      tabIndex={placement ? -1 : undefined}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        padding: "8px 12px",
        background: isAccepted ? "var(--bg-highlight, #fdfdfd)" : "#fafafa",
        opacity: isAccepted || selectionLabel ? 1 : 0.65,
        border: isAccepted ? "1px solid var(--border-color, #e0ded9)" : "1px dashed #d1d5db",
        borderRadius: "6px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flex: 1,
            minWidth: 0,
            flexWrap: "wrap",
          }}
        >
          <input
            type="checkbox"
            id={`item-check-${item.id}`}
            checked={isAccepted}
            onChange={onToggle}
            aria-label={
              selectionLabel ? `${selectionLabel}: ${item.title}` : `Incluir elemento ${item.title}`
            }
            style={{ cursor: "pointer", flexShrink: 0 }}
          />
          {selectionLabel && (
            <label htmlFor={`item-check-${item.id}`} className="calm-muted">
              {selectionLabel}
            </label>
          )}
          <strong
            style={{
              fontSize: "0.92rem",
              textDecoration: isAccepted || selectionLabel ? "none" : "line-through",
              color: isAccepted ? "inherit" : "var(--text-muted, #888)",
            }}
          >
            {item.title}
          </strong>
          {placementLabel && (
            <span className="badge badge-muted" data-testid={`placement-badge-${item.id}`}>
              {placementLabel}
            </span>
          )}
          {item.deadline && (
            <span
              className="badge badge-muted"
              style={{ color: "#b45309", fontSize: "0.8rem", padding: "2px 6px" }}
              data-testid={`idea-date-${item.id}`}
            >
              📅 {item.deadline.raw} {item.deadline.resolved ? `(${item.deadline.resolved})` : ""}
            </span>
          )}
        </div>

        {!detailsOnly && (
          <button
            type="button"
            className="secondary small"
            aria-expanded={isExpanded}
            aria-controls={`idea-details-${item.id}`}
            onClick={() => setIsExpanded(!isExpanded)}
            data-testid={`details-toggle-${item.id}`}
            style={{
              fontSize: "0.78rem",
              padding: "2px 8px",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Detalles {isExpanded ? "▲" : "▼"}
          </button>
        )}
      </div>

      {/* Secciones plegadas tras toggle de Detalles accesible */}
      <div
        id={`idea-details-${item.id}`}
        data-testid={`idea-details-${item.id}`}
        hidden={!isExpanded}
        style={{
          display: isExpanded ? "flex" : "none",
          flexDirection: "column",
          gap: "6px",
          marginTop: "4px",
          paddingTop: "6px",
          borderTop: "1px solid var(--border-color, #eae8e3)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
          <span className={`badge badge-${item.type}`}>{formatItemType(item.type)}</span>
          {item.project && <span className="badge badge-muted">📁 {item.project}</span>}
          {item.status && (
            <span className="badge badge-muted">Estado: {formatItemStatus(item.status)}</span>
          )}
          {item.commitment && item.commitment !== "none" && (
            <span className="badge badge-muted">
              Compromiso {formatCommitmentType(item.commitment).toLowerCase()}
            </span>
          )}
          {item.estimatedEffort && (
            <span className="badge badge-muted">
              ⏱ {item.estimatedEffort.value} {item.estimatedEffort.unit}
            </span>
          )}
          {item.importance && (
            <span className="badge badge-muted">⭐ {formatImportance(item.importance)}</span>
          )}
        </div>

        {item.rawText && (
          <div
            className="item-raw"
            style={{
              fontSize: "0.82rem",
              fontStyle: "italic",
              color: "var(--text-muted, #666)",
              marginTop: "2px",
            }}
          >
            "{item.rawText}"
          </div>
        )}

        {isAccepted && onUpdateEffort && onUpdateDeadline && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "14px",
              flexWrap: "wrap",
              fontSize: "0.82rem",
              color: "var(--text-muted, #666)",
              marginTop: "4px",
            }}
          >
            <label
              htmlFor={`item-effort-${item.id}`}
              style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}
            >
              <span>⏱️ Horas:</span>
              <input
                id={`item-effort-${item.id}`}
                type="number"
                min="0"
                max="100"
                step="any"
                placeholder="Sin estimar"
                value={extractItemHours(item) ?? ""}
                onChange={(e) => {
                  const val = e.target.value === "" ? null : Number(e.target.value);
                  onUpdateEffort(item.id, val);
                }}
                style={{
                  width: "80px",
                  padding: "2px 6px",
                  fontSize: "0.82rem",
                  borderRadius: "4px",
                  border: "1px solid var(--border-color, #ccc)",
                  background: "var(--bg-card, #fff)",
                }}
                aria-label={`Horas estimadas para ${item.title}`}
              />
              <span>h</span>
            </label>

            <label
              htmlFor={`item-deadline-${item.id}`}
              style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}
            >
              <span>📅 Límite / Fecha:</span>
              <input
                id={`item-deadline-${item.id}`}
                type="date"
                value={
                  item.deadline?.resolved ||
                  (item.deadline?.raw && /^\d{4}-\d{2}-\d{2}$/.test(item.deadline.raw)
                    ? item.deadline.raw
                    : "")
                }
                onChange={(e) => {
                  onUpdateDeadline(item.id, e.target.value || null);
                }}
                style={{
                  padding: "2px 6px",
                  fontSize: "0.82rem",
                  borderRadius: "4px",
                  border: "1px solid var(--border-color, #ccc)",
                  background: "var(--bg-card, #fff)",
                }}
                aria-label={`Fecha límite para ${item.title}`}
              />
            </label>
            {placement}
          </div>
        )}
        {!(isAccepted && onUpdateEffort && onUpdateDeadline) && placement}
      </div>
    </li>
  );
}
