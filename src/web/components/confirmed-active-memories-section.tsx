import { MemoryItem } from "../../domain/memory";
import { formatMemoryCategory, formatConfirmationStatus } from "./weekly-session-formatters";

export interface ConfirmedActiveMemoriesSectionProps {
  memories: MemoryItem[];
  archiveMemory?: (id: string) => Promise<void>;
  deleteMemory?: (id: string) => Promise<void>;
}

export function ConfirmedActiveMemoriesSection({
  memories,
  archiveMemory,
  deleteMemory,
}: ConfirmedActiveMemoriesSectionProps) {
  return (
    <section
      className="results-section"
      style={{
        marginTop: "32px",
        borderTop: "1px solid var(--border-color, #e8e3d9)",
        paddingTop: "20px",
      }}
      aria-label="Memorias activas confirmadas"
      data-testid="confirmed-memories-section"
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "10px",
          flexWrap: "wrap",
          gap: "8px",
        }}
      >
        <h3 style={{ margin: 0 }}>Memorias activas confirmadas ({memories.length})</h3>
        <span className="calm-muted" style={{ fontSize: "0.85rem" }}>
          Influyen con prudencia en futuras sugerencias · AI propone, tú decides
        </span>
      </div>

      {memories.length === 0 ? (
        <div
          className="calm-box"
          style={{
            background: "var(--bg-card, #fcfbf9)",
            border: "1px dashed var(--border-color, #e8e3d9)",
            padding: "16px",
            borderRadius: "6px",
          }}
          data-testid="no-memories-placeholder"
        >
          <p className="calm-muted" style={{ margin: 0, fontSize: "0.9rem" }}>
            🌱 <em>No tienes memorias activas guardadas todavía.</em> Cuando completes el cierre
            reflexivo en «4. Revisar y aprender», el sistema te propondrá aprendizajes identificados
            y podrás decidir explícitamente cuáles conservar en tu cuaderno.
          </p>
        </div>
      ) : (
        <div className="items-list">
          {memories.map((mem) => (
            <div
              key={mem.id}
              className="item-card"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "10px",
              }}
            >
              <div className="item-content" style={{ flex: 1, minWidth: "200px" }}>
                <div className="item-title">{mem.content}</div>
                <div
                  className="item-tags"
                  style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "4px" }}
                >
                  <span className="badge badge-muted">
                    {formatMemoryCategory(mem.category)} ·{" "}
                    {formatConfirmationStatus(mem.confirmationStatus)}
                  </span>
                </div>
              </div>
              <div style={{ display: "flex", gap: "8px", marginLeft: "auto" }}>
                <button
                  type="button"
                  className="secondary"
                  style={{ fontSize: "0.8rem", padding: "4px 8px" }}
                  aria-label={`Desactivar recuerdo ${mem.content}`}
                  title="Desactiva este recuerdo para que no influya en futuras planificaciones sin borrar su registro histórico"
                  onClick={async () => {
                    if (archiveMemory) await archiveMemory(mem.id);
                  }}
                >
                  💤 Desactivar
                </button>
                <button
                  type="button"
                  className="secondary"
                  style={{
                    fontSize: "0.8rem",
                    padding: "4px 8px",
                    color: "var(--danger-color, #c53030)",
                  }}
                  aria-label={`Olvidar recuerdo ${mem.content}`}
                  title="Elimina definitivamente este recuerdo del cuaderno local (derecho al olvido)"
                  onClick={async () => {
                    if (
                      window.confirm(
                        "¿Seguro que deseas eliminar definitivamente este recuerdo de tu cuaderno?"
                      )
                    ) {
                      if (deleteMemory) {
                        await deleteMemory(mem.id);
                      }
                    }
                  }}
                >
                  🗑️ Olvidar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
