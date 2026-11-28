# ClauseGuard user guide

ClauseGuard helps you check a lease, a medical bill or a contract for risky clauses **without handing your private details to a cloud AI**. It reads the document inside your browser, hides names, account numbers and amounts, shows you the exact cleaned text, and only sends that cleaned text for a deeper AI check if you approve it.

**Open it here:** https://clauseguard-hybrid-1c5e2.web.app

No account or sign-in is needed. Use Chrome on a desktop or laptop.

The same guide is built into the app: press **Guide** in the top bar (it opens in a new tab, so your current document is not lost), or go to https://clauseguard-hybrid-1c5e2.web.app/guide.html. The in-app page is `guide.html` at the repo root; keep it in step with this file.

---

## The short version

1. **Import** a document or pick a sample.
2. **Review** the sensitive details it found. Add anything it missed.
3. **Approve** the exact cleaned text, or keep everything on your device.
4. **Read the results**, with your real names and numbers put back on your device.

## The top bar and the bottom bar

The top bar is one row. It shows the four steps (**Import**, **Review**, **Approve**, **Results**), two status chips, **Guide**, and the **⋯** menu. You can go back to a step you have finished. The step you are on is marked.

- **Status chips.** **On-device AI** and **Cloud** show a short status in words. Click a chip to read the full sentence.
- **⋯ menu.** Pick a theme (**System**, **Light** or **Dark**), open **Advanced settings**, or press **Clear everything**. Clear everything asks you to confirm first.
- **On a phone.** The top bar shows "Step N of 4", the step name and a progress bar. One status chip opens a sheet with both status lines. The **⋯** menu has the same items.

The bottom bar is on every step and stays on screen while you scroll. **Back** is on the left. The main button is on the right.

| Step | Bottom bar |
|---|---|
| Import | **Continue** (it says **Choose a file first** until you pick a file) |
| Review | **Back**, **Hide all** (it shows how many), **⋯** and **Continue** |
| Approve | **Back**, **Check on this device only** and **Approve this exact text** |
| Results | **Back**, **Download privacy report** and **Check another document** |

## Step by step

### 1. Import

- Drop a file on the page or press **Choose a file**. PDF, Word (.docx), .txt and .md are supported.
- Limits: PDFs up to 50 pages, Word or text files, and files up to 25 MB. **Scanned PDFs (photos of pages) cannot be read yet.**
- Or pick a sample under **Or try a sample**. All samples are made up:
  - **Apartment lease**: deposit, early exit, entry and auto-renewal clauses.
  - **Hospital bill**: a duplicate charge, a surprise fee and a collections deadline.
  - **Business services agreement**: a liability cap that a later clause quietly cancels.
  - **Data processing addendum**: look-alike company names and roles that switch sides.
  - **Tricky NDA (hidden text test)**: hidden characters and instructions aimed at the AI. Safe to try.

The file is read in your browser tab. Nothing is uploaded when you import it.

If the on-device AI needs a one-time download, a banner under the title offers **Download private AI** or **Not now**. You can start now without it. Built-in rules still find numbers and emails, but may miss names. While the AI downloads, you can keep working. ClauseGuard switches to it when it is ready. You do not need to wait.

### 2. Review

ClauseGuard lists the names, contact details, account numbers and amounts it found. For each one, choose whether to hide it.

ClauseGuard first works out what kind of document it is (a contract, a medical report, a bill or a bank statement) and says so at the top of the list, for example "Looks like a medical report". You can change the type with **Change** if it guessed wrong. The headings follow from that, such as "Patients, doctors and relatives" or "Patient and record numbers". Values printed next to a form label, such as "Patient Name :", "UHID :", "DOB :" or "Mobile No :", are found and hidden automatically, and the row tells you which label it was next to.

Each row says how many times the item appears, for example "appears 4 times". The item is listed once. For a contract, each row also shows a role tag, such as **Client**, **Vendor** or **Signatory**. To change a role, open the row's **⋯** menu and pick one.

On a wide screen, a summary panel sits on the right. It shows how many items were found and how many still need a choice. Above the list, a short box lists any very small or invisible text and any words with look-alike letters, so you can decide.

- The bottom bar stays on screen while you scroll. **Hide all** (it shows how many) hides every item still waiting for a choice. The **⋯** button next to it has more one-click actions: hide all names, hide all numbers and IDs, hide everything on the list, undo your last change, and add something we missed.
- Automatic detection is good at numbers and emails but **can miss people's names**. Read the list, and if something is missing, type it under **Hide something we missed**, pick what it is (person, company, address and so on) and press **Hide it everywhere**. It is hidden in every place it appears.
- If the on-device AI is not ready, the summary says "Found with built-in rules. Names may be missed." It offers a **Download** button for private AI.
- Press **Continue** when you are happy. If some items still need a choice, ClauseGuard asks you to hide them or go back and choose. Nothing undecided is ever sent.

