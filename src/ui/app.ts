import { DEFAULT_PUBLIC_FIREBASE_WEB_CONFIG } from "../core/firebase/firebaseClient.ts";
import { ClauseGuardSessionController } from "../core/sessionController.ts";
import type {
  ContractRole,
  DetectedEntity,
  FirebaseRuntimeConfig,
  PrivacyMode,
  SupportedFirebaseCloudModel,
} from "../core/types.ts";
import { buildSamples } from "./samples.ts";
import {
  detectionNote,
  groupForReview,
  reviewCounts,
  reviewHeading,
  cleanFindingTitle,
  describeCloud,
  describeDeviceAi,
  describePrivacyMode,
  findingSourceLabel,
  friendlyError,
  furthestStep,
  idsToHide,
  ledgerCounts,
  NUMBER_CATEGORIES,
  reviewAnnouncement,
  reviewContinueBlocker,
  roleLabel,
  severityLabel,
  plainWarnings,
  splitPlaceholders,
  STEP_TITLES,
  type StepNumber,
} from "./viewModel.ts";

const controller = new ClauseGuardSessionController();
(window as unknown as { __clauseguardController?: ClauseGuardSessionController }).__clauseguardController =
  controller;

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const STEPS: StepNumber[] = [1, 2, 3, 4];
const ROLES: ContractRole[] = [
  "CLIENT", "VENDOR", "BUYER", "TARGET", "DISCLOSING_PARTY",
  "RECEIVING_PARTY", "ADVISOR", "BANK", "SIGNATORY", "PARTY",
];

let currentStep: StepNumber = 1;
let busyText: string | null = null;
let errorText: string | null = null;
let noticeText: string | null = null;
/** True while a quiet Review change runs: blocks double taps without the "Updating…" banner. */
let quietBusy = false;
/** "More options" rows the user has opened, so a re-render keeps them open. */
const openMoreRows = new Set<string>();
/** Statuses before the last Review change, for "Undo last change" (one level). */
let undoSnapshot: Map<string, DetectedEntity["reviewStatus"]> | null = null;

const isBusy = (): boolean => busyText !== null || quietBusy;

/** aria-disabled keeps a button focusable and in the Tab order, so it can explain itself. */
function setAriaDisabled(btn: HTMLElement, off: boolean): void {
  btn.setAttribute("aria-disabled", String(off));
}

function isShown(node: Element | null): node is HTMLElement {
  return node instanceof HTMLElement && node.isConnected && node.getClientRects().length > 0;
}

/** Where focus goes if the control the user was on disappears after a re-render. */
const FOCUS_FALLBACK: Record<string, string> = {
  "btn-accept-all": "btn-review-continue",
  "btn-review-undo": "btn-review-more",
};

function focusKey(node: Element | null): string | null {
  if (!(node instanceof HTMLElement) || node === document.body) return null;
  if (node.id) return `id:${node.id}`;
  if (node.dataset.testid) return `testid:${node.dataset.testid}`;
  return null;
}

function findByKey(key: string): HTMLElement | null {
  const [kind, value] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  if (kind === "id") return document.getElementById(value);
  return document.querySelector<HTMLElement>(`[data-testid="${CSS.escape(value)}"]`);
}

/**
 * Re-rendering rebuilds the Review list, which would drop keyboard focus to <body> and send
 * keyboard and screen reader users back to the top. Put focus back on the same control.
 */
function restoreFocus(key: string | null): void {
  if (!key) return;
  if (isShown(document.activeElement) && document.activeElement !== document.body) return;
  let target = findByKey(key);
  if (!isShown(target)) {
    const fallback = FOCUS_FALLBACK[key.slice(key.indexOf(":") + 1)];
    target = fallback ? document.getElementById(fallback) : null;
  }
  if (isShown(target)) target.focus({ preventScroll: true });
}

/** Speak one outcome through the polite region. Cleared first so a repeat is spoken again. */
function announce(text: string): void {
  const box = el("review-announcer");
  box.textContent = "";
  window.setTimeout(() => { box.textContent = text; }, 50);
}

function snapshotStatuses(): void {
  undoSnapshot = new Map(controller.entities.map((e) => [e.id, e.reviewStatus]));
}

/**
 * A Review change that keeps the user's place: no busy banner, no spoken "Updating…", focus and
 * scroll stay put, and the outcome is announced once.
 */
