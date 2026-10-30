import { StoreCandidate } from "../../domain/memory";
import { formatMemoryCategory, formatProvenanceSource } from "./weekly-session-formatters";

export interface MemoryCandidatesSectionProps {
  memoryCandidates: StoreCandidate[];
  confirmMemoryCandidate: (
    candidate: StoreCandidate,
    decision: "accepted" | "rejected"
  ) => Promise<any>;
  setFeedbackMessage: (msg: string | null) => void;
}

export function MemoryCandidatesSection({
  memoryCandidates,
  confirmMemoryCandidate,
  setFeedbackMessage,
}: MemoryCandidatesSectionProps) {
  if (!memoryCandidates || memoryCandidates.length === 0) return null;

  return (
    <section
      className="results-section calm-box"
      style={{ marginTop: "24px" }}
      aria-label="Candidatos de memoria"
      data-testid="memory-candidates-section"
    >
      <h3>Candidatos de memoria pendientes de decisión</h3>
      <p className="calm-text" style={{ marginBottom: "12px" }}>
        El sistema identificó posibles aprendizajes. <strong>No están guardados todavía.</strong> Tú
        decides cuáles conservar:
      </p>
      <div className="items-list">
        {memoryCandidates.map((candidate: StoreCandidate) => (
          <div key={candidate.candidateId} className="item-card">
            <div className="item-content">
              <div className="item-title">"{candidate.rawText}"</div>
              <div
                className="item-tags"
                style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "6px" }}
              >
                <span className="badge badge-idea">
                  {formatMemoryCategory(candidate.suggestedCategory)}
                </span>
                <span className="badge badge-muted">
                  {formatProvenanceSource(candidate.provenanceSource)}
                </span>
              </div>
              <div className="actions" style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
                <button
                  className="secondary"
                  aria-label={`Descartar candidato de memoria ${candidate.candidateId}`}
                  onClick={async () => {
                    await confirmMemoryCandidate(candidate, "rejected");
                    setFeedbackMessage("Candidato descartado.");
                  }}
                >
                  Descartar
                </button>
                <button
                  className="primary"
                  aria-label={`Guardar en memoria candidato ${candidate.candidateId}`}
                  onClick={async () => {
                    await confirmMemoryCandidate(candidate, "accepted");
                    setFeedbackMessage("Recuerdo guardado con éxito.");
                  }}
                >
                  Guardar en memoria
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