Hidden items are swapped for labelled placeholders in square brackets, so the AI still knows "this is the tenant" or "this is an amount" without seeing the real value.

### 3. Approve

This page shows **What leaves your device**: the full cleaned text, exactly as it would be sent. Read it. Then choose one of two paths. Each path is a card.

- **Check on this device only.** Nothing is sent anywhere. You get a lighter local check.
- **Send the cleaned text for a deeper check.** Choose this option, tick the box confirming you read the text, press **Approve this exact text**, then **Run the deeper check**.
- **No cloud set up?** The second card is a **Practice run**. It is a labelled stand-in that runs on this device. Nothing is sent.

Next to the box you see an **Approval ID**, such as 7F3A-91C2. It identifies the exact text you approved. Any change resets this approval, so you must approve again.

Your approval is tied to that exact text. If anything changes after you approve (for example, you go back and un-hide an item), the approval is cancelled and nothing is sent until you approve again. A last automatic scan also blocks the send if any hidden value is still in the text.

### 4. Results

You get a list of things worth asking about, such as a clause that cancels another, a surprise fee or a short deadline. Placeholders are swapped back to your real names and numbers **on your device**, so the results read naturally.

Each finding says where it was checked: **Checked in the cloud**, **Checked on this device** or **Practice run**.

- **Download privacy report** saves a small JSON file describing what was hidden, what was sent and where the check ran. It contains counts and fingerprints (hashes), not your document text.
- **Check another document** starts over.
- **Clear everything** is in the **⋯** menu at the top. It removes your document, results and any saved data from this device.

## What stays on your device and what goes to the cloud

| Stays in your browser | Can go to the cloud, only after you approve |
|---|---|
| Your original file | The cleaned text you saw under "What leaves your device" |
| The real names, numbers and amounts | Labelled placeholders in square brackets instead of those values |
| The list linking placeholders to real values | Nothing else |
| The on-device AI check, if your Chrome supports it | |
| Putting real values back into the results | |

The deeper check uses Google's Gemini model through Firebase AI Logic. The request is protected by Firebase App Check. If you never approve, nothing is sent.

## The status chips

- **On-device AI** shows whether Chrome's built-in model (Gemma) is ready. It can say "checking", "download needed", "downloading" with a percentage, "ready", or "off, using built-in rules". If a download is needed, press **Download** to start it. This is a large download (about 2.3 GB) and only works on recent Chrome with the built-in AI features turned on. **You do not need it.** Without it, ClauseGuard finds sensitive details with built-in rules, and nothing is sent to the cloud instead.
- **Cloud** says either "protected" (a real Gemini check is available) or "not set up, so it runs on this device". In that case the deeper check is a clearly labelled practice run on your device and nothing is sent.

The **Advanced settings** page is opened from the **⋯** menu. It is for developers and testers. It shows which model answered (on-device or in the cloud), the approval fingerprint, and a 16-field privacy report.

## Limits

- **Not legal, medical or financial advice.** ClauseGuard points out things worth asking about. It can miss things.
- **Detection is not perfect.** On our own made-up test set it found about 87% of sensitive items. Anything it misses and you do not add yourself will be sent if you approve. That is why the review step exists. Read the cleaned text before you approve it.
- **Indirect references can survive.** A phrase like "the landlord's CEO" is not a name, so it is not hidden.
- **Digital documents only.** Scanned PDFs (photos of pages) cannot be read yet. Files are limited to 25 MB and PDFs to 50 pages.
- **On-device AI depends on your machine.** It has been tested on one Linux laptop with Chrome 156 and 158. On other machines Chrome may report it unavailable; ClauseGuard then keeps working with its built-in rules.
- **Built for Chrome on desktop.** Other browsers and phones are untested.
- **Use the samples if you are unsure.** They show the full flow without any of your own data.

## Optional: the encrypted vault

In **Advanced settings** there is an optional vault that saves the list of hidden items (not the document) in your browser, encrypted with a passphrase you choose. It is meant for teams that review the same parties repeatedly. It has not had an external security review, so treat it as experimental.

## More detail

- How it works and how each privacy claim is proven: [README](../README.md)
- A recorded real cloud run: [live-cloud-run.md](live-cloud-run.md)
- Running it yourself: [firebase-setup.md](firebase-setup.md) and [deploy.md](deploy.md)
