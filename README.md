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
    └── 0001-conservative-semantic-extraction-and-provider-architecture.md
src/
├── domain/                  # Pure domain types & strict Zod schemas
│   └── items.ts             # ItemType, ItemStatus (incl. archived), ExtractedItem
├── providers/               # AI Provider abstraction layer
│   ├── ai-provider.ts       # AIProvider interface
│   ├── groq-provider.ts     # Groq implementation (qwen/qwen3.8-27b)
│   ├── gemini-provider.ts   # Google Gemini implementation (gemini-2.5-flash)
│   ├── mock-provider.ts     # Zero-token deterministic provider with 25 golden cases
│   └── factory.ts           # Provider factory driven by env / options
├── skills/
│   └── extract-items/       # Skill 01: Semantic brain dump extraction
│       ├── prompt.ts        # Conservative prompt (Extract, don't interpret)
│       ├── parser.ts        # Markdown stripping & Zod schema validation
│       └── index.ts         # ExtractItemsService with structured retry
└── web/                     # Lightweight testing UI & data inspector
    ├── App.tsx
    ├── main.tsx
    └── style.css
cases/
├── real-dumps.json          # 25 authentic Spanish brain dumps for calibration
├── mock-extractions.json    # Golden reference extractions for zero-token tests
└── eval-results.json        # Evaluation output logs
```

### Skill 01: `extract_items`
Converts unstructured natural language (brain dumps) into structured, faithful items:
- **Types**: `task`, `project`, `idea`, `commitment`, `concern`
- **Statuses**: `pending`, `started`, `exploring`, `archived`
- **Commitments**: `external` (strict third-party commitments only), `personal` (explicit self-promises only), `none`
- **Deadlines**: Preserves raw text, resolves ISO dates only when completely unambiguous
- **Effort & Importance**: Extracted exclusively when explicitly declared by the user

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
- [ ] **02 detect_relationships**
- [ ] **03 group_work**
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
