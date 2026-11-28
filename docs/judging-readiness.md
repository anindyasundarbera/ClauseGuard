# Keeping the hosted site safe and working through judging

Judging runs **10 to 16 Dec 2026**, and the rules say the project must stay free and testable until then. These are the
console steps for project `clauseguard-hybrid-1c5e2`. Do them in order. Each one says how to check that the site still
works afterwards.

**The quick check** (use it after every step): open https://clauseguard-hybrid-1c5e2.web.app/#walk in a fresh Chrome
window, follow the walk, choose the deeper check, approve and run it. The result card should name the cloud model
(not "Practice mode"), and the side panel should say **1 request to cloud AI**.

## 1. Restrict the browser API key to our sites (low risk)

Google Cloud console → APIs & Services → Credentials → the **Browser key (auto created by Firebase)** that the web app
uses (its value matches `VITE_FIREBASE_API_KEY` in `.env.local`).

- Application restrictions → **Websites**. Add:
  - `https://clauseguard-hybrid-1c5e2.web.app/*`
  - `https://clauseguard-hybrid-1c5e2.firebaseapp.com/*`
  - `https://clauseguard-hybrid-1c5e2--*.web.app/*` (preview channels)
  - `http://localhost:4173/*` (local runs and the evidence scripts)
- API restrictions: leave **Don't restrict key** for now. Restricting the API list is easy to get wrong (Firebase AI
  Logic, App Check, Installations, Remote Config and reCAPTCHA all use this key), and the website list already stops
  other sites from using it.
- Save, wait about 5 minutes, then run the quick check.

## 2. Check App Check traffic before enforcing (no change yet)

Firebase console → App Check → APIs → **Firebase AI Logic**. Look at the request metrics for the last few days.

- If almost all requests are **Verified**, go to step 3.
- If many are **Unverified** or **Invalid**, stop and tell Claude. Enforcing now would break the deeper check for
  judges.

## 3. Enforce App Check for Firebase AI Logic (needs your OK, hard to notice if it breaks)

Same page → **Enforce**. From then on, only requests with a valid App Check token reach Gemini. It can take up to
15 minutes to apply.

- Run the quick check right after, and again 15 minutes later.
- If the deeper check fails, press **Unenforce** on the same page. Nothing else changes.
- Note: preview channels fail App Check (the reCAPTCHA key only lists the live domains), so test enforcement on the
  live site, not on a preview link.

## 4. Watch the free-tier quota

The app uses the Gemini Developer API on the free tier, so there is no bill to run up. The risk is running out of
daily quota while judges test.

- Firebase console → AI Logic → **Settings**: check the per-user rate limit. The default is fine; lower it only if
  you see heavy traffic.
- Firebase console → AI Logic → **Monitoring**: look once a day from 10 to 16 Dec for errors or a quota warning.
- If billing is ever turned on for this project, add a small budget alert first (Billing → Budgets & alerts).

## 5. Freeze the live site after submitting

The rules require the app to work "as depicted in the video". After 30 Nov, deploy to the live site only to fix a
break, test on a preview channel first, and keep the walk, the four steps and the "Left this device" note looking
the way the video shows them.