async function reviewChange(outcome: string, fn: () => Promise<void>): Promise<void> {
  if (isBusy()) return;
  resetConsent();
  snapshotStatuses();
  quietBusy = true;
  errorText = null;
  noticeText = null;
  let ok = true;
  try {
    await fn();
  } catch (err) {
    ok = false;
    errorText = friendlyError(err);
  } finally {
    quietBusy = false;
    renderAll();
  }
  if (ok) announce(reviewAnnouncement(outcome, reviewCounts(controller.entities).pending));
}

function resetConsent(): void {
  el<HTMLInputElement>("chk-explicit-consent").checked = false;
}

function goTo(step: StepNumber, focus = true): void {
  if (step !== currentStep) noticeText = null;
  currentStep = step;
  renderAll();
  if (focus) el(`h-${step}`).focus({ preventScroll: false });
}

/** Run an async action with a visible loading state and a plain-language error state. */
async function run(label: string, fn: () => Promise<void>): Promise<boolean> {
  busyText = label;
  errorText = null;
  noticeText = null;
  renderAll();
  try {
    await fn();
    return true;
  } catch (err) {
    errorText = friendlyError(err);
    return false;
  } finally {
    busyText = null;
    renderAll();
  }
}

function setBanner(id: string, text: string | null): void {
  const box = el(id);
  box.hidden = !text;
  box.textContent = text ?? "";
}

function renderStatusBar(): void {
  const ai = describeDeviceAi(controller.readinessState, controller.getObservedFirebaseTelemetry().downloadProgressPct);
  el("device-ai-dot").className = `dot dot-${ai.tone}`;
  el("device-ai-headline").textContent = ai.headline;
  el("device-ai-help").textContent = ai.help;
  el("btn-init-nano").hidden = !ai.canSetUp;
  const cloud = describeCloud(controller.getObservedFirebaseTelemetry());
  el("cloud-dot").className = `dot dot-${cloud.tone}`;
  el("cloud-headline").textContent = cloud.headline;
}

function renderStepper(maxStep: StepNumber): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>(".step")) {
    const n = Number(btn.dataset.step) as StepNumber;
    btn.disabled = n > maxStep || busyText !== null;
    btn.classList.toggle("is-done", n < currentStep && n <= maxStep);
    if (n === currentStep) btn.setAttribute("aria-current", "step");
    else btn.removeAttribute("aria-current");
    btn.setAttribute("aria-label", `Step ${n}: ${STEP_TITLES[n]}${n < currentStep ? " (done)" : n === currentStep ? " (current)" : ""}`);
  }
  for (const n of STEPS) el(`panel-${n}`).hidden = n !== currentStep;
  // The Review page has a sticky action bar: keep focused rows from hiding behind it.
  document.documentElement.classList.toggle("has-actionbar", currentStep === 2);
}

function renderUnderTheHood(): void {
  el("nano-readiness-badge").textContent = controller.readinessState;
  el("nano-readiness-detail").textContent = controller.readinessDetail;
  // One "on this device" choice in the UI; the safe-fallback variant is an internal detail.
  el<HTMLSelectElement>("privacy-mode-select").value =
    controller.privacyMode === "HYBRID_ANONYMIZED" ? "HYBRID_ANONYMIZED" : "LOCAL_ONLY";
  el<HTMLSelectElement>("cloud-model-select").value = controller.selectedCloudModel;
  const t = controller.getObservedFirebaseTelemetry();
  el("firebase-project-badge").textContent = controller.firebaseConfig?.projectId ?? "UNCONFIGURED (local simulation)";
  el("firebase-sdk-badge").textContent = t.sdkVersion;
  el("appcheck-status-badge").textContent = t.appCheckStatus;
  el("cloud-model-badge").textContent = t.activeCloudModel;
  el("observed-source-badge").textContent = t.lastCloudInferenceSource ?? t.lastLocalInferenceSource ?? "NONE";
  el("nano-download-progress").textContent = t.downloadProgressPct !== null ? `Progress: ${t.downloadProgressPct}%` : "";
  el("approval-state").textContent = controller.approvalMachine.getSnapshot().state;
  el("payload-sha").textContent = controller.redaction?.sanitizedSha256 ?? "NONE";
  el("privacy-report-pre").textContent = JSON.stringify(controller.getPrivacyReport16(), null, 2);
}

function renderBanners(): void {
  el("busy-banner").hidden = busyText === null;
  el("busy-text").textContent = busyText ?? "";
  setBanner("error-box", errorText);
  setBanner("notice-box", noticeText);
  const warn = el("warnings-box");
  warn.replaceChildren();
  const shown = plainWarnings(controller.warnings);
  warn.hidden = shown.length === 0;
  for (const w of shown) {
    const d = document.createElement("div");
    d.textContent = w;
    warn.appendChild(d);
  }
}

