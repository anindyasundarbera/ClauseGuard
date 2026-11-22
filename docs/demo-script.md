# Demo video script (target 2:45, hard cap 3:00)

Only the first 3 minutes are judged, the video must be public on YouTube, in English (or subtitled), and show the app running in Chrome. Record the screen at 1080p, browser zoom 110-125% so text is legible.

## Before recording (checklist)

1. Chrome desktop with Gemma 4 installed and `READY_ON_DEVICE` showing (see README section 7). Do a dry run first: `LanguageModel.availability()` should say `available`.
2. Run the app on a URL that can reach the **real** Firebase project, otherwise the cloud step is only practice mode and you must say so on screen. Either the hosted URL ([docs/deploy.md](deploy.md)) or `npm run dev` on `http://localhost:4173` with the App Check debug token registered ([docs/firebase-setup.md](firebase-setup.md) step 3a). Do one full run beforehand and confirm the Results card shows `sdk:in_cloud`. If it does not, record in practice mode and say "practice mode, no packets".
3. Open DevTools (F12) docked at the bottom, **Network** tab, "Preserve log" on, filter cleared. Keep the tab visible in the recording.
4. Use only the built-in made-up samples. No real documents, no real tokens visible. Close other tabs and notifications. Do not open `.env.local`.
5. Have the Network tab's throttling dropdown ready (set to "Offline" for the airplane-mode beat), or really turn on airplane mode / Wi-Fi off (the tab must already be loaded, since a page cannot load offline).
6. Fresh state: click **Clear everything** (top right) before you start.

## Timed script

| Time | On screen / exact action | Say (voice-over) |
|---|---|---|
| **0:00-0:15** Hook | Title card or the app at Step 1. | "Everyone is told to paste their lease, medical bill or contract into an AI chatbot. That sends names, IBANs and amounts off your device before you have decided that is okay. ClauseGuard is a privacy airlock built on Firebase AI Logic hybrid inference." |
| **0:15-0:30** On-device ready | Point at the status bar: "Private AI on this device: ready". Open the **Under the hood** panel and show `ONLY_ON_DEVICE` and runtime state `READY_ON_DEVICE`, then collapse it. | "Chrome's on-device Gemma is ready. Raw text only ever goes to the model in ONLY_ON_DEVICE mode: if it isn't there, we fail closed, we never fall back to the cloud." |
| **0:30-0:50** Zero egress (import) | Switch to DevTools **Network**, clear it. Back at **Step 1 Import**, click the **tenant lease** sample. Wait for Step 2. Keep Network visible and empty. | "I import a made-up lease. Watch the network panel: parsing and the on-device model run in the tab. Zero requests." Let the empty Network list sit on screen for two seconds. |
| **0:50-1:15** Review | On **Step 2 Review**: hover or click two highlighted items (name, IBAN). Reject one, then click **Hide all suggested items**; optionally type a word in "Word or phrase", press **Hide it everywhere**. Click **Continue to approval**. | "Every sensitive item is a suggestion. I accept or reject each one, or add my own. Deterministic detectors and the on-device model both feed this list. The human decides." |
| **1:15-1:40** Exact payload | **Step 3 Approve**: scroll the right column "Would be sent, exactly as shown" so placeholders are visible; left column shows the count of hidden items. Network still empty. Tick the consent box. Point at **Approve this exact text** and the status line "Nothing has been sent." | "This is exactly what could leave the device: placeholders instead of names, IBANs and emails. Nothing has been sent. Approval is bound to the SHA-256 of this exact text; if I change a single character it is invalidated." |
| **1:40-1:55** Stale approval (optional, drop if over time) | Click **Approve this exact text**. Click **Back to review**, un-hide one item, return to Step 3. Show the invalidated/needs-approval state, re-approve. | "Edit anything after approval and the approval goes stale, the cloud call is blocked." |
| **1:55-2:15** Cloud call | Click **Run the deeper check**. In Network show exactly one request to `firebasevertexai.googleapis.com` or `generativelanguage.googleapis.com` (whatever your build shows), click it, show the request payload: placeholders only, header `X-Firebase-AppCheck` present. | "Only now does a request leave: Firebase AI Logic in ONLY_IN_CLOUD mode, with an App Check token. The body contains placeholders, not the real names." |
| **2:15-2:30** Results and rehydration | **Step 4 Results**: show risk cards with real names restored. Point at the small source line `sdk:in_cloud` on a card. | "The answer comes back with placeholders and is rehydrated here in the browser. The app also checks the SDK's inferenceSource: if it isn't in_cloud, it refuses." |
| **2:30-2:50** Airplane mode | Click **Check another document**. Turn on airplane mode (or DevTools throttling = **Offline**) and show the offline indicator. Import the **medical bill** sample, reach Step 3, click **Check on this device only**. Show results appearing. Network panel empty/failed-free. | "Now airplane mode. The medical bill is analysed entirely on-device with Gemma through the same AI Logic SDK. Same flow, no connection, zero requests." |
| **2:50-3:00** Close | Show the repo or the title card with the repo URL. | "ClauseGuard: hybrid AI where the user, not the app, decides what leaves. Open source under Apache-2.0." |

## Rules for what you say on camera

- Say "practice mode" if the cloud step was simulated. Do not claim a live cloud call you did not show.
- Do not claim Gemma "found everything". The honest line: "Deterministic detectors plus the on-device model propose, you decide."
- No usage numbers, no user counts. We have none.
- Do not show the Firebase console, API keys or tokens.

## After recording

1. Upload to YouTube as **Public** (not Unlisted), title with the project name, English captions (`demo/clauseguard_demo_captions.srt` is an older caption draft for a previous UI; do not reuse it as is).
2. Check the first 3 minutes contain the offline and zero-egress beats; anything after 3:00 is not judged.
3. Paste the URL into Devpost and into the README (`TODO` line at the top).
