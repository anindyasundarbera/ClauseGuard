# AGENTS.md — `projects/clauseguard_hybrid/`

> **Authoritative Parent Anchor:** `../../AGENTS.md` (Harness² EIS Monorepo, Work Order `WO-055`, Project `PRJ-CLAUSEGUARD-HYBRID`)

## 1. Local Workflow & Privacy Invariants
- **Run Unit & Integration Tests:** `cd projects/clauseguard_hybrid && npm test`
- **Typecheck & Build:** `cd projects/clauseguard_hybrid && npm run build`
- **CDP Privacy Egress Suite:** `python3 projects/clauseguard_hybrid/tests/e2e_cdp_privacy_verify.py`
- **Local Chrome Nano Probe:** `python3 projects/clauseguard_hybrid/probes/nano_runtime_probe.py`

## 2. Hard Engineering Rules
1. Never use `PREFER_ON_DEVICE` for raw document text; all raw operations enforce `ONLY_ON_DEVICE` and fail closed to `DEGRADED_DETERMINISTIC_SAFE`.
2. Cloud requests require explicit human approval bound to `approved_payload_sha256` and must pass `ZeroCanaryPreflight`.
3. Separate workspace `CanonicalEntity` identity from ephemeral `DocumentEntityBinding` contract roles.
4. Keep `node_modules/` and `dist/` untracked (`.gitignore`).
