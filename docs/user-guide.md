# ClauseGuard user guide

ClauseGuard helps you check a lease, a medical bill or a contract for risky clauses **without handing your private details to a cloud AI**. It reads the document inside your browser, hides names, account numbers and amounts, shows you the exact cleaned text, and only sends that cleaned text for a deeper AI check if you approve it.

**Open it here:** https://clauseguard-hybrid-1c5e2.web.app

No account or sign-in is needed. Use Chrome on a desktop or laptop.

The same guide is built into the app: press **User guide** at the top of the page (it opens in a new tab, so your current document is not lost), or go to https://clauseguard-hybrid-1c5e2.web.app/guide.html. The in-app page is `guide.html` at the repo root; keep it in step with this file.

---

## The short version

1. **Import** a document or pick a sample.
2. **Review** the sensitive details it found. Add anything it missed.
3. **Approve** the exact cleaned text, or keep everything on your device.
4. **Read the results**, with your real names and numbers put back on your device.

## Step by step

### 1. Import

- Drop a file on the page or press **Choose a document**. PDF, Word (.docx), .txt and .md are supported.
- Or pick a sample under **Or try a sample**. All samples are made up:
  - **Apartment lease**: deposit, early exit, entry and auto-renewal clauses.
  - **Hospital bill**: a duplicate charge, a surprise fee and a collections deadline.
  - **Business services agreement**: a liability cap that a later clause quietly cancels.
  - **Data processing addendum**: look-alike company names and roles that switch sides.
  - **Tricky NDA (hidden text test)**: hidden characters and instructions aimed at the AI. Safe to try.

The file is read in your browser tab. Nothing is uploaded when you import it.

### 2. Review

ClauseGuard lists the names, contact details, account numbers and amounts it found. For each one, choose whether to hide it.

- **Hide all suggested items** accepts the whole list in one click.
- Automatic detection is good at numbers and emails but **can miss people's names**. Read the list, and if something is missing, type it under **Hide something we missed**, pick what it is (person, company, address and so on) and press **Hide it everywhere**. It is hidden in every place it appears.
- Press **Continue to approval** when you are happy.

Hidden items are swapped for labelled placeholders in square brackets, so the AI still knows "this is the tenant" or "this is an amount" without seeing the real value.

### 3. Approve

This page shows **What leaves your device**: the full cleaned text, exactly as it would be sent. Read it. Then choose one of two paths.

- **Check on this device only.** Nothing is sent anywhere. You get a lighter local check.
- **Send the cleaned text for a deeper check.** Choose this option, tick the box confirming you read the text, and press **Approve this exact text**, then **Run the deeper check**.

Your approval is tied to that exact text. If anything changes after you approve (for example, you go back and un-hide an item), the approval is cancelled and nothing is sent until you approve again. A last automatic scan also blocks the send if any hidden value is still in the text.

### 4. Results

You get a list of things worth asking about, such as a clause that cancels another, a surprise fee or a short deadline. Placeholders are swapped back to your real names and numbers **on your device**, so the results read naturally.

- **Download privacy report** saves a small JSON file describing what was hidden, what was sent and where the check ran. It contains counts and fingerprints (hashes), not your document text.
- **Check another document** starts over.
- **Clear everything** (top of the page) removes your document, results and any saved data from this device.

## What stays on your device and what goes to the cloud

| Stays in your browser | Can go to the cloud, only after you approve |
|---|---|
| Your original file | The cleaned text you saw under "What leaves your device" |
| The real names, numbers and amounts | Labelled placeholders in square brackets instead of those values |
| The list linking placeholders to real values | Nothing else |
| The on-device AI check, if your Chrome supports it | |
| Putting real values back into the results | |

The deeper check uses Google's Gemini model through Firebase AI Logic. The request is protected by Firebase App Check. If you never approve, nothing is sent.

## The status bar at the top

- **Private AI on this device** shows whether Chrome's built-in model (Gemma) is ready. If it says it can be set up, press **Set up private AI** to download it. This is a large download (about 2.3 GB) and only works on recent Chrome with the built-in AI features turned on. **You do not need it.** Without it, ClauseGuard uses built-in rules to find sensitive details, and nothing is sent to the cloud instead.
- **Deeper check** says either "cloud connected and protected" (a real Gemini check is available) or "practice mode". Practice mode runs a clearly labelled simulation on your device and sends nothing.

The **Under the hood** section at the bottom is for developers and judges. It shows which model answered (on-device or in the cloud), the approval fingerprint, and a 16-field privacy report.

## Limits

- **Not legal, medical or financial advice.** ClauseGuard points out things worth asking about. It can miss things.
- **Detection is not perfect.** On our own made-up test set it found about 87% of sensitive items. Anything it misses and you do not add yourself will be sent if you approve. That is why the review step exists. Read the cleaned text before you approve it.
- **Indirect references can survive.** A phrase like "the landlord's CEO" is not a name, so it is not hidden.
- **Digital documents only.** Scanned PDFs (images of text) are not read. Files are limited to 25 MB and PDFs to 50 pages.
- **On-device AI depends on your machine.** It has been tested on one Linux laptop with Chrome 156 and 158. On other machines Chrome may report it unavailable; ClauseGuard then keeps working with its built-in rules.
- **Built for Chrome on desktop.** Other browsers and phones are untested.
- **Use the samples if you are unsure.** They show the full flow without any of your own data.

## Optional: the encrypted vault

Under the hood there is an optional vault that saves the list of hidden items (not the document) in your browser, encrypted with a passphrase you choose. It is meant for teams that review the same parties repeatedly. It has not had an external security review, so treat it as experimental.

## More detail

- How it works and how each privacy claim is proven: [README](../README.md)
- A recorded real cloud run: [live-cloud-run.md](live-cloud-run.md)
- Running it yourself: [firebase-setup.md](firebase-setup.md) and [deploy.md](deploy.md)