function renderSamples(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>(".sample")) {
    b.disabled = busyText !== null;
  }
}

function entityRow(group: DetectedEntity[]): HTMLElement {
  const ent = group[0];
  const ids = group.map((g) => g.id);
  const card = document.createElement("div");
  const pending = group.some((g) => g.reviewStatus === "PENDING_REVIEW" || g.reviewStatus === "NEEDS_DECISION");
  card.className = `entity-card${pending ? " is-pending" : ""}`;
  card.setAttribute("data-entity-id", ent.id);

  const main = document.createElement("div");
  main.className = "entity-main";
  const surface = document.createElement("div");
  surface.className = "entity-surface";
  surface.textContent = ent.surface;
  const meta = document.createElement("div");
  meta.className = "entity-meta";
  meta.id = `meta-${ent.id}`;
  const parts = [detectionNote(group)];
  if (group.length > 1) parts.push(`appears ${group.length} times`);
  const how = parts.join(" · ");
  meta.textContent = pending
    ? `Needs your decision · ${how}`
    : ent.reviewStatus === "ACCEPTED"
      ? `Will be hidden · ${how}`
      : `Will stay visible · ${how}`;
  main.append(surface, meta);

  const seg = document.createElement("div");
  seg.className = "seg";
  seg.setAttribute("role", "group");
  seg.setAttribute("aria-label", `Decision for ${ent.surface}`);
  const mk = (label: string, status: "ACCEPTED" | "REJECTED", testPrefix: string): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.setAttribute("aria-pressed", String(!pending && group.every((g) => g.reviewStatus === status)));
    b.setAttribute("data-testid", `${testPrefix}-${ent.id}`);
    b.setAttribute("aria-describedby", `meta-${ent.id}`);
    b.onclick = () =>
      reviewChange(status === "ACCEPTED" ? `${ent.surface} hidden` : `${ent.surface} kept visible`, () =>
        controller.toggleEntityStatus(ids, status)
      );
    return b;
  };
  seg.append(mk("Hide", "ACCEPTED", "accept"), mk("Keep visible", "REJECTED", "reject"));

  const more = document.createElement("details");
  more.className = "entity-more";
  more.open = openMoreRows.has(ent.id);
  more.addEventListener("toggle", () => {
    if (more.open) openMoreRows.add(ent.id);
    else openMoreRows.delete(ent.id);
  });
  const sum = document.createElement("summary");
  sum.textContent = "More options";
  sum.setAttribute("data-testid", `more-${ent.id}`);
  const field = document.createElement("div");
  field.className = "field";
  const lab = document.createElement("label");
  const selId = `role-${ent.id}`;
  lab.htmlFor = selId;
  lab.textContent = "Role in the document";
  const sel = document.createElement("select");
  sel.id = selId;
  for (const r of ROLES) {
    const o = document.createElement("option");
    o.value = r;
    o.textContent = roleLabel(r);
    o.selected = ent.role === r || (ent.role === "SUBPROCESSOR" && r === "PARTY");
    sel.appendChild(o);
  }
  sel.onchange = () =>
    reviewChange(`Role set to ${roleLabel(sel.value)}`, () =>
      controller.updateCanonicalGroupRole(ent.canonicalKey, sel.value as ContractRole)
    );
  field.append(lab, sel);
  more.append(sum, field);

  card.append(main, seg, more);
  return card;
}

