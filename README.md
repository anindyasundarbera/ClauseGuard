# ClauseGuard Hybrid

> **Local-First Legal & Contract Privacy Airlock powered by Firebase AI Logic Hybrid Inference, Chrome Built-in Gemini Nano, and Firebase App Check**  
> Built for **Google #BuildHybridAI 2026** (`Web (Chrome)` track).

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

---

## 1. What ClauseGuard Hybrid Does

Lawyers, founders, and procurement reviewers frequently hesitate to paste confidential contracts (MSAs, NDAs, M&A term sheets, employment agreements) into cloud AI tools because raw counterparty names, IBANs, tax IDs, emails, executive names, and deal pricing leave the device before review.

**ClauseGuard Hybrid** enforces a strict, deterministic **Privacy Airlock** between raw contract ingestion in Chrome and cross-clause risk reasoning in the cloud:

1. **Client-Side Ingestion & Unicode Security Hardening (`src/core/ingestion/`):**  
   Parses `.txt`, `.md`, `.docx` (`jszip`), and digital `.pdf` (`pdfjs-dist` local worker) completely inside browser RAM. Runs `NFKC` normalization, strips invisible format (`Cf`) characters, and flags mixed-script homoglyphs or white-on-white hidden PDF text before extraction.
2. **On-Device Entity Extraction via Firebase AI Logic `ONLY_ON_DEVICE` (`src/core/orchestration/nanoAdapter.ts`, `src/core/firebase/firebaseClient.ts`):**  
   Uses `firebase/ai` (`getAI(..., { backend: new GoogleAIBackend() })`, `getGenerativeModel(..., { mode: InferenceMode.ONLY_ON_DEVICE })`, `model.initializeDeviceModel(...)`) alongside `ARCH-RET-4.1` deterministic regex + contextual disambiguation and document-scoped role bindings (`DocumentEntityBinding`) inside a strictly token-bounded chunker (`<= 1,800` tokens / `<= 4,500` chars).  
   - **Never uses `PREFER_ON_DEVICE` for raw text:** Raw confidential text is **never** silently routed to cloud if Chrome Prompt API is unavailable. On-device models are bound with `{ baseUrl: "http://127.0.0.1:0/only-on-device-cloud-egress-blocked" }` as defense in depth against fallback egress.
   - **Honest Degraded Mode:** If Chrome built-in weights are not yet downloaded on a host/OS, the readiness badge displays the exact browser availability state (`DOWNLOADABLE_PENDING_WEIGHTS` / `UNAVAILABLE` / `DEGRADED_DETERMINISTIC_SAFE`) and runs deterministic local extraction + single-clause local triage without fabricating on-device neural inference.
3. **Human-Reviewed Privacy Airlock & Exact SHA-256 Binding (`src/core/redaction/`, `src/core/inference/approvalMachine.ts`):**  
   Every detected entity starts as `PENDING_REVIEW`. Switching to `HYBRID_ANONYMIZED` requires resolving every entity (`Accept`, `Reject`, or add manual sensitive spans) and clicking **Approve Exact Sanitized Payload** — locking an immutable `ApprovalRecord` (`HUMAN_APPROVED_FOR_CLOUD`) to the exact live SHA-256 digest and `mapVersion`. Any post-approval edit or entity toggle transitions immediately to `STALE_APPROVAL_INVALIDATED` and blocks cloud calls.
4. **Preflight-Protected Cloud Reasoning via Firebase AI Logic `ONLY_IN_CLOUD` + App Check (`src/core/firebase/`):**  
   Before any cloud packet leaves Chrome:
   - `initializeAppCheck(...)` is executed strictly before `getAI()`, supporting production `ReCaptchaEnterpriseProvider` or localhost-restricted `FIREBASE_APPCHECK_DEBUG_TOKEN` (`useLimitedUseAppCheckTokens` configurable).
   - `ZeroCanaryPreflight` scans the exact approved anonymized string for unredacted names, IBANs, SSNs, API keys, and emails.
   - `firebase/ai` `InferenceMode.ONLY_IN_CLOUD` calls a supported free-tier Gemini model (`gemini-3.5-flash-lite` default, `gemini-3.8-flash`, or `gemini-4-hydrogen`; deprecated Gemini 1.x/2.x IDs are rejected).
   - Responses are validated against `CLOUD_FINDINGS_FIREBASE_SCHEMA` (`{ findings: [...] }`), verified for `result.response.inferenceSource === InferenceSource.IN_CLOUD`, and **rehydrated locally** (`[UNMAPPED_TOKEN:...]` surfaced transparently if the model invents an unmapped placeholder).
   - If no live Firebase configuration is loaded, judges and privacy-strict users can run offline deterministic triage (`DETERMINISTIC_LOCAL_TRIAGE`) or explicitly labeled `SIMULATED_CLOUD_SYNTHESIS` with **zero external packets**.
5. **Guardrailed Firebase Remote Config (`src/core/firebase/remoteConfigGuard.ts`):**  
   Supports runtime tuning of non-secret operational parameters (`cloud_model_name`, `playbook_id`, `max_cloud_output_tokens`) while deterministically rejecting any remote override attempting to weaken human approval, `ZeroCanaryPreflight`, or App Check enforcement.

