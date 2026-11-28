# Hosting ClauseGuard Hybrid

ClauseGuard is a static single-page app (Vite build in `dist/`). No server code runs. Both options below publish the same `dist/` folder. **Nothing in this repo deploys anything; you run the steps.**

| | **Firebase Hosting (primary, recommended)** | **Render static site (mirror)** |
|---|---|---|
| Cost | Free Spark tier is enough (10 GB storage, 360 MB/day transfer) | Free static tier (100 GB/month bandwidth) |
| Project | Same Firebase project as AI Logic, App Check, Remote Config (`clauseguard-hybrid-1c5e2`) | Separate account/service |
| Domain | `clauseguard-hybrid-1c5e2.web.app` and `.firebaseapp.com`, HTTPS automatic | `<name>.onrender.com`, HTTPS automatic |
| Build | You build locally, then upload `dist/` | Render builds from GitHub on each push (`render.yaml`) |
| Public config | Read from your local `.env.local` at build time | Set as build-time env vars in the dashboard |
| App Check | Domains already listed in `docs/firebase-setup.md` step 3 | **Must add the `onrender.com` domain** (Render step 4) |
| Config file | `firebase.json` (SPA rewrite + security headers) | `render.yaml` (same rewrite + headers) |

Why Firebase first: one console, one set of allowed domains, no GitHub connection or build minutes, and the App Check/reCAPTCHA key is already set up for it. Use Render only as a fallback/mirror (for example if you want a second URL for judges).

Public build-time variables (all are public identifiers that ship in the JS bundle; none is a secret): `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`, optional `VITE_FIREBASE_CLOUD_MODEL`, `VITE_FIREBASE_USE_LIMITED_USE_APPCHECK`. **All six `VITE_FIREBASE_*` web-config values plus `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` are required on a host.** There are no built-in defaults any more (commit `a7704a8` removed them so no project key is committed). If the API key, project ID or app ID is empty, the build runs local-only: App Check shows `LOCAL_ONLY_NO_CLOUD` and no cloud call is made (the other three values are still needed for the Firebase SDK to work correctly). If the Firebase values are set but the site key is missing, App Check shows `NOT_CONFIGURED` and cloud calls are refused. Both are safe failures, but neither is the full demo. Copy the six values from Firebase Console → Project settings → Your apps → web app → *SDK setup and configuration* (Config). **Never** set `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN` on a hosted build; it is localhost-only and ignored elsewhere.

---

## Option 1: Firebase Hosting (primary)

You do these steps (they need your Google login):

1. **Log in once**
   ```bash
   npx firebase-tools login
   ```
2. **Make sure `.env.local` has all seven required values** (git-ignored; Vite reads it automatically during the build; start from `cp .env.example .env.local`). Check without printing values:
   ```bash
   grep -cE '^VITE_(FIREBASE_(API_KEY|AUTH_DOMAIN|PROJECT_ID|STORAGE_BUCKET|MESSAGING_SENDER_ID|APP_ID)|RECAPTCHA_ENTERPRISE_SITE_KEY)=.' .env.local
   ```
   A `7` means all are set; anything lower means the hosted build will be local-only or refuse cloud calls. Do not set `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN` in the file you build for production (comment it out), because it would make a localhost-style token path part of the bundle.
3. **Build and check**
   ```bash
   npm ci && npm run typecheck && npm test && npm run build
   ```
4. **(Optional) Preview on a temporary URL first**
   ```bash
   npx firebase-tools hosting:channel:deploy preview --project clauseguard-hybrid-1c5e2
   ```
   Add the printed `*.web.app` preview domain to the reCAPTCHA key if you want to test cloud calls there.
5. **Deploy to the live site**
   ```bash
   npx firebase-tools deploy --only hosting --project clauseguard-hybrid-1c5e2
   ```
6. **Allow the hosted domains on the reCAPTCHA Enterprise key** (Google Cloud console → Security → reCAPTCHA Enterprise → Keys → your key → *Allowed domains*): `clauseguard-hybrid-1c5e2.web.app`, `clauseguard-hybrid-1c5e2.firebaseapp.com`, plus any custom domain. Same list as `docs/firebase-setup.md` step 3.2.
7. **App Check**: Firebase Console → App Check → Apps → web app: confirm the reCAPTCHA Enterprise provider is registered. Turn on enforcement for AI Logic only after a hosted test call works (`docs/firebase-setup.md` step 3b).
8. **Verify the hosted site**: open `https://clauseguard-hybrid-1c5e2.web.app`, expand "Under the hood": App Check should read `RECAPTCHA_ENTERPRISE_READY`, then `ATTESTATION_VERIFIED` after the first approved cloud call. Check headers with:
   ```bash
   curl -sI https://clauseguard-hybrid-1c5e2.web.app | grep -iE 'x-content-type|referrer|x-frame|permissions'
   ```

`firebase.json` already contains the `dist` public folder, the SPA rewrite to `/index.html` and the four security headers. The `remoteconfig` block is separate (`docs/firebase-setup.md` step 4).

---

## Option 2: Render static site (mirror)

1. **Push the repo to GitHub** (Render deploys from a Git remote; the repo must contain `render.yaml`, which it does).
2. **Render Dashboard → New → Blueprint** (or *New → Static Site*), connect your GitHub account, and pick this repository/branch. Render reads `render.yaml`:
   - build: `npm ci && npm run build`
   - publish directory: `dist`
   - rewrite `/*` → `/index.html`, plus the same four security headers
   - Node 22 via `NODE_VERSION`
3. **Set the env vars in the dashboard** (Service → Environment). `render.yaml` only *names* them (`sync: false`), so Render prompts for each value and nothing secret is stored in Git. Fill all six `VITE_FIREBASE_*` values (Firebase Console → Project settings → Your apps) and `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` with the public site key. There are no built-in defaults: an empty Firebase value makes the mirror local-only. Do **not** add a debug token. Build-time vars only take effect on the next build, so use *Manual Deploy → Clear build cache & deploy* after changing them.
4. **Allow the Render domain** on the reCAPTCHA Enterprise key (Allowed domains → add `<your-service>.onrender.com` and any custom domain). In Firebase Console → Authentication → Settings → Authorized domains, adding it is harmless but not required because the app does not use Firebase Auth.
5. **Verify**: open the Render URL, run the same "Under the hood" check as above. Without step 4 above the status will show an attestation failure and cloud calls are refused (the app fails closed; local analysis still works).

Free Render static sites do not sleep, but each Git push to the tracked branch triggers a rebuild, so pin the branch you want to publish.

---

## What this repo does and does not guarantee

- Hosting only serves static files. Raw document text is never sent to the host: parsing, redaction and on-device analysis run in the browser (`AGENTS.md` rules 1 and 2).
- The hosted site cannot use the on-device model unless the visitor's Chrome has it (see `evidence/wo062-live-on-device-proof.json` for what was and was not proven on the build machine). Without it the app uses the deterministic fallback and shows that in the UI.
- Not set up here (optional hardening): a strict `Content-Security-Policy` header. It needs a careful allow-list for Firebase endpoints, the pdf.js worker and WASM, so test it on a preview channel before enabling.