function renderReview(): void {
  const ents = controller.entities;
  const counts = ledgerCounts(ents);
  el("review-empty").hidden = !(controller.document && ents.length === 0);

  const chips = el("review-summary");
  chips.replaceChildren();
  const chip = (text: string, cls: string): void => {
    const c = document.createElement("span");
    c.className = `chip ${cls}`;
    c.textContent = text;
    chips.appendChild(c);
  };
  const rc = reviewCounts(ents);
  if (controller.document && controller.documentProfile.kind !== "GENERAL") {
    chip(`Looks like a ${controller.documentProfile.label}`, "chip-kind");
  }
  if (ents.length > 0) {
    chip(`${rc.found} found`, "");
    if (rc.pending > 0) chip(`${rc.pending} need your decision`, "chip-warn");
    if (rc.hidden > 0) chip(`${rc.hidden} hidden`, "chip-ok");
    if (rc.visible > 0) chip(`${rc.visible} kept visible`, "chip-err");
  }

  const list = el("airlock-list");
  list.replaceChildren();
  for (const [cat, rows] of groupForReview(ents)) {
    const section = document.createElement("section");
    const h = document.createElement("h3");
    h.className = "group-title";
    h.textContent = reviewHeading(cat, 2, controller.documentProfile.headings) + ` (${rows.length})`;
    h.setAttribute("data-category", cat);
    section.appendChild(h);
    for (const row of rows) section.appendChild(entityRow(row));
    list.appendChild(section);
  }

  const hasDoc = Boolean(controller.document);
  const acceptAll = el<HTMLButtonElement>("btn-accept-all");
  const cont = el<HTMLButtonElement>("btn-review-continue");
  acceptAll.hidden = counts.pendingTotal === 0;
  setAriaDisabled(acceptAll, isBusy());
  // The count is always shown so the effect is clear before pressing.
  acceptAll.replaceChildren(
    document.createTextNode(`Hide all ${rc.pending}`),
    Object.assign(document.createElement("span"), {
      className: "visually-hidden",
      textContent: ` item${rc.pending === 1 ? "" : "s"} that need a choice`,
    })
  );
  // Continue is never a dead control: with items undecided it explains and offers a safe way on.
  setAriaDisabled(cont, !hasDoc || isBusy());

  const bulkCount = (kind: string | undefined): number =>
    kind === "names"
      ? idsToHide(ents, new Set(["PERSON"])).length
      : kind === "numbers"
        ? idsToHide(ents, NUMBER_CATEGORIES).length
        : idsToHide(ents).length;
  for (const b of document.querySelectorAll<HTMLButtonElement>("#review-more-menu [data-bulk]")) {
    const n = bulkCount(b.dataset.bulk);
    b.hidden = n === 0;
    const base = b.dataset.bulk === "names" ? "Hide all names" : b.dataset.bulk === "numbers" ? "Hide all numbers and IDs" : "Hide everything on the list";
    b.textContent = `${base} (${n})`;
  }
  el("btn-review-undo").hidden = undoSnapshot === null;
}

/** Renders sanitized text with placeholders highlighted. Uses text nodes only (never innerHTML). */
function renderPayload(text: string): void {
  const pre = el("sanitized-preview");
  pre.replaceChildren();
  for (const seg of splitPlaceholders(text)) {
    if (seg.placeholder) {
      const m = document.createElement("mark");
      m.textContent = seg.text;
      pre.appendChild(m);
    } else {
      pre.appendChild(document.createTextNode(seg.text));
    }
  }
}

function renderApprove(): void {
  const snap = controller.approvalMachine.getSnapshot();
  const counts = ledgerCounts(controller.entities);
  const hasDoc = Boolean(controller.redaction);
  const approved = snap.state === "HUMAN_APPROVED_FOR_CLOUD";
  const hybrid = controller.privacyMode === "HYBRID_ANONYMIZED";
  const consent = el<HTMLInputElement>("chk-explicit-consent").checked;

  renderPayload(controller.redaction?.sanitizedText ?? "Import a document to see the exact text here.");
  el("count-hidden").textContent = String(counts.hiddenTotal);

  const ul = el("ledger-local-list");
  ul.replaceChildren();
  for (const row of counts.hiddenByCategory) {
    const li = document.createElement("li");
    li.textContent = row.label;
    ul.appendChild(li);
  }
  if (counts.hiddenByCategory.length === 0) {
    const li = document.createElement("li");
    li.textContent = hasDoc ? "No items are being hidden." : "Nothing yet.";
    li.style.listStyle = "none";
    ul.appendChild(li);
  }
  const vis = el("ledger-visible-note");
  vis.hidden = counts.visibleTotal === 0;
  vis.textContent = `${counts.visibleTotal} item${counts.visibleTotal === 1 ? "" : "s"} you chose to keep visible will be included in the text.`;
  const rawLen = controller.document?.normalizedText.length ?? 0;
  const outLen = controller.redaction?.sanitizedText.length ?? 0;
  el("ledger-original-note").textContent = hasDoc
    ? `Your original document (${rawLen.toLocaleString()} characters) and the mapping back to real values stay in this tab’s memory.`
    : "Your original document stays in this tab’s memory.";
  el("payload-size-note").textContent = hasDoc ? `${outLen.toLocaleString()} characters · ${controller.redaction?.entries.length ?? 0} placeholders` : "";

  const status = el("ledger-status");
  status.classList.toggle("is-sent", false);
  if (controller.findings.length > 0 && controller.lastCloudSdkSource === "in_cloud") {
    status.textContent = "Only the cleaned text above was sent, once, after your approval.";
    status.classList.add("is-sent");
  } else if (approved && hybrid) {
    status.textContent = "You approved this exact text. Nothing has been sent yet.";
  } else if (hybrid) {
    status.textContent = "Nothing has been sent. Approve below to allow it.";
  } else {
    status.textContent = `Nothing has been sent. ${describePrivacyMode(controller.privacyMode)}.`;
  }

  const unresolved = counts.pendingTotal;
  const approveBtn = el<HTMLButtonElement>("btn-approve-payload");
  const analyzeBtn = el<HTMLButtonElement>("btn-analyze-cloud");
  const idle = busyText === null;
  setAriaDisabled(approveBtn, !idle || !hasDoc || !consent || unresolved > 0);
  approveBtn.hidden = approved && hybrid;
  analyzeBtn.disabled = !idle || !hasDoc || !hybrid || !approved;
  analyzeBtn.hidden = !(approved && hybrid);
  el<HTMLButtonElement>("btn-local-triage").disabled = !idle || !controller.document;

  let hint = "";
  if (snap.state === "STALE_APPROVAL_INVALIDATED") hint = "You changed something after approving, so approval was reset. Check the text and approve again.";
  else if (unresolved > 0) hint = `${unresolved} item${unresolved === 1 ? " still needs" : "s still need"} a decision in Review.`;
  else if (approved && !hybrid) hint = "Approved, but the deeper check is set to stay on this device. Choose “Send the cleaned text” above to run it.";
  else if (!consent && !approved) hint = "Tick the box to enable approval.";
  el("approve-hint").textContent = hint;
}

