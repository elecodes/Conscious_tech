import { ExtractedItem } from "../../domain/items";
import { Relationship, DetectedRelationships } from "../../domain/relationships";

export interface CleanRelationshipsOptions {
  inferSameProject?: boolean;
}

/**
 * Deterministically cleans, validates, canonicalizes, and deduplicates relationships.
 */
export function cleanAndValidateRelationships(
  rawRelationships: Relationship[],
  items: ExtractedItem[],
  options: CleanRelationshipsOptions = { inferSameProject: true }
): DetectedRelationships {
  if (items.length < 2) {
    return { relationships: [] };
  }

  const validIds = new Set(items.map((i) => i.id));
  const seenKeys = new Set<string>();
  const cleaned: Relationship[] = [];

  for (const rel of rawRelationships) {
    // 1. ID validity check: both source and target must exist
    if (!validIds.has(rel.sourceItemId) || !validIds.has(rel.targetItemId)) {
      continue;
    }

    // 2. No self-relations
    if (rel.sourceItemId === rel.targetItemId) {
      continue;
    }

    // 3. Canonicalize direction for causal and symmetric relationships
    let source = rel.sourceItemId;
    let target = rel.targetItemId;
    let type = rel.type;

    // Prefer depends_on: if "B blocks A", canonicalize to "A depends_on B"
    if (type === "blocks") {
      source = rel.targetItemId;
      target = rel.sourceItemId;
      type = "depends_on";
    }

    // For symmetric types, sort IDs to prevent redundant A->B and B->A pairs
    const isSymmetric =
      type === "same_project" ||
      type === "same_objective" ||
      type === "related_to" ||
      type === "duplicate";

    if (isSymmetric && source > target) {
      const temp = source;
      source = target;
      target = temp;
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

  // 5. Deterministic same_project inference if items have explicit matching project strings
  if (options.inferSameProject) {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const itemA = items[i];
        const itemB = items[j];
        if (!itemA || !itemB) continue;

        const projA = itemA.project?.trim().toLowerCase();
        const projB = itemB.project?.trim().toLowerCase();

        if (projA && projB && projA === projB) {
          const [source, target] = itemA.id < itemB.id ? [itemA.id, itemB.id] : [itemB.id, itemA.id];
          const key = `${source}::${target}::same_project`;

          // Only add if not already covered by same_project or a more specific relation (e.g. part_of)
          const alreadyRelated = cleaned.some(
            (r) =>
              (r.sourceItemId === source && r.targetItemId === target) ||
              (r.sourceItemId === target && r.targetItemId === source)
          );

          if (!seenKeys.has(key) && !alreadyRelated) {
            seenKeys.add(key);
            cleaned.push({
              sourceItemId: source,
              targetItemId: target,
              type: "same_project",
              confidence: "high",
              reason: `Ambos elementos pertenecen explícitamente al proyecto "${itemA.project}"`,
            });
          }
        }
      }
    }
  }

  return { relationships: cleaned };
}
