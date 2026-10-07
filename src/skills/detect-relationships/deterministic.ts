import { ExtractedItem } from "../../domain/items";
import { Relationship, DetectedRelationships } from "../../domain/relationships";

export interface CleanRelationshipsOptions {
  // Retained for backwards compatibility if needed, but defaults to false
  inferSameProject?: boolean;
}

/**
 * Deterministically cleans, validates, canonicalizes, and deduplicates relationships.
 * Enforces:
 * - Empty relationships when items < 2
 * - Rejection of invalid / phantom IDs
 * - Rejection of self-relations (sourceItemId === targetItemId)
 * - Canonical symmetric order (sourceItemId < targetItemId) for symmetric relation types
 * - Deduplication of identical relationships
 */
export function cleanAndValidateRelationships(
  rawRelationships: Relationship[],
  items: ExtractedItem[],
  _options?: CleanRelationshipsOptions
): DetectedRelationships {
  if (items.length < 2) {
    return { relationships: [] };
  }

  const validIds = new Set(items.map((i) => i.id));
  const seenKeys = new Set<string>();
  const cleaned: Relationship[] = [];

  for (const rel of rawRelationships) {
    // 1. ID validity check: both source and target must exist in the input items
    if (!validIds.has(rel.sourceItemId) || !validIds.has(rel.targetItemId)) {
      continue;
    }

    // 2. Reject self-relations
    if (rel.sourceItemId === rel.targetItemId) {
      continue;
    }

    let source = rel.sourceItemId;
    let target = rel.targetItemId;
    const type = rel.type;

    // 3. For symmetric types, canonicalize order so A->B and B->A produce a single canonical pair
    const isSymmetric =
      type === "same_project" ||
      type === "same_objective" ||
      type === "related_to" ||
      type === "duplicate";

    if (isSymmetric && source > target) {
      source = rel.targetItemId;
      target = rel.sourceItemId;
    }

    // 4. Deduplicate (same source, target, and type)
    const key = `${source}::${target}::${type}`;
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);

    cleaned.push({
      sourceItemId: source,
      targetItemId: target,
      type,
      confidence: rel.confidence,
      reason: rel.reason.trim(),
    });
  }

  return { relationships: cleaned };
}