/** Why Approve can't run yet, or null. Shown next to the button when it is pressed. */
function approveBlocker(): string | null {
  const counts = ledgerCounts(controller.entities);
  if (busyText !== null) return "Please wait. Something is still running.";
  if (!controller.redaction) return "Import a document first.";
  if (counts.pendingTotal > 0) {
    const n = counts.pendingTotal;
    return `${n} item${n === 1 ? " still needs" : "s still need"} a choice in step 2. Go back to review to choose.`;
  }
  if (!el<HTMLInputElement>("chk-explicit-consent").checked) return "Tick the box to agree before approving.";
  return null;
}

function renderResults(): void {
  const list = el("findings-list");
  list.replaceChildren();
  el("findings-empty").hidden = controller.findings.length > 0;
  const srcBox = el("results-source");
  srcBox.hidden = true;

  for (const f of controller.findings) {
    const src = findingSourceLabel(f);
    const card = document.createElement("article");
    card.className = `finding sev-${f.severity}`;

    const head = document.createElement("div");
    head.className = "finding-head";
    const sev = document.createElement("span");
    sev.className = `chip ${f.severity === "HIGH" ? "chip-err" : f.severity === "MEDIUM" ? "chip-warn" : "chip-ok"}`;
    sev.textContent = severityLabel(f.severity);
    const title = document.createElement("h3");
    title.className = "finding-title";
    title.textContent = cleanFindingTitle(f.title);
    head.append(sev, title);

    const quote = document.createElement("blockquote");
    quote.className = "finding-quote";
    quote.textContent = f.rehydratedExcerpt || f.anonymizedExcerpt;

    const why = document.createElement("p");
    why.className = "finding-why";
    why.textContent = f.rationale;

    const sourceP = document.createElement("p");
    sourceP.className = "muted small";
    sourceP.textContent = `${src.label}${f.clauseRefs.length ? ` · ${f.clauseRefs.join(", ")}` : ""}`;

    const det = document.createElement("details");
    const sum = document.createElement("summary");
    sum.textContent = "What the check saw (cleaned version)";
    const anon = document.createElement("p");
    anon.textContent = f.anonymizedExcerpt;
    const tech = document.createElement("p");
    tech.textContent = `Source: ${f.analysisSource}${f.observedInferenceSource ? ` | sdk:${f.observedInferenceSource}` : ""}${f.unmappedTokens.length ? ` | Unmapped tokens: ${f.unmappedTokens.join(", ")}` : ""}`;
    det.append(sum, anon, tech);

    card.append(head, quote, why, sourceP, det);
    list.appendChild(card);
  }
}

