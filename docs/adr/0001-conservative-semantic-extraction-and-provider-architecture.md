# ADR 0001: Conservative Semantic Extraction and AI Provider Abstraction

- **Status:** Accepted
- **Date:** 2026-10-06
- **Context:** Initial architecture & Skill 01 (`extract_items`) implementation

---

## Context and Problem Statement

**Conscious Tech** is a human-centered AI product focused on clarity and intentional attention, operating under the core principle:

> **AI proposes. The person decides.**

The first capability of the product is processing unconstrained natural language brain dumps (written or spoken) into structured units without turning the tool into an aggressive productivity tracker or generating cognitive pressure.

During early prototyping with LLMs, several failure modes appeared:
1. **Over-inferring commitments:** Tagging ordinary workplace tasks or items mentioning another person as `commitment: "external"`, and tagging personal tasks as `commitment: "personal"`.
2. **Pressure hallucination:** Converting doubts, curiosities, and conditional ideas ("if I have time", "maybe look into X") into actionable, pending tasks.
3. **Date hallucination:** Resolving broad temporal windows ("in November", "this week") into artificial exact ISO calendar deadlines.
4. **Effort hallucination:** Converting complaints or friction remarks ("Gradle takes half a day") into task effort estimates.
5. **Premature dependency coupling:** Merging distinct tasks into single composite items because they appeared in the same sentence or had an implicit sequence.

---

## Decision Drivers

* **Fidelity over completeness:** Preserve exactly what the user expressed; never assume or invent unstated data.
* **Deterministic code over AI:** If something can be computed reliably with code (date math, capacity calculation, schema validation), do not delegate it to an LLM.
* **Low-cost & free-tier first:** Decouple domain logic from LLM vendors and enable zero-token test suites.
* **Controlled memory lifecycle:** Acknowledge that consciously deciding *not* to do something or archiving an initiative is a first-class decision.

---

## Considered Options

1. **Monolithic agent prompt:** Rely on a general-purpose prompt that extracts, prioritizes, groups, and plans the week in one pass. *(Rejected: produces high hallucination, black-box decisions, and removes user agency).*
2. **Vendor-locked implementation:** Direct integration with Groq or OpenAI APIs within domain handlers. *(Rejected: leaks infrastructure details, breaks test determinism, incurs token costs during CI).*
3. **Layered architecture with conservative extraction & provider abstraction:** Pure domain schemas with Zod, an `AIProvider` interface, an ultra-conservative `extract_items` skill, and deterministic mock golden fixtures. *(Accepted).*

---

## Decision

We decided to implement:

1. **The "Extract, don't interpret" Principle for `extract_items`:**
   - **`commitment: "external"`** is assigned strictly when an explicit obligation, meeting, deadline, or appointment with a third party is stated. Mentioning another person or a workplace task defaults to `"none"`.
   - **`commitment: "personal"`** requires an explicit declaration of self-commitment ("I promised myself"). Standard personal tasks default to `"none"`.
   - **Ideas vs Tasks:** Exploratory thoughts ("maybe", "could", "if I have time") must remain `type: "idea"` and `status: "exploring"`.
   - **Exact Dates:** Only resolve exact ISO dates when unambiguous (e.g. "tomorrow" relative to `currentDate`). Broad expressions ("in November") remain unresolved (`resolved: null`, `confidence: "low"`).
   - **Atomic Extraction:** Separate distinct actions into distinct items (e.g. "ask Sofia" and "fix hotfix"); do not merge tasks prematurely. Dependency resolution is deferred to `detect_relationships`.
   - **Raw Text Integrity:** Always preserve the exact substring in `rawText`.

2. **Domain Status Extension:**
   - Added `"archived"` to `ItemStatus` (`"pending" | "started" | "exploring" | "archived"`). This accurately models items the user explicitly decides not to pursue or put on hold (e.g. Discord integration).

3. **Pluggable AI Provider Layer:**
   - Defined `AIProvider` interface with interchangeable implementations: `GroqProvider`, `GeminiProvider`, and `MockProvider`.
   - Built a factory driven by environment configuration (`AI_PROVIDER`, `GROQ_API_KEY`, etc.).
   - Established a 100% deterministic, zero-token test suite using `MockProvider` and 25 golden evaluation cases in `cases/mock-extractions.json`.

---

## Consequences

### Positive
- Zero token cost during CI and local unit test execution.
- Clear separation between raw extraction (`extract_items`) and higher-order skills (`detect_relationships`, `build_week`).
- Faithful preservation of user intent without unwanted productivity pressure.
- Easy benchmarking across different LLM backends (Groq `qwen/qwen3.8-27b`, Gemini `gemini-2.5-flash`).

### Negative / Trade-offs
- Relative date math ("next Tuesday" vs "this Tuesday") requires an upcoming deterministic calendar resolver module rather than relying on LLM resolution.
- Prompts must remain strictly guarded against model drift toward over-helpfulness.
