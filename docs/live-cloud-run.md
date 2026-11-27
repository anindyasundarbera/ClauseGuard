# Recording one real cloud Gemini run

`tests/e2e_live_cloud_gemini_verify.py` makes **one** real Firebase AI Logic → Gemini call through the normal
four-step UI and saves what happened to `evidence/live-cloud-gemini-run.json` (plus
`evidence/live-cloud-gemini-results.png`). Nothing is mocked: the local simulation switch is turned off, so if the
cloud call fails the run fails instead of quietly falling back.

It runs on `localhost` with an App Check **debug token**, so you do not need the hosted site or reCAPTCHA domains.

## 1. One-time console setup (`clauseguard-hybrid-1c5e2`)

1. **AI Logic** is enabled with the *Gemini Developer API* backend (docs/firebase-setup.md step 1).
2. **App Check → Apps → web app → ⋮ → Manage debug tokens → Add debug token.** Let the console generate a UUID
   (or use `uuidgen`), name it e.g. `local-evidence-run`, and copy it.

## 2. `.env.local` (git-ignored, never commit it)

```bash
cp .env.example .env.local
```

Fill in the six `VITE_FIREBASE_*` values from Project settings → Your apps → web app, and paste the debug token
UUID from step 1.2:

```
VITE_FIREBASE_APPCHECK_DEBUG_TOKEN=<the UUID you registered>
```

`true` is refused by the script, because it makes a fresh unregistered token every run.

## 3. Run it

```bash
npm ci
pip install playwright && python3 -m playwright install chromium   # skip if you already run the other e2e scripts
python3 tests/e2e_live_cloud_gemini_verify.py            # add --headed to watch it
```

Options: `--model gemini-3.8-flash` (default `gemini-3.5-flash-lite`), `--chrome /usr/bin/google-chrome` to use your
own Chrome. The on-device model is **not** needed: without it, detection uses the deterministic detectors, which the
evidence records under `approval.local_inference_source`.

The script builds into a throwaway `.cg-live-cloud-build/` folder and deletes it afterwards, so the debug token never
ends up in `dist/`.

Exit code 0 = PASS, 1 = the call ran but a check failed, 2 = blocked before any cloud call (reason in the JSON).

## 4. Check before committing

- `status` is `PASS` and every entry in `checks` is `true`.
- `grep -nE 'AIza|[0-9a-f]{8}-[0-9a-f]{4}-' evidence/live-cloud-gemini-run.json` prints nothing (the script drops
  query strings and headers and scrubs UUIDs, but look anyway).
- Then delete the debug token in the console if you no longer need it.

## What the JSON proves

| Field | Meaning |
|---|---|
| `checks.no_external_request_before_approval` | Import, review and approve made no external request |
| `generate_content_calls[].url` / `http_status` | The real `firebasevertexai.googleapis.com …:generateContent` call and its 200 |
| `checks.request_body_is_exact_approved_payload` | The prompt sent contains the exact approved text (SHA in `approval`) |
| `generate_content_calls[].raw_values_found_in_request` | Every hidden original value searched for in the request body; must be empty |
| `generate_content_calls[].response` | Gemini's `modelVersion`, `responseId`, `usageMetadata`, `finishReason` and raw JSON text |
| `cloud_call.app_check_status` | `ATTESTATION_VERIFIED`: a real App Check token was obtained |
| `findings[].analysisSource` | `FIREBASE_AI_LOGIC_ONLY_IN_CLOUD`, not the simulation |