function renderAll(): void {
  const focus = focusKey(document.activeElement);
  const maxStep = furthestStep(Boolean(controller.document), controller.findings.length > 0);
  if (currentStep > maxStep) currentStep = maxStep;
  renderStatusBar();
  renderBanners();
  renderStepper(maxStep);
  renderSamples();
  renderReview();
  renderApprove();
  renderResults();
  renderUnderTheHood();
  const init = el<HTMLButtonElement>("btn-init-nano");
  init.disabled = busyText !== null;
  restoreFocus(focus);
}

async function importDocument(
  input: Parameters<ClauseGuardSessionController["ingestFileOrText"]>[0]
): Promise<void> {
  resetConsent();
  undoSnapshot = null;
  openMoreRows.clear();
  const ok = await run("Reading your document on this device…", () => controller.ingestFileOrText(input));
  if (ok) goTo(2);
}

async function initUi(): Promise<void> {
  const fbJsonBox = el<HTMLTextAreaElement>("firebase-config-json");
  if (!fbJsonBox.value.trim()) {
    // Show the env-loaded config if there is one, otherwise the empty template to fill in.
    const shown = { ...DEFAULT_PUBLIC_FIREBASE_WEB_CONFIG, ...(controller.firebaseConfig ?? {}) };
    delete (shown as { debugAppCheckToken?: unknown }).debugAppCheckToken;
    fbJsonBox.value = JSON.stringify(shown, null, 2);
  }
  el<HTMLInputElement>("chk-debug-appcheck").checked = Boolean(controller.firebaseConfig?.debugAppCheckToken);

  // Samples
  const grid = el("sample-buttons");
  for (const smp of buildSamples()) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sample";
    b.setAttribute("data-testid", smp.id);
    const tag = document.createElement("span");
    tag.className = "sample-tag";
    tag.textContent = smp.audience === "everyone" ? "Everyday" : "Professional";
    const t = document.createElement("span");
    t.className = "sample-title";
    t.textContent = smp.title;
    const d = document.createElement("span");
    d.className = "sample-blurb";
    d.textContent = smp.blurb;
    b.append(tag, t, d);
    b.onclick = () => importDocument({ fileName: smp.fileName, mimeType: "text/plain", text: smp.text });
    grid.appendChild(b);
  }

  // Stepper + generic "go" buttons
  for (const btn of document.querySelectorAll<HTMLButtonElement>(".step")) {
    btn.addEventListener("click", () => goTo(Number(btn.dataset.step) as StepNumber));
  }
  for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-go]")) {
    btn.addEventListener("click", () => goTo(Number(btn.dataset.go) as StepNumber));
  }

  // File picker + drag/drop
  const handleFile = async (file: File): Promise<void> => {
    const buf = new Uint8Array(await file.arrayBuffer());
    await importDocument({
      fileName: file.name,
      mimeType: file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "text/plain"),
      bytes: buf,
    });
  };
  el<HTMLInputElement>("file-input").addEventListener("change", async (ev) => {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    await handleFile(file);
    input.value = "";
  });
  const dz = el("dropzone");
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("is-over"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("is-over"));
  dz.addEventListener("drop", async (e) => {
    e.preventDefault();
    dz.classList.remove("is-over");
    const file = e.dataTransfer?.files?.[0];
    if (file) await handleFile(file);
  });

  // Device AI setup
  el("btn-init-nano").addEventListener("click", async () => {
    await run("Setting up private AI on this device…", async () => {
      await controller.initializeOnDeviceModel(() => renderAll());
    });
  });

  // Review
  el("btn-accept-all").addEventListener("click", () =>
    reviewChange("All undecided items hidden", () => controller.acceptAllPendingEntities())
  );

  const continueDialog = el<HTMLDialogElement>("continue-dialog");
  el("btn-review-continue").addEventListener("click", () => {
    if (isBusy() || !controller.document) return;
    const blocker = reviewContinueBlocker(reviewCounts(controller.entities).pending);
    if (!blocker) {
      goTo(3);
      return;
    }
    // Nothing is skipped silently: undecided items are either hidden here or chosen by hand.
    el("continue-dialog-desc").textContent = blocker;
    continueDialog.showModal();
    el("btn-dialog-hide-continue").focus();
  });
  el("btn-dialog-back").addEventListener("click", () => continueDialog.close());
  continueDialog.addEventListener("close", () => {
    if (currentStep === 2) el("btn-review-continue").focus({ preventScroll: true });
  });
  el("btn-dialog-hide-continue").addEventListener("click", async () => {
    continueDialog.close();
    resetConsent();
    snapshotStatuses();
    const ok = await run("Hiding the rest…", () => controller.acceptAllPendingEntities());
    if (ok) goTo(3);
  });

  // "More actions" menu in the Review bar
  const moreBtn = el<HTMLButtonElement>("btn-review-more");
  const moreMenu = el("review-more-menu");
  const setMenu = (open: boolean, returnFocus = false): void => {
    moreMenu.hidden = !open;
    moreBtn.setAttribute("aria-expanded", String(open));
    if (open) moreMenu.querySelector<HTMLButtonElement>(".menu-item:not([hidden])")?.focus();
    else if (returnFocus) moreBtn.focus();
  };
  moreBtn.addEventListener("click", () => setMenu(moreMenu.hidden));
  moreMenu.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      setMenu(false, true);
    }
  });
  moreBtn.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !moreMenu.hidden) setMenu(false);
  });
  document.addEventListener("click", (ev) => {
    if (!moreMenu.hidden && !(ev.target as Element).closest(".menu-wrap")) setMenu(false);
  });
  for (const b of moreMenu.querySelectorAll<HTMLButtonElement>("[data-bulk]")) {
    b.addEventListener("click", async () => {
      const kind = b.dataset.bulk;
      const ids =
        kind === "names"
          ? idsToHide(controller.entities, new Set(["PERSON"]))
          : kind === "numbers"
            ? idsToHide(controller.entities, NUMBER_CATEGORIES)
            : idsToHide(controller.entities);
      setMenu(false, true);
      if (ids.length === 0) return;
      const what = kind === "names" ? "All names" : kind === "numbers" ? "All numbers and IDs" : "Everything on the list";
      await reviewChange(`${what} hidden`, () => controller.toggleEntityStatus(ids, "ACCEPTED"));
    });
  }
  el("btn-review-undo").addEventListener("click", async () => {
    const snap = undoSnapshot;
    setMenu(false, true);
    if (!snap || isBusy()) return;
    await reviewChange("Last change undone", async () => {
      for (const ent of controller.entities) {
        const prev = snap.get(ent.id);
        if (prev) ent.reviewStatus = prev;
      }
      // An empty toggle still invalidates any approval and rebuilds the cleaned text.
      await controller.toggleEntityStatus([], "ACCEPTED");
    });
    undoSnapshot = null;
    renderAll();
  });
  el("btn-review-add").addEventListener("click", () => {
    setMenu(false);
    const input = el<HTMLInputElement>("manual-surface");
    input.scrollIntoView({ block: "center" });
    input.focus({ preventScroll: true });
  });
  el<HTMLFormElement>("manual-entity-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const surf = el<HTMLInputElement>("manual-surface").value.trim();
    if (!surf) {
      errorText = "Type the word or phrase you want hidden first.";
      renderAll();
      el("manual-surface").focus();
      return;
    }
    const cat = el<HTMLSelectElement>("manual-category").value as DetectedEntity["category"];
    resetConsent();
    let added = 0;
    const ok = await run("Hiding it everywhere…", async () => {
      added = await controller.addManualEntity(surf, cat, "PARTY");
    });
    if (ok) {
      if (added === 0) {
        errorText = `We couldn't find “${surf}” in the document. Check the spelling and capitalization.`;
      } else {
        noticeText = `Hidden in ${added} place${added === 1 ? "" : "s"}.`;
        el<HTMLInputElement>("manual-surface").value = "";
      }
      renderAll();
    }
  });

  // Approve
  el<HTMLSelectElement>("privacy-mode-select").addEventListener("change", (ev) => {
    const picked = (ev.target as HTMLSelectElement).value as PrivacyMode;
    controller.privacyMode =
      picked === "LOCAL_ONLY" && controller.readinessState === "DEGRADED_DETERMINISTIC_SAFE"
        ? "DEGRADED_DETERMINISTIC_SAFE"
        : picked;
    renderAll();
  });
  el<HTMLSelectElement>("cloud-model-select").addEventListener("change", (ev) => {
    controller.selectedCloudModel = (ev.target as HTMLSelectElement).value as SupportedFirebaseCloudModel;
    renderAll();
  });
  el<HTMLInputElement>("chk-explicit-consent").addEventListener("change", () => renderAll());

  el("btn-approve-payload").addEventListener("click", async () => {
    const blocker = approveBlocker();
    if (blocker) {
      el("approve-hint").textContent = blocker;
      if (blocker.startsWith("Tick")) el("chk-explicit-consent").focus();
      return;
    }
    await run("Locking in your approval…", async () => {
      await controller.approveCurrentPayload();
    });
  });
  el("btn-analyze-cloud").addEventListener("click", async () => {
    const ok = await run("Running the deeper check on the approved text…", async () => {
      await controller.runApprovedCloudAnalysis({
        allowSimulatedCloud: el<HTMLInputElement>("chk-sim-cloud").checked,
        modelId: controller.selectedCloudModel,
      });
    });
    if (ok) goTo(4);
  });
  el("btn-local-triage").addEventListener("click", async () => {
    if (!controller.document) return;
    const doc = controller.document;
    const ok = await run("Checking on this device…", async () => {
      await controller.runOfflineLocalClauseTriage(doc.normalizedText.slice(0, 1200));
    });
    if (ok) goTo(4);
  });

  // Results
  el("btn-export-report").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(controller.getPrivacyReport16(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clauseguard_privacy_report_${controller.sessionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
  el("btn-new-document").addEventListener("click", () => goTo(1));

  // Under the hood: Firebase config
  el("btn-apply-firebase").addEventListener("click", () => {
    try {
      const rawJson = el<HTMLTextAreaElement>("firebase-config-json").value.trim();
      if (!rawJson) {
        controller.setFirebaseConfig(null);
        controller.warnings.push("Cleared custom Firebase config from RAM.");
        renderAll();
        return;
      }
      const parsed = JSON.parse(rawJson) as Partial<FirebaseRuntimeConfig>;
      const siteKey = el<HTMLInputElement>("recaptcha-site-key").value.trim();
      const debugChecked = el<HTMLInputElement>("chk-debug-appcheck").checked;
      if (typeof sessionStorage !== "undefined" && (location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
        sessionStorage.setItem("CG_LOCALHOST_APPCHECK_DEBUG", debugChecked ? "true" : "false");
      }
      controller.setFirebaseConfig({
        ...parsed,
        recaptchaEnterpriseSiteKey: siteKey || parsed.recaptchaEnterpriseSiteKey,
        debugAppCheckToken: debugChecked ? true : parsed.debugAppCheckToken,
        cloudModelId: controller.selectedCloudModel,
      });
      controller.warnings.push(`Loaded Firebase Web Config for project '${parsed.projectId ?? "unknown"}' in ephemeral browser RAM.`);
    } catch (err) {
      controller.warnings.push(`Invalid Firebase JSON config: ${String(err)}`);
    }
    renderAll();
  });
  el("btn-sync-remote-config").addEventListener("click", async () => {
    await run("Syncing Remote Config…", async () => {
      try {
        const snap = await controller.syncRemoteConfigSafely();
        controller.warnings.push(`Remote Config synced (${snap.source}): cloudModel=${snap.cloudModelName}, playbook=${snap.playbookId}. Safety invariants locked.`);
      } catch (err) {
        controller.warnings.push(`Remote Config sync failed safely: ${String(err)}`);
      }
    });
  });

  // Under the hood: vault
  el("btn-save-vault").addEventListener("click", async () => {
    const wsId = el<HTMLInputElement>("vault-workspace-id").value.trim() || "default";
    const pass = el<HTMLInputElement>("vault-passphrase").value;
    await run("Encrypting…", async () => {
      const cnt = await controller.commitApprovedToEncryptedWorkspace(wsId, pass);
      controller.warnings.push(`Encrypted ${cnt} human-approved canonical entities to IndexedDB workspace '${wsId}'.`);
    });
  });
  el("btn-unlock-vault").addEventListener("click", async () => {
    const wsId = el<HTMLInputElement>("vault-workspace-id").value.trim() || "default";
    const pass = el<HTMLInputElement>("vault-passphrase").value;
    await run("Unlocking…", async () => {
      const ok = await controller.unlockWorkspaceFromIdb(wsId, pass);
      controller.warnings.push(ok ? `Unlocked workspace '${wsId}'.` : `No vault found or wrong passphrase for '${wsId}'.`);
    });
  });

  // Clear everything
  el("btn-purge").addEventListener("click", async () => {
    resetConsent();
    el<HTMLTextAreaElement>("firebase-config-json").value = "";
    el<HTMLInputElement>("recaptcha-site-key").value = "";
    el<HTMLInputElement>("chk-debug-appcheck").checked = false;
    el<HTMLInputElement>("vault-passphrase").value = "";
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem("CG_LOCALHOST_APPCHECK_DEBUG");
    const ok = await run("Clearing everything…", () => controller.purgeAllSessionAndStorage());
    if (ok) {
      noticeText = "Cleared. Your document, results and saved data are gone from this device.";
      goTo(1, false);
    }
  });

  renderAll();
  await controller.refreshReadiness();
  renderAll();
}

void initUi();
