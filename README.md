# ClauseGuard Hybrid

> **Local-First Legal & Contract Privacy Airlock powered by Firebase AI Logic Hybrid Inference, Chrome Built-in Gemini Nano, and Firebase App Check**  
> Built for **Google #BuildHybridAI 2026** (`Web (Chrome)` track).

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

---

## 1. What ClauseGuard Hybrid Does

Lawyers, founders, and procurement reviewers hesitate to paste confidential contracts (MSAs, NDAs, M&A term sheets, employment agreements) into cloud AI tools because raw counterparty names, IBANs, tax IDs, emails, executive names, and deal pricing leave the device before review.

**ClauseGuard Hybrid** enforces a strict, deterministic **Privacy Airlock** between raw contract ingestion in Chrome and cross-clause risk reasoning in the cloud:

1. **Client-Side Ingestion & Unicode Security Hardening (`src/core/ingestion/`):**  
   Parses `.txt`, `.md`, `.docx` (`jszip`), and digital `.pdf` (`pdfjs-dist` local worker with `isEvalSupported: false`) completely inside browser RAM. Runs `NFKC` normalization, strips invisible format (`Cf`) characters, and flags mixed-script homoglyphs or white-on-white hidden PDF text before extraction.
2. **On-Device Entity Extraction via Firebase AI Logic `ONLY_ON_DEVICE` (`src/core/orchestration/nanoAdapter.ts`, `src/core/firebase/firebaseClient.ts`):**  
   Uses `firebase/ai` (`getAI(..., { backend: new GoogleAIBackend() })`, `getGenerativeModel(..., { mode: InferenceMode.ONLY_ON_DEVICE })`, `model.initializeDeviceModel(...)`) alongside `ARCH-RET-4.1` deterministic regex + contextual disambiguation and document-scoped role bindings (`DocumentEntityBinding`) inside a strictly token-bounded chunker (`<= 1,800` tokens / `<= 4,500` chars).  
   - **Never uses `PREFER_ON_DEVICE` for raw text:** Raw confidential text is **never** silently routed to cloud if Chrome Prompt API is unavailable. On-device models bind `{ baseUrl: "http://127.0.0.1:0/only-on-device-cloud-egress-blocked" }` as defense in depth against fallback egress.
   - **Honest Degraded Mode:** If Chrome built-in weights are not yet downloaded on a host/OS, the readiness badge displays the exact browser availability state (`DOWNLOADABLE_PENDING_WEIGHTS` / `UNAVAILABLE` / `DEGRADED_DETERMINISTIC_SAFE`) and runs deterministic local extraction + single-clause local triage without fabricating on-device neural inference.
3. **Human-Reviewed Privacy Airlock & Exact SHA-256 Binding (`src/core/redaction/`, `src/core/inference/approvalMachine.ts`):**  
   Every detected entity starts as `PENDING_REVIEW`. Switching to `HYBRID_ANONYMIZED` requires resolving every entity (`Accept`, `Reject`, or add manual sensitive spans) and clicking **Approve Exact Sanitized Payload** — locking an immutable `ApprovalRecord` (`HUMAN_APPROVED_FOR_CLOUD`) to the exact live SHA-256 digest and `mapVersion`. Any post-approval edit or entity toggle aborts in-flight calls and transitions immediately to `STALE_APPROVAL_INVALIDATED`.
4. **Preflight-Protected Cloud Reasoning via Firebase AI Logic `ONLY_IN_CLOUD` + App Check (`src/core/firebase/`):**  
   Before any cloud packet leaves Chrome:
   - `initializeAppCheck(...)` is executed strictly before `getAI()`, supporting production `ReCaptchaEnterpriseProvider` or localhost-restricted `FIREBASE_APPCHECK_DEBUG_TOKEN` (`useLimitedUseAppCheckTokens` configurable).
   - `ZeroCanaryPreflight` scans the exact approved anonymized string for unredacted names, IBANs, SSNs, API keys, and emails.
   - `firebase/ai` `InferenceMode.ONLY_IN_CLOUD` calls a supported free-tier Gemini model (`gemini-3.5-flash-lite` default, `gemini-3.8-flash`, or `gemini-4-hydrogen`; deprecated Gemini 1.x/2.x IDs are rejected).
   - Responses are validated against `CLOUD_FINDINGS_FIREBASE_SCHEMA` (`{ findings: [...] }`), verified for `result.response.inferenceSource === InferenceSource.IN_CLOUD`, and **rehydrated locally** (`[UNMAPPED_TOKEN:...]` surfaced transparently if the model invents an unmapped placeholder).
   - If offline or without App Check credentials, judges and privacy-strict users can run offline deterministic triage (`DETERMINISTIC_LOCAL_TRIAGE`) or explicitly labeled `SIMULATED_CLOUD_SYNTHESIS` with **zero external packets**.
