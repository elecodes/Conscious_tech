/**
 * Deterministic build_week domain engine facade.
 * Modularized into focused domain roles:
 * - capacity-math: pure calendar date resolution and capacity arithmetic
 * - planning-context: constraint extraction and normalized planning context construction
 * - validation: structural input validation and semantic quality evaluation
 * - repair: exact item conservation, invariant normalization, and repair audit trail
 */

export * from "./deterministic/capacity-math";
export * from "./deterministic/planning-context";
export * from "./deterministic/validation";
export * from "./deterministic/repair";
