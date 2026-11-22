# Devpost submission text (paste-ready)

Items marked **TODO** need the owner. Nothing below claims results that are not in `evidence/`.

## Basics

- **Project name:** ClauseGuard Hybrid
- **Platform selected:** Web (Chrome app, on-device Gemma/Gemini Nano via Firebase AI Logic)
- **Repo (public, Apache-2.0):** TODO paste GitHub URL. Check the repo's About box shows "Apache-2.0".
- **Hosted URL:** TODO (see docs/deploy.md; free, no login for judges)
- **Video (YouTube, public, <= 3 min):** TODO

## Tagline (under 60 chars)

Hybrid AI where you approve exactly what leaves your device.

## Inspiration

Leases, medical bills and contracts are full of names, IBANs, patient IDs and prices, and the usual advice is to paste them into a cloud chatbot. That leaks the data before anyone has decided it is fine. Hybrid inference looked like the right tool: let the private part run on the device, and let the cloud see only what a human has approved.

## What it does

ClauseGuard is a four-step privacy airlock in Chrome. **Import** a PDF, Word or text file (parsed locally). **Review** the sensitive items it finds (names, IBANs, emails, IDs, amounts) and accept, reject or add your own. **Approve** the exact cleaned text that would leave the device; the approval is bound to its SHA-256 and goes stale if anything changes. **Results**: a cloud Gemini model flags risky clauses (for example an unreasonable deposit rule or hidden fee) using placeholders only, and the real names are put back locally in your browser. If you prefer, **Check on this device only** keeps everything local, even offline.

## How we built it (Firebase AI Logic)

Firebase AI Logic's hybrid inference is the core, not an add-on. The same `firebase/ai` SDK is used in two explicit modes:

- `InferenceMode.ONLY_ON_DEVICE` for anything touching raw text: entity extraction and local clause triage with Chrome's on-device Gemma. We deliberately avoid `PREFER_ON_DEVICE`, because its silent cloud fallback would break the privacy promise. If the model is missing we fail closed to deterministic local detection, labelled `DEGRADED_DETERMINISTIC_SAFE`.
- `InferenceMode.ONLY_IN_CLOUD` for cross-clause reasoning, only on the human-approved redacted payload, with Firebase App Check (reCAPTCHA Enterprise; debug token on localhost only). `initializeAppCheck` runs before `getAI`.
- After every call the app checks `response.inferenceSource` (`on_device` or `in_cloud`) and rejects a mismatch, and shows the observed source in the UI.
- Firebase Remote Config tunes the model name, playbook and output-token limit, but the client rejects any remote value that would weaken approval, the leak preflight or App Check.

Around that: TypeScript and Vite, pdf.js and JSZip for local parsing, deterministic detectors plus a document-scoped entity graph, a SHA-256 approval state machine, a `ZeroCanaryPreflight` leak scan, Vitest for unit tests, and Playwright with the Chrome DevTools Protocol to record every network request in browser-level tests. Code paths are listed in the README.

## Challenges we ran into

- Chrome's on-device model is a moving target: on Chrome 156 the component updater failed on a 32-bit size overflow for the ~2.3 GiB Gemma component, so we wrote a verified fallback installer; on Chrome 158 availability varied with profile state before the live run passed. We report readiness honestly in the UI instead of faking it.
- Making "nothing leaves" provable, not just stated: we log every request with CDP and plant canary strings to check they never appear in a cloud body, URL or console.
- Keeping redaction lossless while names overlap (we index longest surface first; 42/42 synthetic documents round-trip exactly).
- Turning a privacy-engineer's flow into something a tenant or patient can follow in four steps.

## Accomplishments that we're proud of

All from files in `evidence/`:

- Browser privacy suite: 11 scenarios pass, 0 unexpected external requests, 0 raw canary strings in cloud request bodies. (Cloud endpoint was a local mock in that run.)
- Live on-device run on Chrome 158: Gemma available, two samples processed, 0 external requests in all phases, and an offline run (`navigator.onLine=false`) completed using the on-device model.
- Approval is byte-exact: sent SHA-256 equals approved SHA-256, and a post-approval edit blocks the cloud call.
- Detector benchmark on our own 42-document synthetic corpus: precision 0.991, recall 0.872 (be aware: synthetic, self-made data; recall is not perfect, which is why a human reviews).

## What we learned

- `ONLY_ON_DEVICE` plus `ONLY_IN_CLOUD` with a human gate gives a stronger privacy story than `PREFER_ON_DEVICE`, because the user can see the line between the two.
- Checking `inferenceSource` on every response turns "we think it ran locally" into something testable.
- On-device models add value on top of deterministic rules, but in our live run they added one entity on one of two samples. We would rather say so than oversell it.
- Hosting and browser-flag realities (HTTPS contexts, App Check domains, model download time) shape the demo as much as the code.

## What's next

- Run and record a live end-to-end cloud call against the production Firebase project and publish that evidence.
- Benchmark Gemma's own extraction quality (the current benchmark measures only the deterministic detector).
- OCR for scanned documents, more document types, and a Chrome-extension version for use inside web mail and DMS tools.
- User testing with real tenants, patients and small legal teams. None has happened yet.
- External security review of the browser vault.

## Built with

TypeScript, Vite, Vitest, Firebase AI Logic (`firebase/ai`), Firebase App Check (reCAPTCHA Enterprise), Firebase Remote Config, Firebase Hosting (planned), Gemini (cloud, `gemini-3.5-flash-lite` default), Chrome Prompt API / Gemma 4 on-device model, pdf.js, JSZip, Playwright, Chrome DevTools Protocol, Python (probes and tests), Mermaid (docs).

## Required disclosures (paste into the "additional info" / testing instructions fields)

- **How Firebase AI Logic is used:** see "How we built it". Imported and called at runtime in `src/core/firebase/firebaseClient.ts`, `src/core/orchestration/nanoAdapter.ts`, `src/core/inference/approvalMachine.ts`.
- **Pre-existing code:** TODO owner to confirm. The repository history starts 2026-11-17 (inside the Nov 11 - Nov 30 period) but this was extracted from an earlier research prototype in a larger private monorepo. State that plainly and summarise what was built during the period (four-step UI, Firebase AI Logic integration, App Check, Remote Config guard, approval machine, CDP privacy suite, live on-device proof, hosting config, docs). Do not claim the whole thing was started after Nov 11 unless true.
- **AI coding assistants** (Claude Code) were used to write and test parts of the code and docs. Standard open-source libraries are used under their own licences.
- **No secrets or personal data in the repo:** only public Firebase web identifiers; `.env.local` is git-ignored. Sample documents are entirely made up (names, IBANs, IDs). TODO owner: run a secret scan before making the repo public.
- **Free for judges:** TODO confirm the hosted URL needs no login and no payment. Text inference uses free-tier models; no billing is required. If judges need Chrome flags for the on-device path, point them to README section 7 and note the app still runs (deterministic local mode, practice-mode cloud) without them.
- **Not legal or medical advice.** Output is a first-pass flag.
- **Limits of evidence:** the committed live cloud evidence is against a mock; the on-device proof is a single Linux machine on Chrome 158. No user or usage statistics exist.
- **Testing instructions for judges (paste):** Open the hosted URL in desktop Chrome. Pick the "tenant lease" sample, press "Hide all suggested items", "Continue to approval", tick the consent box, "Approve this exact text", then "Run the deeper check". To test offline/local only, choose "Check on this device only". Source code, tests and setup are in the repo README.