5. **Guardrailed Firebase Remote Config (`src/core/firebase/remoteConfigGuard.ts`):**  
   Supports runtime tuning of non-secret operational parameters (`cloud_model_name`, `playbook_id`, `max_cloud_output_tokens`) while deterministically rejecting any remote override attempting to weaken human approval, `ZeroCanaryPreflight`, or App Check enforcement.

---

## 2. Quick Start for Judges & Developers

### Prerequisites
- **Node.js** `>= 20` and `npm`
- **Google Chrome** (Desktop Chrome v139+ with Prompt API & Gemini Nano / Gemma 4 support for on-device inference; also runs cleanly in deterministic + cloud/simulated modes on standard Chrome)

### Install & Run Locally

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run preview
```

Open `http://localhost:4173` in Google Chrome.

### Enabling Chrome Built-in Gemini Nano / Gemma 4 (On-Device Path)
In Chrome, open `chrome://flags` and enable:
1. `#prompt-api-for-gemini-nano` (**Prompt API for Gemini Nano** -> `Enabled`)
2. `#prompt-api-for-gemini-nano-multimodal-input` (**Prompt API for Gemini Nano with Multimodal Input** -> `Enabled`)
3. `#optimization-guide-on-device-model` (**Enables optimization guide on device** -> `Enabled BypassPerfRequirement`)
4. Search `chrome://flags` for **`Gemma 4 for Built-in AI`** and set to `Enabled` if available in your Chrome build.

Restart Chrome, inspect `chrome://on-device-internals`, and inside ClauseGuard Hybrid click **`Initialize / Download On-Device Model`** (or inspect the honest status badge).

---

## 3. Firebase AI Logic & App Check Setup

ClauseGuard Hybrid ships pre-pointed at the public Spark-tier Web App identifiers for `clauseguard-hybrid-1c5e2` (`gemini-3.5-flash-lite`, `gemini-3.8-flash`, `gemini-4-hydrogen`), and can also run completely offline via labeled local simulation (`0` external packets):

1. **Public Project Configuration Included by Default:** The Telemetry Strip displays `Firebase Project: clauseguard-hybrid-1c5e2` out of the box (`Billing NOT required` for text inference models).
2. **Option A — Ephemeral RAM Config Drawer (`Firebase Project, App Check & Remote Config Setup (Optional Live Cloud Override)`):**  
   Open the drawer in the ClauseGuard UI to inspect/override public Web JSON fields, supply a production `reCAPTCHA Enterprise` site key, or toggle **Localhost App Check Debug Token Mode** on `127.0.0.1` / `localhost` (`Apply Firebase Config in RAM`).
3. **Option B — Untracked `.env.local` for Vite Dev:**
   ```bash
   cp .env.example .env.local
   ```
   Set `VITE_FIREBASE_*` overrides or your private `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN` in `.env.local` (`.env.*` is ignored by `.gitignore`).  
   **Security Notice:** Never commit `.env.local`, service-account JSONs, or App Check debug token UUIDs, and keep debug tokens out of production builds (`dist/`).

---

## 4. Verification, Benchmarks & Reproducibility Commands

| Check | Command | Purpose |
|---|---|---|
| TypeScript strict check | `npm run typecheck` | Verifies zero compile/type errors across `src/` |
| Unit & Firebase wire suite | `npm test` | Tests Unicode chunker bounds, Airlock SHA-256 invalidation, `ARCH-RET-4.1`, Remote Config guards, `@firebase/ai` `ONLY_ON_DEVICE` adapter & HTTP wire `ONLY_IN_CLOUD` + `X-Firebase-AppCheck` |
| Synthetic benchmark suite | `npm run bench` | Runs the 42-contract `CG-BENCH-v2` evaluation (`ARCH-RET-4.1`: `0.9909` P, `0.8720` R, `0.8934` F2, `42/42` lossless round-trip) and writes `evidence/cg-bench-v2-results.json` |
| Production dependency audit | `npm audit --omit=dev` | Verifies `0` known vulnerabilities in runtime deps |
| Chrome Nano readiness probe | `python3 probes/nano_runtime_probe.py` | Probes live Chrome Web Prompt API & component weights cleanly (`evidence/phase2-nano-runtime-matrix.json`) |
| Playwright Chrome CDP egress & adversarial suite | `npm run build && python3 tests/e2e_cdp_privacy_verify.py` | Verifies 11 browser security scenarios (`evidence/phase6-cdp-egress-and-security-proof.json`) |
| Separated `llama.cpp` SLM diagnostic | `python3 probes/bench_llamacpp_diagnostic.py` | Optional offline engineering comparison (`Qwen2.5-1.5B` & `gemma-3-270m` via `llama.cpp`; Ollama not used) |

---

## 5. License

Licensed under the [MIT License](./LICENSE).
