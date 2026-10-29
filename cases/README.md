# Test & Calibration Cases (`cases/`)

This directory contains benchmarking datasets and golden fixtures used for offline testing, zero-token regression suites, and model calibration.

## Privacy & Synthetic Data Notice

All 25 brain dumps in `real-dumps.json` (and their corresponding golden files `mock-*.json` and evaluation outputs `eval-*-results.json`) are **100% synthetic, fictional examples**.

- They were deliberately crafted to test edge cases in natural language parsing (tax forms, commitments, fuzzy deadlines, external dependencies, and emotional states).
- They **do not contain any authentic personal user data, real financial records, confidential client info, or private brain dumps**.
- They comply fully with the core privacy principles established in `AGENTS.md` (no storage of authentic personal dumps in version control).
