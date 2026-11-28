# Devpost submission text (paste-ready)

Items marked **TODO** need the owner. Nothing below claims results that are not in `evidence/`.

## Basics

- **Project name:** ClauseGuard Hybrid
- **Platform selected:** Web (Chrome app, on-device Gemma/Gemini Nano via Firebase AI Logic)
- **Repo (public, Apache-2.0):** https://github.com/anindyasundarbera/ClauseGuard (check the repo's About box shows "Apache-2.0" once public)
- **Hosted URL:** https://clauseguard-hybrid-1c5e2.web.app (Firebase Hosting; free, no login for judges: see the confirmation item below)
- **Video (YouTube, public, <= 3 min):** TODO

## Tagline (under 60 chars)

Hybrid AI where you approve exactly what leaves your device.

## For judges: how ClauseGuard meets each criterion

### Technological Implementation

The same `firebase/ai` SDK runs both modes. `ONLY_ON_DEVICE` handles raw text. `ONLY_IN_CLOUD` handles only the approved, redacted text, after App Check is initialised. Every response is checked for `inferenceSource`, and a mismatch is rejected. The side panel also shows a "Left this device" note. It counts cloud requests from the browser's own Resource Timing record, not from app bookkeeping. One real cloud Gemini call is recorded (HTTP 200, App Check `ATTESTATION_VERIFIED`, no raw hidden values in the request body).

Check it: [firebaseClient.ts](https://github.com/anindyasundarbera/ClauseGuard/blob/main/src/core/firebase/firebaseClient.ts), [nanoAdapter.ts](https://github.com/anindyasundarbera/ClauseGuard/blob/main/src/core/orchestration/nanoAdapter.ts), [approvalMachine.ts](https://github.com/anindyasundarbera/ClauseGuard/blob/main/src/core/inference/approvalMachine.ts), [live run JSON](https://github.com/anindyasundarbera/ClauseGuard/blob/main/evidence/live-cloud-gemini-run.json), [egress.ts](https://github.com/anindyasundarbera/ClauseGuard/blob/main/src/ui/egress.ts).

### Design

The product is a calm four-step flow: Import, Review, Approve, Results. A "Walk through a sample lease" card gives one short hint per step. A plain-language guide explains each step, and a privacy report can be saved as a PDF. If the on-device model is missing, the app says so and uses built-in rules.

Check it: [start the walk](https://clauseguard-hybrid-1c5e2.web.app/#walk), [guide.html](https://github.com/anindyasundarbera/ClauseGuard/blob/main/guide.html), [reportPdf.ts](https://github.com/anindyasundarbera/ClauseGuard/blob/main/src/ui/reportPdf.ts).

### Potential Impact

People are told to paste leases, medical bills and contracts into chatbots. Tenants, patients and small businesses are the audience. The tool lets them get a first-pass risk check without sending names, IBANs or IDs. Five made-up samples cover these cases. No real users have tried it yet, and we make no usage claim.

Check it: [samples.ts](https://github.com/anindyasundarbera/ClauseGuard/blob/main/src/ui/samples.ts), [README section 9 (limitations)](https://github.com/anindyasundarbera/ClauseGuard/blob/main/README.md#9-limitations-read-these).

### Quality of the Idea

Hybrid inference is used as a privacy boundary. The person approves the exact bytes that leave the device, bound to a SHA-256 that goes stale if anything changes. The cloud sees placeholders only, and the real names are put back locally in the browser. The "Left this device" note lets anyone see the line between the two modes.

Check it: [approvalMachine.ts](https://github.com/anindyasundarbera/ClauseGuard/blob/main/src/core/inference/approvalMachine.ts), [egress test](https://github.com/anindyasundarbera/ClauseGuard/blob/main/tests/unit/egress.test.ts).

## Gallery images (captions)

1. Start: the "Walk through a sample lease" card, with "Left this device: 0 requests". Proves nothing leaves before you choose.
2. Review: the list of suggested items to hide. Proves a person decides what is sensitive.
3. Approve: "Would be sent, exactly as shown", with placeholders and 0 requests. Proves the cloud text is visible before it is sent.
4. Results: real names restored, "1 request to cloud AI" and the text fingerprint. Proves one approved request, and names return locally.
5. Offline, "Check on this device only". Proves the app works with no cloud at all.

## Inspiration

Leases, medical bills and contracts are full of names, IBANs, patient IDs and prices, and the usual advice is to paste them into a cloud chatbot. That leaks the data before anyone has decided it is fine. Hybrid inference looked like the right tool: let the private part run on the device, and let the cloud see only what a human has approved.

## What it does

ClauseGuard is a four-step privacy airlock in Chrome. **Import** a PDF, Word or text file (parsed locally). **Review** the sensitive items it finds (names, IBANs, emails, IDs, amounts) and accept, reject or add your own. **Approve** the exact cleaned text that would leave the device; the approval is bound to its SHA-256 and goes stale if anything changes. **Results**: a cloud Gemini model flags risky clauses (for example an unreasonable deposit rule or hidden fee) using placeholders only, and the real names are put back locally in your browser. If you prefer, **Check on this device only** keeps everything local, even offline. Two aids make this easy to check. A "Left this device" note in the side panel counts requests to cloud AI from the browser's own Resource Timing record and shows a short fingerprint of the approved text. A "Walk through a sample lease" card on the Start screen gives one hint per step.

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
- One real cloud Gemini call is recorded (2026-11-27): `gemini-3.5-flash-lite`, HTTP 200, App Check `ATTESTATION_VERIFIED`, no raw hidden values in the request body. It ran on localhost with an App Check debug token, on one sample.
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
- **Pre-existing code:** None. All work on ClauseGuard started on 2026-11-17, inside the submission period (Nov 11 - Nov 30, 2026). The first commit (`0daed88`) is from that day, and the full history of this repository is public.
- **AI coding assistants** (Claude Code) were used to write and test parts of the code and docs. Standard open-source libraries are used under their own licences.
- **No secrets or personal data in the repo:** only public Firebase web identifiers; `.env.local` is git-ignored. Sample documents are entirely made up (names, IBANs, IDs). A secret scan of the full git history (2026-11-27) found no API keys, tokens or private keys; the Firebase web API key was never committed.
- **Free for judges:** TODO confirm the hosted URL needs no login and no payment. Text inference uses free-tier models; no billing is required. If judges need Chrome flags for the on-device path, point them to README section 7 and note the app still runs (deterministic local mode, practice-mode cloud) without them.
- **Not legal or medical advice.** Output is a first-pass flag.
- **Limits of evidence:** one real cloud call is recorded (localhost, App Check debug token, one sample, one model); the broader 11-scenario egress suite used a local mock endpoint; the on-device proof is a single Linux machine on Chrome 158. No user or usage statistics exist.
- **Testing instructions for judges (paste):** Open https://clauseguard-hybrid-1c5e2.web.app/#walk in desktop Chrome and follow the hints on the sample lease. Watch the "Left this device" note in the side panel: it shows 0 until you approve, then 1 request. Without Chrome's on-device model the app still works with built-in rules and says so. To stay fully local, choose "Check on this device only" (works offline). Setup is in the README.