---

## 2. Quick Start for Judges & Developers

### Prerequisites
- **Node.js** `>= 20` and `npm`
- **Google Chrome** (latest stable/dev with Prompt API & Gemini Nano support for on-device inference; runs cleanly in deterministic + cloud/simulated modes on any standard Chrome installation too)

### Install & Run Locally

```bash
cd projects/clauseguard_hybrid
npm ci
npm run typecheck
npm test
npm run build
npm run preview
```

Open the printed localhost URL (`http://localhost:4173`) in Google Chrome.

### Enabling Chrome Built-in Gemini Nano / Gemma 4 (On-Device Path)
In Chrome, open `chrome://flags` and enable:
1. `#prompt-api-for-gemini-nano` (**Prompt API for Gemini Nano** -> `Enabled`)
2. `#optimization-guide-on-device-model` (**Enables optimization guide on device** -> `Enabled BypassPerfRequirement`)
3. Search `chrome://flags` for **`Gemma 4 for Built-in AI`** and set to `Enabled` if present in your Chrome build.

Restart Chrome, inspect `chrome://on-device-internals`, and inside ClauseGuard Hybrid click **`Initialize / Download On-Device Model`** (or inspect the honest status badge).

---

## 3. Firebase AI Logic & App Check Setup (Optional for Live Cloud Calls)

ClauseGuard Hybrid can execute **end-to-end locally with zero external network packets** using the built-in deterministic + labeled simulated mode, or connect to your Firebase Spark project (`Billing NOT required` for `gemini-3.5-flash-lite`, `gemini-3.8-flash`, `gemini-4-hydrogen`):

1. Create or select a Firebase project in the Firebase Console (`clauseguard-hybrid-1c5e2` is configured for this submission).
2. Enable **Firebase AI Logic** (`Gemini Developer API`, Spark free tier) in Firebase Console > AI Logic.
3. Register a **Web App** in Project Settings and register a **reCAPTCHA Enterprise** site key (or add a local App Check Debug Token in App Check > Apps > Manage debug tokens for `localhost` testing).
4. **Option A — Ephemeral RAM Config Drawer (No rebuild needed):**  
   Click **"Firebase Config & Telemetry (RAM Only)"** in the ClauseGuard UI, paste your public Firebase Web JSON snippet + site key / localhost debug checkbox, and test `ONLY_IN_CLOUD`. Nothing is written to disk or git.
5. **Option B — Untracked `.env.local` for Vite Dev:**
   ```bash
   cp .env.example .env.local
   ```
   Fill `VITE_FIREBASE_*` values in `.env.local` (`.env.local` is ignored by `.gitignore`).  
   **Security Notice:** Never commit `.env.local`, service-account JSONs, or App Check debug token UUIDs, and do not bake debug tokens into production builds (`dist/`).

---

## 4. Verification & Reproducibility Commands

| Check | Command | Purpose |
|---|---|---|
| TypeScript strict check | `npm run typecheck` | Verifies zero compile/type errors across `src/` |
| Unit & Firebase wire suite | `npm test` | Tests chunker Unicode bounds, Airlock SHA-256 invalidation, `ARCH-RET-4.1`, Remote Config guards, `@firebase/ai` `ONLY_ON_DEVICE` adapter & HTTP wire `ONLY_IN_CLOUD` + `X-Firebase-AppCheck` |
| Production dependency audit | `npm audit --omit=dev` | Verifies 0 known vulnerabilities in runtime deps |
| Chrome Nano readiness probe | `python3 probes/nano_runtime_probe.py` | Probes live Chrome Web Prompt API & component weights cleanly |
| Playwright Chrome CDP egress & adversarial suite | `npm run build && python3 tests/e2e_cdp_privacy_verify.py` | Verifies 11 browser security scenarios (PDF/DOCX ingestion, XSS/homoglyph hardening, pre-approval 0-packet proof, `@firebase/ai` `ONLY_IN_CLOUD` wire proof, offline triage, purge) |
| Separated `llama.cpp` SLM diagnostic | `python3 probes/bench_llamacpp_diagnostic.py` | Local engineering comparison (`Qwen2.5-1.5B` & `gemma-3-270m` via `llama.cpp`; Ollama not used) |

---

## 5. Monorepo Context & Pre-Existing Code Disclosure (#BuildHybridAI Rules Compliance)

- **Location:** `projects/clauseguard_hybrid/` inside [`harness2-engineering-system`](../../).
- **Period Built:** Designed and implemented during the **#BuildHybridAI 2026** submission window (**November 16–18, 2026**), verified via `git log`.
- **Pre-Existing Scaffolding Disclosed:** Repository governance engine (`src/harness2_eis/`, `scripts/`, root `AGENTS.md`, unrelated `projects/unhold_paypal` / `projects/alpha_service`) existed prior to Nov 11, 2026. Zero runtime imports from `src/harness2_eis/` exist inside `projects/clauseguard_hybrid/src/`.
- **License:** [MIT License](./LICENSE) (matches root [LICENSE](../../LICENSE)).
