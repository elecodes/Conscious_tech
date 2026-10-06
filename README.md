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
src/
├── domain/                  # Pure domain types & strict Zod schemas
│   └── items.ts             # ItemType, ExtractedItem, Effort, DateReference
├── providers/               # AI Provider abstraction layer
│   ├── ai-provider.ts       # AIProvider interface
│   ├── groq-provider.ts     # Groq implementation (Llama 3.3 70B / 3.1 8B)
│   ├── gemini-provider.ts   # Google Gemini implementation (Gemini 2.5 Flash)
│   ├── mock-provider.ts     # Zero-token deterministic provider for tests
│   └── factory.ts           # Provider factory driven by env / options
├── skills/
│   └── extract-items/       # Skill 01: Semantic brain dump extraction
│       ├── prompt.ts        # Compact, conservative prompt
│       ├── parser.ts        # Markdown stripping & Zod schema validation
│       └── index.ts         # ExtractItemsService with structured retry
└── web/                     # Lightweight testing UI & data inspector
    ├── App.tsx
    ├── main.tsx
    └── style.css
```

### Skill 01: `extract_items`
Converts unstructured natural language (brain dumps) into structured, faithful items:
- **Types**: `task`, `project`, `idea`, `commitment`, `concern`
- **Commitments**: `external`, `personal`, `none`
- **Deadlines**: Preserves raw text, resolves ISO dates only with high certainty
- **Effort & Importance**: Extracted exclusively when explicitly stated by the user

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
Create a `.env` file or provide keys directly in the web interface:

```bash
# Provider selection: groq | gemini | mock
AI_PROVIDER=groq

# Groq (Free tier friendly)
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.3-70b-versatile

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
Unit tests run deterministically with zero token consumption:
```bash
npm test
```

### 5. Typecheck & Build
```bash
npm run typecheck
npm run build
```

---

## Testing & Calibration Dataset

The project includes 25 authentic Spanish brain dumps in [`cases/real-dumps.json`](cases/real-dumps.json) representing real situations:
- Mixed tasks, ideas, and external commitments
- Cognitive overload and tax/legal concerns
- Vague thoughts that must **not** be converted into tasks
- Explicit effort estimations and deadlines

---

## Skills Roadmap

- [x] **01 extract_items** (Completed)
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
