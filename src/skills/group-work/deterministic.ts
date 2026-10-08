import { ExtractedItem } from "../../domain/items";
import { GroupedWork, WorkGroup } from "../../domain/work-groups";

export interface InvariantValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates the core domain invariants of a GroupedWork instance:
 * 1. Non-empty title for all groups.
 * 2. Non-empty rationale for all groups.
 * 3. All itemIds in groups exist in input items.
 * 4. All ungroupedItemIds exist in input items.
 * 5. No item appears in multiple groups.
 * 6. No item appears in both a group and ungroupedItemIds.
 * 7. Conservation: all input items are accounted for (none lost).
 * 8. No phantom items are invented.
 * 9. Each group contains at least 2 items.
 */
export function validateGroupWorkInvariants(
  result: GroupedWork,
  items: ExtractedItem[]
): InvariantValidationResult {
  const errors: string[] = [];
  const validIds = new Set(items.map((i) => i.id));
  const seenInGroups = new Set<string>();

  for (const group of result.groups) {
    if (!group.title || group.title.trim() === "") {
      errors.push(`Group "${group.id}" has an empty title`);
    }
    if (!group.rationale || group.rationale.trim() === "") {
      errors.push(`Group "${group.id}" has an empty rationale`);
    }
    if (group.itemIds.length < 2) {
      errors.push(
        `Group "${group.id}" contains fewer than 2 items (${group.itemIds.length})`
      );
    }
    for (const id of group.itemIds) {
      if (!validIds.has(id)) {
        errors.push(`Group "${group.id}" contains phantom/unknown itemId: "${id}"`);
      }
      if (seenInGroups.has(id)) {
        errors.push(`Item "${id}" appears in more than one group`);
      }
      seenInGroups.add(id);
    }
  }

  const seenUngrouped = new Set<string>();
  for (const id of result.ungroupedItemIds) {
    if (!validIds.has(id)) {
      errors.push(`Ungrouped list contains phantom/unknown itemId: "${id}"`);
    }
    if (seenInGroups.has(id)) {
      errors.push(`Item "${id}" appears in both a group and ungroupedItemIds`);
    }
    if (seenUngrouped.has(id)) {
      errors.push(`Item "${id}" is duplicated in ungroupedItemIds`);
    }
    seenUngrouped.add(id);
  }

  // Conservation check: every input item must be either in a group or ungrouped
  for (const item of items) {
    const isAssigned = seenInGroups.has(item.id) || seenUngrouped.has(item.id);
    if (!isAssigned) {
      errors.push(`Conservation violation: input item "${item.id}" is missing from output`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Deterministically cleans, normalizes, and enforces all invariants on GroupedWork:
 * - Drops phantom IDs.
 * - Enforces disjoint groups (an item is kept in the first group that claims it).
 * - Disbands groups with < 2 items, moving items to ungrouped.
 * - Ensures complete item conservation (no items lost, no items invented).
 * - Removes overlap between groups and ungrouped.
 * - Stably preserves item ordering.
 */
export function cleanAndValidateGroupedWork(
  raw: GroupedWork,
  items: ExtractedItem[]
): GroupedWork {
  if (items.length === 0) {
    return { groups: [], ungroupedItemIds: [] };
  }

  if (items.length === 1) {
    return { groups: [], ungroupedItemIds: [items[0]!.id] };
  }

  const validIds = new Set(items.map((i) => i.id));
  const claimedItemIds = new Set<string>();
  const cleanedGroups: WorkGroup[] = [];

  // 1. Process candidate groups
  for (let i = 0; i < raw.groups.length; i++) {
    const group = raw.groups[i]!;
    const title = group.title ? group.title.trim() : "";
    const rationale = group.rationale ? group.rationale.trim() : "";

    if (!title || !rationale) {
      continue;
    }

    // Filter valid, unassigned, unique items
    const groupItems: string[] = [];
    const seenInThisGroup = new Set<string>();

    for (const id of group.itemIds) {
      if (!validIds.has(id)) continue;
      if (claimedItemIds.has(id)) continue;
      if (seenInThisGroup.has(id)) continue;

      seenInThisGroup.add(id);
      groupItems.push(id);
    }

    // A coherent line of work must group at least 2 items
    if (groupItems.length >= 2) {
      for (const id of groupItems) {
        claimedItemIds.add(id);
      }
      cleanedGroups.push({
        id: group.id?.trim() || `group-${cleanedGroups.length + 1}`,
        title,
        itemIds: groupItems,
        rationale,
      });
    }
  }

  // 2. Process ungrouped items
  const cleanedUngroupedSet = new Set<string>();
  for (const id of raw.ungroupedItemIds) {
    if (validIds.has(id) && !claimedItemIds.has(id)) {
      cleanedUngroupedSet.add(id);
    }
  }

  // 3. Guarantee full conservation: any item not claimed by a group must be ungrouped
  for (const item of items) {
    if (!claimedItemIds.has(item.id)) {
      cleanedUngroupedSet.add(item.id);
    }
  }

  // 4. Stable sort ungrouped items according to input item order
  const cleanedUngroupedList = items
    .filter((item) => cleanedUngroupedSet.has(item.id))
    .map((item) => item.id);

  return {
    groups: cleanedGroups,
    ungroupedItemIds: cleanedUngroupedList,
  };
}
