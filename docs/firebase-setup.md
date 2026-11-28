# Firebase setup (manual console steps)

Project: `clauseguard-hybrid-1c5e2`. Everything below is done by you in the Firebase / Google Cloud console; the repo never holds secrets or debug tokens. After each section run `node scripts/verify_firebase.mjs` (offline, prints no values).

## 1. Enable Firebase AI Logic
1. Console → **Build → AI Logic** → *Get started*.
2. Choose the **Gemini Developer API** backend (the app uses `GoogleAIBackend`). Accept the prompts to enable the required APIs and create the Gemini API key (it stays server-side; never in the client).
3. Allowed cloud models (enforced client-side): `gemini-3.5-flash-lite`, `gemini-3.8-flash`, `gemini-4-hydrogen`.

## 2. Register the web app config
Project settings → *Your apps* → the Web app → copy the config into `.env.local` (git-ignored) (all six `VITE_FIREBASE_*` values are required; there are no built-in defaults, and without them the app runs local-only). These identifiers are public, not secrets.

## 3. App Check (reCAPTCHA Enterprise)
1. Console → **Build → App Check → Apps** → select the web app → **reCAPTCHA Enterprise** → create/choose a key.
2. Google Cloud console → *Security → reCAPTCHA Enterprise → Keys* → open that key → **Allowed domains**: add `localhost` (dev), `clauseguard-hybrid-1c5e2.web.app`, `clauseguard-hybrid-1c5e2.firebaseapp.com` and any custom domain.
3. Put the site key in `.env.local` as `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` (and in the build environment used for the hosted build; it is a public identifier).

### 3a. Debug token for localhost
1. Set `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN=true` in `.env.local`, run `npm run dev`, open the app on `http://localhost:4173`.
2. A debug token UUID is printed once in the browser console. Console → App Check → Apps → web app → ⋮ → **Manage debug tokens** → add it.
3. Optionally pin it: put the UUID in `.env.local` only. Never commit it. The app ignores debug tokens on any non-localhost origin.

### 3b. Enforcement
App Check → **APIs** → enable **Enforce** for *Firebase AI Logic* (and Remote Config). Do this only after step 3a works, otherwise your own localhost calls get rejected. Optionally enable replay protection and set `VITE_FIREBASE_USE_LIMITED_USE_APPCHECK=true`.

## 4. Remote Config
`remoteconfig.template.json` holds the only three remotely tunable keys: `cloud_model_name`, `playbook_id`, `max_cloud_output_tokens`.
- Publish: `npx firebase-tools deploy --only remoteconfig --project clauseguard-hybrid-1c5e2` (needs your `firebase login`), or paste the three parameters in Console → Remote Config → Publish.
- Do NOT add keys such as `local_inference_mode`, `require_human_airlock_approval`, `enable_zero_canary_preflight`, `enforce_app_check`. The client rejects any value that weakens them (`ERR_REMOTE_CONFIG_INVARIANT_VIOLATION`).

## 5. Hosting
```bash
npm run build
npx firebase-tools deploy --only hosting --project clauseguard-hybrid-1c5e2
```
Then add the resulting domains to the reCAPTCHA key (step 3.2) and confirm the hosted app shows App Check status `RECAPTCHA_ENTERPRISE_READY`, then `ATTESTATION_VERIFIED` after the first approved cloud call.

## App Check status meanings (as shown in the UI)
| Status | Meaning |
|---|---|
| `LOCAL_ONLY_NO_CLOUD` | No live Firebase config; nothing leaves the device |
| `*_PROVIDER_READY` / `RECAPTCHA_ENTERPRISE_READY` | Configured; activated lazily right before the first approved cloud call (never at boot) |
| `NOT_CONFIGURED` | Live config but no site key / localhost debug token; cloud calls are refused |
| `ATTESTATION_VERIFIED` | A token was actually obtained for the last cloud call |
| `ATTESTATION_FAILED` | Token exchange failed; cloud call blocked |

## Not implemented (by design)
Anonymous Auth and a Firestore usage counter were deliberately left out: they add a data store and a new egress path to a privacy airlock for no functional gain. No `firestore.rules` is shipped; do not enable Firestore for this project.
