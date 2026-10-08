# Conscious Tech

> A personal clarity notebook and conscious AI companion designed to reduce noise, protect attention, and help people choose what matters each week.

---

## Philosophy & Core Rules

1. **The AI proposes; the human decides.** The system never silently alters your plans or commits your time.
2. **Code over AI when deterministic.** If a problem can be solved deterministically with code (summing hours, checking capacity, validating dates), we do not use AI. Semantic understanding and interpretation are handled by compact, cost-effective models.
3. **Do not turn every thought into a task.** Thoughts, explorations, and doubts remain ideas or concerns—never forced into actionable pressure.
4. **Do not plan 100% capacity.** Available time is not fully plannable time; protected space for rest, overflow, and thinking is essential.

---

## Architecture & Current Status

This repository is built incrementally following clean architecture principles:

```text
docs/
└── adr/                     # Architectural Decision Records
    ├── 0001-conservative-semantic-extraction-and-provider-architecture.md
    ├── 0002-detect-relationships-conservative-semantic-links.md
    └── 0003-group-work-coherent-lines-of-attention.md
src/
├── domain/                  # Pure domain types & strict Zod schemas
│   ├── items.ts             # ItemType, ItemStatus (incl. archived), ExtractedItem
│   ├── relationships.ts     # RelationshipType, Relationship, DetectedRelationships
│   └── work-groups.ts       # WorkGroup, GroupedWork, GroupWorkInput
├── providers/               # AI Provider abstraction layer
│   ├── ai-provider.ts       # AIProvider interface
│   ├── groq-provider.ts     # Groq implementation (qwen/qwen3.8-27b)
│   ├── gemini-provider.ts   # Google Gemini implementation (gemini-2.5-flash)
│   ├── mock-provider.ts     # Zero-token deterministic provider with golden cases
│   └── factory.ts           # Provider factory driven by env / options
├── skills/
│   ├── extract-items/       # Skill 01: Semantic brain dump extraction
│   │   ├── prompt.ts        # Conservative prompt (Extract, don't interpret)
│   │   ├── parser.ts        # Markdown stripping & Zod schema validation
│   │   └── index.ts         # ExtractItemsService with structured retry
│   ├── detect-relationships/# Skill 02: Semantic relationship detection
│   │   ├── prompt.ts        # Conservative prompt (Detect relationships, don't group)
│   │   ├── parser.ts        # Markdown stripping & Zod schema validation
│   │   ├── deterministic.ts # Canonicalization, deduplication, same_project inference
│   │   └── index.ts         # DetectRelationshipsService
│   └── group-work/          # Skill 03: Coherent lines of attention
│       ├── prompt.ts        # Grouping prompt (lines of work, not planning)
│       ├── parser.ts        # Markdown stripping & Zod schema validation
│       ├── deterministic.ts # Invariant engine: conservation, disjoint groups
│       └── index.ts         # GroupWorkService with short-circuits
└── web/                     # Lightweight testing UI & data inspector
    ├── App.tsx
    ├── main.tsx
    └── style.css
cases/
├── real-dumps.json          # 25 authentic Spanish brain dumps for calibration
├── mock-extractions.json    # Golden reference extractions for zero-token tests
├── mock-relationships.json  # Golden reference relationships for zero-token tests
├── mock-groupings.json      # Golden reference work groups for zero-token tests
├── eval-results.json        # Evaluation output logs (Skill 01)
├── eval-relationships-results.json # Evaluation output logs (Skill 02)
└── eval-group-work-results.json    # Evaluation output logs (Skill 03)
```

### Skill 01: `extract_items`
Converts unstructured natural language (brain dumps) into structured, faithful items:
- **Types**: `task`, `project`, `idea`, `commitment`, `concern`
- **Statuses**: `pending`, `started`, `exploring`, `archived`
- **Commitments**: `external` (strict third-party commitments only), `personal` (explicit self-promises only), `none`
- **Deadlines**: Preserves raw text, resolves ISO dates only when completely unambiguous
- **Effort & Importance**: Extracted exclusively when explicitly declared by the user

### Skill 02: `detect_relationships`
Detects semantic links between items without grouping or prioritizing:
- **Relationship Types**: `same_project`, `same_objective`, `related_to`, `part_of`, `depends_on`, `blocks` (canonicalized to `depends_on`), `duplicate`
- **Strict Semantic Boundaries**: Concerns remain completely isolated, pre-conditions are strictly `depends_on` (not `part_of`), `related_to` rejects co-existence or "mientras tanto" workarounds, and mutual exclusion prevents redundant simultaneous `depends_on` and `part_of`.
- **Deterministic post-processing**: Short-circuits inputs < 2 items, strips self-relations and invalid IDs, deduplicates symmetric edges with canonical sorting.

### Skill 03: `group_work`
Synthesizes items into coherent lines of attention without deciding weekly priorities or capacities:
- **Output**: Disjoint `WorkGroup` entities (`title`, `itemIds`, `rationale`) and `ungroupedItemIds`.
- **Deterministic Invariant Engine**: Guarantees total item conservation (no lost items, no phantom items), disjoint partitions (no item in two groups), and group dissolution if $< 2$ items.
- **Short-circuits**: Returns in 0ms (0 tokens) for empty inputs, single items, or items with zero relationships.
- **Test Suite**: 87 passing unit and behavioral tests running in < 400ms with zero token expenditure.

---

## Quick Start

### Prerequisites
- Node.js `>= 20` (Node 22 recommended)
- npm

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment (Optional)
Create a `.env` file (see `.env.example`) or configure credentials directly in the web UI:

```bash
# Provider selection: groq | gemini | mock
AI_PROVIDER=groq

# Groq (Free tier friendly)
GROQ_API_KEY=gsk_...
GROQ_MODEL=qwen/qwen3.8-27b

# Gemini (Free tier friendly)
GEMINI_API_KEY=AIza...
GEMINI_MODEL=gemini-2.5-flash
```

### 3. Run Development UI
```bash
npm run dev
```
Open `http://localhost:5173` to test brain dumps interactively, select real-world cases, switch providers, and inspect raw JSON outputs.

### 4. Run Test Suite
Unit and behavioral tests run deterministically with zero token consumption:
```bash
npm test
```

### 5. Run Batch Evaluation
Evaluate the 25 calibration brain dumps through the CLI runner:
```bash
# Deterministic mock (0 tokens)
npm run eval -- --provider=mock

# Live Groq evaluation (requires GROQ_API_KEY)
npm run eval -- --provider=groq

# Specific case inspection
npm run eval -- --provider=groq --case=case-01
```

### 6. Typecheck & Build
```bash
npm run typecheck
npm run build
```

---

## Documentation & Decisions

- **Architectural Decisions:** See [ADR 0001: Conservative Semantic Extraction and AI Provider Abstraction](docs/adr/0001-conservative-semantic-extraction-and-provider-architecture.md).
- **Release History:** See [CHANGELOG.md](CHANGELOG.md).
- **Product Context:** See [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) and [MEMORY.md](MEMORY.md).

---

## Skills Roadmap

- [x] **01 extract_items** (Completed & calibrated)
- [x] **02 detect_relationships** (Completed & calibrated)
- [x] **03 group_work** (Completed & calibrated)
- [ ] **04 detect_deadlines**
- [ ] **05 evaluate_context**
- [ ] **06 build_week**
- [ ] **07 analyze_change**
- [ ] **08 detect_conflict**
- [ ] **09 propose_adjustment**
- [ ] **10 manage_memory**

---

## License

Private / MIT
