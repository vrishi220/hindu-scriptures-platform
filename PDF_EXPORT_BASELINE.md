# PDF Export Baseline (v0.3)

## Purpose
Define the canonical PDF export engine and deterministic baseline used by the v0.3 vertical slice.

## Canonical Engine Decision
- Decision ID: `D-013` (Accepted 2026-02-21)
- Engine: ReportLab
- Export endpoint: `GET /api/edition-snapshots/{snapshot_id}/export/pdf`
- Deterministic mode: `reportlab.pdfgen.canvas.Canvas(..., invariant=1)`

## Determinism Baseline
- Baseline assertion: repeated export of the same snapshot yields identical binary hash.
- Baseline hash method: `SHA-256` over response bytes.
- Existing regression coverage:
  - `test_snapshot_pdf_export_is_deterministic_for_same_snapshot`
  - File: `tests/test_phase1_backend_integration.py`

## Scope and Constraints (MVP)
- Export output is stable for identical snapshot input under the same code and dependency versions.
- Current PDF renderer prioritizes deterministic generation and policy-safe export over advanced layout fidelity.
- Supported flow includes basic title/body sections and deterministic pagination behavior used in current integration tests.
- Full template/materialization parity with future renderer work remains out of scope for this baseline.

## Operational Notes
- Keep ReportLab pinned in `requirements.txt` for CI/runtime reproducibility.
- Any change to PDF serialization, dependency version, or export data ordering requires:
  - RFC decision/log update,
  - re-validation of deterministic export tests,
  - baseline documentation update in this file.