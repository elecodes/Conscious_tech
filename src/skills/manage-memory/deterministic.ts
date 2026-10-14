import {
  ManageMemoryInput,
  ManageMemoryInputSchema,
  ManageMemoryOutput,
  MemoryOperation,
  MemoryItem,
  MemoryContradiction,
  containsHesitationMarkers,
  containsNegativeOrPendingMarkers,
  isValidEpistemicState,
  MemoryProvenanceSource,
  MemoryProvenance,
  CandidateMemoryInputSchema,
  StoreCandidate,
  UpdateCandidate,
} from "../../domain/memory";

// ============================================================================
// Text Normalization for Deterministic Duplicate Detection
/**
 * Normalizes text content strictly for exact duplicate comparison:
 * - Trims external whitespace and collapses multiple internal spaces.
 * - Converts to lower case and normalizes unicode (NFD diacritics removal).
 * - Preserves technical symbols and operators (+, #, @, /, -, _, ., :) to avoid
 *   erroneously collapsing distinct technical terms (e.g. "C++" vs "C", "C#" vs "C",
 *   "node.js" vs "node", "v1.2" vs "v12").
 * - Strips only non-semantic grammatical punctuation like quotes, brackets, exclamation/question marks.
 */
export function normalizeMemoryContent(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/[¿?¡!()[\]{}"'“”‘’«»,;]/g, " ") // remove purely ornamental punctuation
    .replace(/\s+/g, " ")          // collapse whitespace
    .trim();
}

// ============================================================================
// Operation Canonical Ordering & Deduplication
// ============================================================================

const OP_TYPE_ORDER: Record<string, number> = {
  forget: 1,
  archive: 2,
  update: 3,
  merge: 4,
  add: 5,
  keep: 6,
  request_clarification: 7,
};

function getOperationKey(op: MemoryOperation): string {
  switch (op.type) {
    case "forget":
    case "archive":
    case "update":
    case "keep":
      return `${op.type}:${op.targetMemoryId}`;
    case "add":
      return `${op.type}:${op.candidateId}`;
    case "merge":
      return `${op.type}:${[...op.sourceMemoryIds].sort().join(",")}`;
    case "request_clarification":
      return `${op.type}:${[...op.relatedMemoryIds].sort().join(",")}:${op.candidateId ?? ""}:${op.question}`;
  }
}

function getOperationSortKey(op: MemoryOperation): string {
  const rank = String(OP_TYPE_ORDER[op.type] ?? 99).padStart(2, "0");
  let target = "";
  switch (op.type) {
    case "forget":
    case "archive":
    case "update":
    case "keep":
      target = op.targetMemoryId;
      break;
    case "add":
      target = op.candidateId;
      break;
    case "merge":
      target = [...op.sourceMemoryIds].sort().join(",");
      break;
    case "request_clarification":
      target = [...op.relatedMemoryIds].sort().join(",");
      break;
  }
  return `${rank}:${target}:${op.rationale}`;
}

// ============================================================================
// Deterministic Engine Implementation
// ============================================================================

export function manageMemoryDeterministically(input: ManageMemoryInput): ManageMemoryOutput {
  const parsed = ManageMemoryInputSchema.parse(input);
  const {
    referenceDate,
    existingMemories,
    candidates,
    explicitForgetRequests,
    verifiedAcceptedDecisionRefs,
    preferences,
  } = parsed;

  const verifiedDecisionRefsSet = new Set(verifiedAcceptedDecisionRefs ?? []);

  const existingMemoryMap = new Map<string, MemoryItem>();
  for (const mem of existingMemories) {
    existingMemoryMap.set(mem.id, mem);
  }

  const rawProposedOps: MemoryOperation[] = [];
  const suppressedContextMemoryIds = new Set<string>();
  const invalidReferencesSet = new Set<string>();
  const candidateValidationErrorsSet = new Set<string>();
  const contradictions: MemoryContradiction[] = [];
  const clarificationQuestionsSet = new Set<string>();
  const warningsSet = new Set<string>();

  // ==========================================================================
  // Step 1: Process Explicit Forget Requests (Priority Channel)
  // ==========================================================================
  const forgetTargetIds = new Set<string>();

  for (const targetId of explicitForgetRequests) {
    if (!existingMemoryMap.has(targetId)) {
      invalidReferencesSet.add(targetId);
      warningsSet.add(`No se encontró el recuerdo solicitado para olvidar: ${targetId}`);
    } else {
      forgetTargetIds.add(targetId);
      suppressedContextMemoryIds.add(targetId);
      rawProposedOps.push({
        type: "forget",
        targetMemoryId: targetId,
        rationale: `Petición explícita de olvido para el recuerdo ${targetId}`,
        requiresHumanConfirmation: true,
      });
    }
  }

  // Group update candidates by targetMemoryId to detect divergent updates
  const updateCandidatesByTarget = new Map<string, UpdateCandidate[]>();
  // Group store candidates by candidateId to detect divergent adds
  const storeCandidatesById = new Map<string, StoreCandidate[]>();

  for (const rawCand of candidates) {
    const parseResult = CandidateMemoryInputSchema.safeParse(rawCand);
    if (!parseResult.success) {
      // Candidate error isolation: do not confuse malformed candidates with non-existent memory references!
      const candId =
        typeof rawCand === "object" && rawCand !== null && "candidateId" in rawCand
          ? String((rawCand as Record<string, unknown>).candidateId)
          : "unknown_candidate";
      candidateValidationErrorsSet.add(candId);
      const errDetail = parseResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      warningsSet.add(`Candidato descartado por validación de esquema (${candId}): ${errDetail}`);
      continue;
    }

    const cand = parseResult.data;

    if (cand.actionIntent === "forget") {
      const targetId = cand.targetMemoryId;
      if (!existingMemoryMap.has(targetId)) {
        invalidReferencesSet.add(targetId);
        warningsSet.add(`No se encontró el recuerdo solicitado para olvidar: ${targetId}`);
      } else {
        forgetTargetIds.add(targetId);
        suppressedContextMemoryIds.add(targetId);
        rawProposedOps.push({
          type: "forget",
          targetMemoryId: targetId,
          sourceCandidateId: cand.candidateId,
          rationale: cand.rawText ?? `Petición explícita de olvido para el recuerdo ${targetId}`,
          requiresHumanConfirmation: true,
        });
      }
    } else if (cand.actionIntent === "update") {
      const list = updateCandidatesByTarget.get(cand.targetMemoryId) ?? [];
      list.push(cand);
      updateCandidatesByTarget.set(cand.targetMemoryId, list);
    } else if (cand.actionIntent === "store") {
      const list = storeCandidatesById.get(cand.candidateId) ?? [];
      list.push(cand);
      storeCandidatesById.set(cand.candidateId, list);
    }
  }

  // ==========================================================================
  // Step 2: Auto-Detect Expired Memories (if preferences.autoDetectExpired)
  // ==========================================================================
  if (preferences.autoDetectExpired) {
    for (const mem of existingMemories) {
      if (forgetTargetIds.has(mem.id)) {
        continue; // Forget supersedes archive
      }
      if (mem.validUntil !== null && mem.validUntil !== undefined) {
        // Inclusive definition: referenceDate > validUntil means expired
        if (referenceDate > mem.validUntil) {
          rawProposedOps.push({
            type: "archive",
            targetMemoryId: mem.id,
            reason: "expired_date",
            rationale: `El recuerdo ${mem.id} venció el ${mem.validUntil} (fecha de referencia: ${referenceDate})`,
            requiresHumanConfirmation: true,
          });
        }
      }
    }
  }

  // ==========================================================================
  // Step 3: Process Candidates (Store & Update)
  // ==========================================================================

  // 3.1 Evaluate Update Candidates
  for (const [targetMemoryId, candList] of updateCandidatesByTarget.entries()) {
    // If target has an explicit forget, forget strictly supersedes update
    if (forgetTargetIds.has(targetMemoryId)) {
      warningsSet.add(`Operación 'update' suprimida para ${targetMemoryId} debido a solicitud prioritaria de olvido`);
      continue;
    }

    if (!existingMemoryMap.has(targetMemoryId)) {
      invalidReferencesSet.add(targetMemoryId);
      warningsSet.add(`No se encontró el recuerdo objetivo para actualización: ${targetMemoryId}`);
      continue;
    }

    const existingMem = existingMemoryMap.get(targetMemoryId)!;

    // Check for divergent concurrent updates
    if (candList.length > 1) {
      const normalizedTexts = new Set(candList.map((c) => normalizeMemoryContent(c.rawText)));
      if (normalizedTexts.size > 1) {
        // Divergent updates: do not choose arbitrarily, request clarification
        const question = `Existen propuestas de actualización divergentes para el recuerdo ${targetMemoryId}. ¿Cuál debe aplicarse?`;
        clarificationQuestionsSet.add(question);
        contradictions.push({
          existingMemoryId: targetMemoryId,
          contradictingCandidateId: candList[0].candidateId,
          description: `Actualizaciones concurrentes divergentes para ${targetMemoryId}`,
          nature: existingMem.category === "preference" ? "preference_drift" : "factual_conflict",
        });
        rawProposedOps.push({
          type: "request_clarification",
          relatedMemoryIds: [targetMemoryId],
          candidateId: candList[0].candidateId,
          question,
          rationale: `Conflicto entre múltiples actualizaciones propuestas para ${targetMemoryId}`,
        });
        continue;
      }
    }

    // Process single or duplicate identical update
    const primaryCand = candList[0];
    const newCategory = primaryCand.suggestedCategory ?? existingMem.category;
    const updSource: MemoryProvenanceSource =
      primaryCand.provenanceSource ??
      (primaryCand.isExplicitUserStatement
        ? "user_explicit"
        : newCategory === "decision"
        ? "plan_decision"
        : existingMem.provenance.source);
    const updReferenceText = primaryCand.evidenceReference ?? primaryCand.rawText;
    const isHesitant = containsHesitationMarkers(updReferenceText) || containsHesitationMarkers(primaryCand.rawText);
    const hasNegativeOrPendingMarkers =
      containsNegativeOrPendingMarkers(updReferenceText) ||
      containsNegativeOrPendingMarkers(primaryCand.rawText);

    let newConfirmationStatus: "confirmed" | "inferred" | "unconfirmed" = existingMem.confirmationStatus;

    if (updSource === "user_explicit") {
      newConfirmationStatus = isHesitant || newCategory === "working_hypothesis" ? "unconfirmed" : "confirmed";
    } else if (updSource === "plan_decision") {
      // Regla de verificación autoritativa:
      // 1. rawText NUNCA constituye evidencia de su propia aceptación.
      // 2. evidenceReference NO se considera verificada solo por tener formato o ser no vacía.
      // 3. Solo es verificada si coincide con una referencia auténtica registrada en verifiedAcceptedDecisionRefs.
      // 4. Si contiene vacilación, negación o condiciones pendientes, permanece unconfirmed.
      const isAuthoritativelyVerified =
        primaryCand.evidenceReference !== undefined &&
        verifiedDecisionRefsSet.has(primaryCand.evidenceReference);

      if (
        isAuthoritativelyVerified &&
        !isHesitant &&
        !hasNegativeOrPendingMarkers &&
        newCategory !== "working_hypothesis"
      ) {
        newConfirmationStatus = "confirmed";
      } else {
        newConfirmationStatus = "unconfirmed";
      }
    } else if (updSource === "conversation_inference" || updSource === "system") {
      newConfirmationStatus = "inferred";
    }

    // Epistemic safety guard
    const check = isValidEpistemicState(newCategory, newConfirmationStatus, {
      source: updSource,
      referenceText: updReferenceText,
    });
    if (!check.valid) {
      newConfirmationStatus = updSource === "conversation_inference" || updSource === "system" ? "inferred" : "unconfirmed";
    }

    rawProposedOps.push({
      type: "update",
      targetMemoryId,
      sourceCandidateId: primaryCand.candidateId,
      updatedFields: {
        content: primaryCand.rawText,
        category: newCategory,
        confirmationStatus: newConfirmationStatus,
        temporalStatus: primaryCand.validUntil && primaryCand.validUntil < referenceDate ? "expired" : "active",
        validUntil: primaryCand.validUntil ?? existingMem.validUntil,
      },
      rationale: `Actualización solicitada por candidato ${primaryCand.candidateId}`,
      requiresHumanConfirmation: true,
    });
  }

  // 3.2 Evaluate Store Candidates
  for (const [candidateId, candList] of storeCandidatesById.entries()) {
    if (candList.length > 1) {
      const normalizedTexts = new Set(candList.map((c) => normalizeMemoryContent(c.rawText)));
      if (normalizedTexts.size > 1) {
        const question = `Existen candidatos contradictorios bajo el identificador ${candidateId}. ¿Cuál es el correcto?`;
        clarificationQuestionsSet.add(question);
        rawProposedOps.push({
          type: "request_clarification",
          relatedMemoryIds: [],
          candidateId,
          question,
          rationale: `Candidatos duplicados divergentes con ID ${candidateId}`,
        });
        continue;
      }
    }

    const cand = candList[0];
    const normCand = normalizeMemoryContent(cand.rawText);
    const category = cand.suggestedCategory ?? "fact";

    // A. Check for Exact Duplicate in existingMemories
    let isExactDuplicate = false;
    for (const mem of existingMemories) {
      if (mem.temporalStatus === "active" || mem.temporalStatus === "unknown") {
        if (mem.category === category && normalizeMemoryContent(mem.content) === normCand) {
          isExactDuplicate = true;
          warningsSet.add(`Candidato ${cand.candidateId} es un duplicado exacto del recuerdo activo ${mem.id}`);
          break;
        }
      }
    }
    if (isExactDuplicate) {
      continue;
    }

    // B. Check for Semantic/Direct Contradiction with existing memories
    // (Simple heuristic for opposing statements without LLM: antonyms/negations on same topic)
    let hasContradiction = false;
    for (const mem of existingMemories) {
      if (mem.temporalStatus === "active") {
        const normMem = normalizeMemoryContent(mem.content);
        // Simple direct opposition detection: "no X" vs "X" on same key phrases
        const isNegationOfMem =
          (normCand.startsWith("no ") && normCand.slice(3) === normMem) ||
          (normMem.startsWith("no ") && normMem.slice(3) === normCand);

        if (isNegationOfMem) {
          hasContradiction = true;
          const question = `Existe una discrepancia directa entre el recuerdo ${mem.id} y el nuevo candidato ${cand.candidateId}. ¿Cuál debe conservarse?`;
          clarificationQuestionsSet.add(question);
          contradictions.push({
            existingMemoryId: mem.id,
            contradictingCandidateId: cand.candidateId,
            description: `Discrepancia entre '${mem.id}' y '${cand.candidateId}'`,
            nature: category === "preference" ? "preference_drift" : "factual_conflict",
          });
          rawProposedOps.push({
            type: "request_clarification",
            relatedMemoryIds: [mem.id],
            candidateId: cand.candidateId,
            question,
            rationale: `Contradicción detectada entre recuerdo existente ${mem.id} y candidato ${cand.candidateId}`,
          });
          break;
        }
      }
    }
    if (hasContradiction) {
      continue;
    }

    // C. Evaluate Confirmation Status & Epistemic Invariants
    const source: MemoryProvenanceSource =
      cand.provenanceSource ??
      (cand.isExplicitUserStatement
        ? "user_explicit"
        : category === "decision"
        ? "plan_decision"
        : "conversation_inference");

    const referenceText = cand.evidenceReference ?? cand.rawText;
    const isHesitant = containsHesitationMarkers(referenceText) || containsHesitationMarkers(cand.rawText);
    const hasNegativeOrPendingMarkers =
      containsNegativeOrPendingMarkers(referenceText) ||
      containsNegativeOrPendingMarkers(cand.rawText);

    let confirmationStatus: "confirmed" | "inferred" | "unconfirmed" = "unconfirmed";

    if (source === "user_explicit") {
      confirmationStatus = isHesitant || category === "working_hypothesis" ? "unconfirmed" : "confirmed";
    } else if (source === "plan_decision") {
      // Regla de verificación autoritativa:
      // 1. rawText NUNCA constituye evidencia de su propia aceptación.
      // 2. evidenceReference NO se considera verificada solo por tener formato o ser no vacía.
      // 3. Solo es verificada si coincide con una referencia auténtica registrada en verifiedAcceptedDecisionRefs.
      // 4. Si contiene vacilación, negación o condiciones pendientes, permanece unconfirmed.
      const isAuthoritativelyVerified =
        cand.evidenceReference !== undefined &&
        verifiedDecisionRefsSet.has(cand.evidenceReference);

      if (
        isAuthoritativelyVerified &&
        !isHesitant &&
        !hasNegativeOrPendingMarkers &&
        category !== "working_hypothesis"
      ) {
        confirmationStatus = "confirmed";
      } else {
        confirmationStatus = "unconfirmed";
      }
    } else if (source === "conversation_inference" || source === "system") {
      confirmationStatus = "inferred";
    }

    const proposedProvenance: MemoryProvenance = {
      source,
      referenceText,
    };

    // Epistemic safety guard
    const epistemicCheck = isValidEpistemicState(category, confirmationStatus, proposedProvenance);
    if (!epistemicCheck.valid) {
      confirmationStatus = source === "conversation_inference" || source === "system" ? "inferred" : "unconfirmed";
    }

    const proposedMemory: MemoryItem = {
      id: `mem-${cand.candidateId}`,
      content: cand.rawText,
      category,
      confirmationStatus,
      temporalStatus: cand.validUntil && cand.validUntil < referenceDate ? "expired" : "active",
      validUntil: cand.validUntil ?? null,
      tags: [],
      provenance: proposedProvenance,
      createdAt: referenceDate,
    };

    rawProposedOps.push({
      type: "add",
      candidateId: cand.candidateId,
      proposedMemory,
      rationale: `Nuevo recuerdo propuesto a partir del candidato ${cand.candidateId}`,
      requiresHumanConfirmation: true,
    });
  }

  // ==========================================================================
  // Step 4: Deduplicate and Apply Cross-Operation Precedence
  // ==========================================================================

  // Filter out any operations on IDs marked for forget (except the forget ops themselves)
  const nonConflictingOps: MemoryOperation[] = [];

  for (const op of rawProposedOps) {
    if (op.type === "forget") {
      nonConflictingOps.push(op);
    } else if (op.type === "update" || op.type === "archive" || op.type === "keep") {
      if (forgetTargetIds.has(op.targetMemoryId)) {
        // Suppress due to forget precedence
        warningsSet.add(`Operación '${op.type}' suprimida para ${op.targetMemoryId} debido a solicitud prioritaria de olvido`);
      } else {
        nonConflictingOps.push(op);
      }
    } else if (op.type === "merge") {
      const hasForgetConflict = op.sourceMemoryIds.some((id) => forgetTargetIds.has(id));
      if (hasForgetConflict) {
        warningsSet.add(`Operación 'merge' suprimida porque incluye fuentes sujetas a olvido`);
      } else {
        nonConflictingOps.push(op);
      }
    } else {
      nonConflictingOps.push(op);
    }
  }

  // Deduplicate identical operations
  const seenOpKeys = new Set<string>();
  const deduplicatedOps: MemoryOperation[] = [];

  for (const op of nonConflictingOps) {
    const key = getOperationKey(op);
    if (!seenOpKeys.has(key)) {
      seenOpKeys.add(key);
      deduplicatedOps.push(op);
    }
  }

  // Stable canonical sort
  deduplicatedOps.sort((a, b) => getOperationSortKey(a).localeCompare(getOperationSortKey(b)));

  // ==========================================================================
  // Step 5: Determine Global Status with Strict Precedence
  // ==========================================================================
  // Precedence: invalid_request > clarification_required > proposals_generated > no_action_needed
  let status: "invalid_request" | "clarification_required" | "proposals_generated" | "no_action_needed";

  if (invalidReferencesSet.size > 0 || candidateValidationErrorsSet.size > 0) {
    status = "invalid_request";
  } else if (clarificationQuestionsSet.size > 0 || contradictions.length > 0) {
    status = "clarification_required";
  } else if (
    deduplicatedOps.some((op) => op.type !== "keep" && op.type !== "request_clarification")
  ) {
    status = "proposals_generated";
  } else {
    status = "no_action_needed";
  }

  return {
    status,
    proposedOperations: deduplicatedOps,
    suppressedContextMemoryIds: Array.from(suppressedContextMemoryIds).sort(),
    contradictions: [...contradictions].sort((a, b) => a.existingMemoryId.localeCompare(b.existingMemoryId)),
    clarificationQuestions: Array.from(clarificationQuestionsSet).sort(),
    invalidReferences: Array.from(invalidReferencesSet).sort(),
    warnings: Array.from(warningsSet).sort(),
  };
}
