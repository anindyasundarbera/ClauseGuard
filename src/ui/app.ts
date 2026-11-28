import "./fonts.css";
import { buildReadablePrivacyReport } from "./reportHtml.ts";
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
import { initThemeControls } from "./theme.ts";
import { clearTally, readTally, recordTally, tallyText } from "./tally.ts";
import {
  detectionNote,
  groupForReview,
  reviewCounts,
  reviewHeading,
  plainFinding,
  findingFootText,
  finishLede,
  manualAddFeedback,
  undecidedHiddenText,
  categoryLabel,
  describeCloud,
  isCloudVerificationError,
  describeDeviceAi,
  approvalId,
  downloadAnnouncement,
  fallbackReviewWarning,
  FILE_LIMITS_TEXT,
  occurrenceLabel,
  practiceRunCard,
  roleTag,
  friendlyError,
  furthestStep,
  idsToHide,
  ledgerCounts,
  NUMBER_CATEGORIES,
  reviewAnnouncement,
  reviewContinueBlocker,
  roleLabel,
  severityLabel,
  shieldProgress,
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
/** True when the error came from the cloud check, so it slides in from the right as outside news. */
let errorExt = false;
/** True while a quiet Review change runs: blocks double taps without the "Updating…" banner. */
let quietBusy = false;
/** "More options" rows the user has opened, so a re-render keeps them open. */
const openMoreRows = new Set<string>();
/** Statuses before the last Review change, for "Undo last change" (one level). */
let undoSnapshot: Map<string, DetectedEntity["reviewStatus"]> | null = null;

const isBusy = (): boolean => busyText !== null || quietBusy;

/**
 * A timer that pauses while the pointer is over the element or focus is inside it, so a message
 * never vanishes while someone is reading it or reaching for its button.
 */
class AutoHide {
  private timer: number | null = null;
  private left = 0;
  private startedAt = 0;
  private paused = false;
  private onExpire: (() => void) | null = null;
  constructor(node: HTMLElement) {
    const pause = (): void => {
      this.paused = true;
      if (this.timer !== null) {
        window.clearTimeout(this.timer);
        this.timer = null;
        this.left = Math.max(1000, this.left - (Date.now() - this.startedAt));
      }
    };
    const resume = (): void => {
      this.paused = false;
      if (this.onExpire && this.timer === null) this.arm();
    };
    node.addEventListener("mouseenter", pause);
    node.addEventListener("focusin", pause);
    node.addEventListener("mouseleave", () => { if (!node.contains(document.activeElement)) resume(); });
    node.addEventListener("focusout", () => { if (!node.matches(":hover")) resume(); });
  }
  private arm(): void {
    this.startedAt = Date.now();
    this.timer = window.setTimeout(() => {
      this.timer = null;
      const fn = this.onExpire;
      this.onExpire = null;
      fn?.();
    }, this.left);
  }
  start(ms: number, onExpire: () => void): void {
    this.cancel();
    this.left = ms;
    this.onExpire = onExpire;
    if (!this.paused) this.arm();
  }
  cancel(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.onExpire = null;
  }
}

/* ---------- Notice board ----------
   Every app reply lands here, newest last. App-made notices slide in from the left, outside news
   (private AI download, the cloud's reply) from the right. One board element moves into the
   current step's side panel; on phones it floats above the bottom bar and shows the latest only. */
interface NoticeOpts {
  text: string;
  source: string;
  /** Outside news (slides in from the right). */
  ext?: boolean;
  /** Same key = update that notice in place instead of adding another. */
  key?: string;
  tone?: "error" | "warn";
  sub?: string;
  subTestid?: string;
  /** "busy" is a sliding bar, a number is a percentage. */
  bar?: "busy" | number | null;
  /** A button inside the notice that goes away after `ms`. The notice stays. */
  action?: { label: string; ms: number; run: () => void };
  onClose?: () => void;
  /** Progress notices stay silent on update; their milestones are spoken elsewhere. */
  quiet?: boolean;
  testid?: string;
}
const NOTICE_MAX = 40;
const NOTICE_UNDO_MS = 8000;
const NOTICE_PHONE_MS = 10000;
const noticeHiders = new WeakMap<HTMLElement, AutoHide>();
const staleTimers = new WeakMap<HTMLElement, number>();
const noticeBoard = (): HTMLElement => el("toast-region");

function noticeTime(): string {
  try {
    return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function sourceForStep(): string {
  return ["Import", "Review", "Approve", "Results"][currentStep - 1] ?? "App";
}

function fillNotice(n: HTMLElement, o: NoticeOpts): void {
  const sig = JSON.stringify([o.text, o.source, o.ext, o.tone, o.sub, o.bar, o.action?.label, Boolean(o.onClose)]);
  if (n.dataset.sig === sig) return;
  n.dataset.sig = sig;
  n.classList.add("notice");
  n.classList.toggle("notice-ext", Boolean(o.ext));
  n.classList.toggle("notice-app", !o.ext);
  n.classList.toggle("notice-error", o.tone === "error");
  n.classList.toggle("notice-warn", o.tone === "warn");
  if (o.testid) n.setAttribute("data-testid", o.testid);
  if (o.quiet) n.setAttribute("aria-live", "off");
  else n.removeAttribute("aria-live");

  const head = document.createElement("div");
  head.className = "notice-head";
  const text = document.createElement("p");
  text.className = "notice-text";
  text.textContent = o.text;
  const src = document.createElement("span");
  src.className = "notice-src";
  src.textContent = o.source;
  head.append(text, src);
  const parts: HTMLElement[] = [head];

  if (o.sub) {
    const sub = document.createElement("p");
    sub.className = "notice-sub";
    sub.textContent = o.sub;
    if (o.subTestid) sub.setAttribute("data-testid", o.subTestid);
    parts.push(sub);
  }
  if (o.bar === "busy") {
    const bar = document.createElement("span");
    bar.className = "calm-bar";
    bar.setAttribute("aria-hidden", "true");
    bar.append(document.createElement("span"));
    parts.push(bar);
  } else if (typeof o.bar === "number") {
    const pr = document.createElement("progress");
    pr.className = "notice-progress";
    pr.max = 100;
    pr.value = o.bar;
    pr.setAttribute("aria-label", "Progress");
    parts.push(pr);
  }

  const foot = document.createElement("div");
  foot.className = "notice-foot";
  const time = document.createElement("time");
  time.className = "notice-time";
  time.textContent = noticeTime();
  foot.append(time);
  if (o.action) {
    const { label, ms, run: act } = o.action;
    // Only the newest Undo is real; older ones would put back stale choices.
    for (const old of noticeBoard().querySelectorAll(".notice-action")) old.remove();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-small notice-action";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      btn.remove();
      act();
    });
    foot.append(btn);
    let hider = noticeHiders.get(n);
    if (!hider) {
      hider = new AutoHide(n);
      noticeHiders.set(n, hider);
    }
    hider.start(ms, () => btn.remove());
  }
  if (o.onClose) {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "notice-close";
    close.setAttribute("aria-label", "Close this message");
    const x = document.createElement("span");
    x.setAttribute("aria-hidden", "true");
    x.textContent = "\u00d7";
    close.append(x);
    close.addEventListener("click", o.onClose);
    foot.append(close);
  }
  parts.push(foot);
  n.replaceChildren(...parts);

  // Phones show one floating note; it steps aside after a while unless it is an error.
  n.classList.remove("is-stale");
  const old = staleTimers.get(n);
  if (old) window.clearTimeout(old);
  staleTimers.set(n, window.setTimeout(() => n.classList.add("is-stale"), NOTICE_PHONE_MS));
}

function scrollBoardToNewest(): void {
  const b = noticeBoard();
  window.requestAnimationFrame(() => { b.scrollTop = b.scrollHeight; });
}

function postNotice(o: NoticeOpts): HTMLElement {
  const b = noticeBoard();
  let n = o.key ? b.querySelector<HTMLElement>(`[data-nkey="${o.key}"]`) : null;
  if (!n) {
    n = document.createElement("div");
    if (o.key) n.dataset.nkey = o.key;
    n.addEventListener("animationend", () => n!.classList.add("is-settled"));
    b.appendChild(n);
    const all = b.querySelectorAll(".notice:not([hidden])");
    if (all.length > NOTICE_MAX) all[0].remove();
  }
  fillNotice(n, o);
  scrollBoardToNewest();
  return n;
}

function removeNotice(key: string): void {
  noticeBoard().querySelector(`[data-nkey="${key}"]`)?.remove();
}

/** A new document is a new session: start the board fresh. */
function clearNotices(): void {
  for (const n of noticeBoard().querySelectorAll(".notice:not(#error-box)")) n.remove();
}

function stripUndo(): void {
  for (const b of noticeBoard().querySelectorAll(".notice-action")) b.remove();
}

/** The error notice is one fixed element (it keeps its id and test id) that moves to the newest spot. */
let shownError: string | null = null;
function syncErrorNotice(): void {
  if (errorText === shownError) return;
  shownError = errorText;
  const box = el("error-box");
  if (!errorText) {
    box.hidden = true;
    box.replaceChildren();
    delete box.dataset.sig;
    noticeBoard().prepend(box);
    return;
  }
  box.hidden = false;
  noticeBoard().appendChild(box);
  fillNotice(box, {
    text: errorText,
    source: errorExt ? "Cloud" : sourceForStep(),
    ext: errorExt,
    tone: "error",
    onClose: () => { errorText = null; syncErrorNotice(); },
  });
  box.classList.remove("is-stale");
  const t = staleTimers.get(box);
  if (t) window.clearTimeout(t);
  scrollBoardToNewest();
}

/** Put the board in the current step's side panel (desktop) so it always sits in the same place. */
function placeNoticeBoard(): void {
  const slot = document.getElementById(`panel-${currentStep}`)?.querySelector<HTMLElement>("[data-notice-slot]");
  const b = noticeBoard();
  if (slot && b.parentElement !== slot) {
    slot.appendChild(b);
    scrollBoardToNewest();
  }
}

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
async function reviewChange(outcome: string, fn: () => Promise<void>, opts: { notice?: boolean } = {}): Promise<void> {
  if (isBusy()) return;
  resetConsent();
  snapshotStatuses();
  const before = undoSnapshot;
  quietBusy = true;
  errorText = null;
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
  if (!ok) return;
  const said = reviewAnnouncement(outcome, reviewCounts(controller.entities).pending);
  if (opts.notice && before) {
    // The notice board is a polite live region, so it speaks this once; Undo lives inside it for a few seconds.
    postNotice({
      text: said,
      source: "Review",
      action: {
        label: "Undo",
        ms: NOTICE_UNDO_MS,
        run: () => {
          void reviewChange("Undone", () => restoreStatuses(before)).then(() => {
            if (currentStep === 2) el("btn-review-continue").focus({ preventScroll: true });
          });
        },
      },
    });
  } else {
    announce(said);
  }
}

/** Put every row back to the status it had in a snapshot. An empty toggle rebuilds the cleaned text. */
async function restoreStatuses(snap: Map<string, DetectedEntity["reviewStatus"]>): Promise<void> {
  for (const ent of controller.entities) {
    const prev = snap.get(ent.id);
    if (prev) ent.reviewStatus = prev;
  }
  await controller.toggleEntityStatus([], "ACCEPTED");
}

function resetConsent(): void {
  el<HTMLInputElement>("chk-explicit-consent").checked = false;
}

function goTo(step: StepNumber, focus = true): void {
  if (step === 4) stripUndo();
  currentStep = step;
  advancedOpen = false;
  renderAll();
  if (focus) el(`h-${step}`).focus({ preventScroll: false });
}

/** Run an async action with a visible loading state and a plain-language error state. */
/** Set when the cloud refused this app's App Check attestation; cleared by a later successful cloud check. */
let cloudRefused = false;

async function run(
  label: string,
  fn: () => Promise<void>,
  opts: { source?: string; done?: () => string | null } = {}
): Promise<boolean> {
  busyText = label;
  errorText = null;
  errorExt = false;
  postNotice({ key: "busy", text: label, source: opts.source ?? sourceForStep(), bar: "busy" });
  renderAll();
  try {
    await fn();
    const done = opts.done?.() ?? null;
    if (done) postNotice({ key: "busy", text: done, source: opts.source ?? sourceForStep(), bar: null });
    else removeNotice("busy");
    return true;
  } catch (err) {
    removeNotice("busy");
    errorText = friendlyError(err);
    return false;
  } finally {
    busyText = null;
    renderAll();
  }
}

function renderStatusBar(): void {
  const telemetry = controller.getObservedFirebaseTelemetry();
  const ai = describeDeviceAi(controller.readinessState, telemetry.downloadProgressPct);
  el("device-ai-dot").className = `dot dot-${ai.tone}`;
  el("device-ai-headline").textContent = ai.headline;
  el("device-ai-help").textContent = ai.help;
  el("btn-init-nano").hidden = !ai.canSetUp;
  el("device-ai-chip").textContent = ai.chip;
  const chipDl = el<HTMLButtonElement>("btn-chip-download");
  chipDl.hidden = !ai.canSetUp;
  chipDl.disabled = busyText !== null;
  const downloading = controller.readinessState === "DOWNLOADING";
  const pct = telemetry.downloadProgressPct;
  el("device-ai-chip-bar").hidden = !downloading;
  el("device-ai-chip-fill").style.width = `${pct ?? 0}%`;
  renderAiBanner(ai);
  announceDownload(pct);
  const cloud = describeCloud(telemetry, cloudRefused);
  el("cloud-dot").className = `dot dot-${cloud.tone}`;
  el("cloud-headline").textContent = cloud.headline;
  el("cloud-chip").textContent = cloud.chip;

  // One combined chip and its sheet (phones and narrow windows).
  el("status-dot").className = `dot dot-${ai.tone}`;
  el("status-chip-label").textContent = ai.phoneChip;
  el("status-sheet-device-dot").className = `dot dot-${ai.tone}`;
  el("status-sheet-device").textContent = `${ai.headline}.`;
  el("status-sheet-device-help").textContent = ai.help;
  el("status-sheet-cloud-dot").className = `dot dot-${cloud.tone}`;
  el("status-sheet-cloud").textContent = `${cloud.headline}.`;
  el("status-sheet-progress").textContent =
    telemetry.downloadProgressPct !== null ? `Download progress: ${telemetry.downloadProgressPct}%` : "";
  const sheetInit = el<HTMLButtonElement>("btn-init-nano-sheet");
  sheetInit.hidden = !ai.canSetUp;
  sheetInit.disabled = busyText !== null;
}

/** True while an imported file is being read. */
let readingFile = false;
let bannerDismissed = false;
try { bannerDismissed = sessionStorage.getItem("cg-ai-banner-hidden") === "1"; } catch { /* storage may be blocked */ }
let prevDownloadPct: number | null = null;

function renderAiBanner(ai: ReturnType<typeof describeDeviceAi>): void {
  const box = el("ai-banner");
  const b = ai.banner;
  box.hidden = !b || b.kind === "downloading" || bannerDismissed;
  if (!b) return;
  box.dataset.kind = b.kind;
  el("ai-banner-title").textContent = b.title;
  el("ai-banner-body").textContent = b.body;
  const bar = el<HTMLProgressElement>("ai-banner-progress");
  bar.hidden = b.kind !== "downloading";
  if (b.kind === "downloading") {
    bar.value = b.progressPct ?? 0;
    bar.setAttribute("aria-valuenow", String(b.progressPct ?? 0));
  }
  const dl = el<HTMLButtonElement>("btn-banner-download");
  dl.hidden = b.kind !== "download";
  dl.disabled = busyText !== null;
  el("btn-banner-hide").textContent = b.kind === "download" ? "Not now" : "Hide";
}

function announceDownload(pct: number | null): void {
  const state = controller.readinessState;
  const wasDownloading = prevDownloadPct !== null;
  const msg = downloadAnnouncement(prevDownloadPct, pct, state);
  if (state === "DOWNLOADING") prevDownloadPct = pct ?? prevDownloadPct;
  else if (state === "READY_ON_DEVICE" || state !== "CHECKING") prevDownloadPct = null;
  // Outside news: progress and the finish line arrive on the notice board from the right.
  if (state === "DOWNLOADING") {
    postNotice({
      key: "ai-download", ext: true, quiet: true, source: "Private AI",
      text: pct === null ? "Downloading private AI on this device." : `Downloading private AI. ${pct}% done.`,
      bar: pct ?? "busy",
    });
  } else if (state === "READY_ON_DEVICE" && wasDownloading) {
    postNotice({ key: "ai-download", ext: true, quiet: true, source: "Private AI", text: "Private AI is ready on this device. Download finished.", bar: null });
  }
  if (msg) announce(msg);
}

/** True while the Advanced settings view replaces the step panels. */
let advancedOpen = false;

function renderStepper(maxStep: StepNumber): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>(".step")) {
    const n = Number(btn.dataset.step) as StepNumber;
    btn.disabled = n > maxStep || busyText !== null;
    btn.classList.toggle("is-done", n < currentStep && n <= maxStep);
    if (n === currentStep) btn.setAttribute("aria-current", "step");
    else btn.removeAttribute("aria-current");
    btn.setAttribute("aria-label", `Step ${n}: ${STEP_TITLES[n]}${n < currentStep ? " (done)" : n === currentStep ? " (current)" : ""}`);
  }
  // "Step " hides on very narrow phones (CSS) so the step name never gets cut off.
  const compact = el("step-compact");
  const pre = document.createElement("span");
  pre.className = "step-compact-pre";
  pre.textContent = "Step ";
  compact.replaceChildren(pre, `${currentStep} of 4 · ${STEP_TITLES[currentStep]}`);
  for (const seg of document.querySelectorAll<HTMLElement>(".step-progress [data-seg]")) {
    seg.classList.toggle("is-on", Number(seg.dataset.seg) <= currentStep);
  }
  for (const n of STEPS) el(`panel-${n}`).hidden = advancedOpen || n !== currentStep;
  el("advanced-view").hidden = !advancedOpen;
  placeNoticeBoard();
  // Every step has the sticky action bar; Advanced settings has none.
  document.documentElement.classList.toggle("no-actionbar", advancedOpen);
  syncActionBarHeight();
}

/** Keep scroll padding and page padding equal to the real height of the visible action bar. */
function syncActionBarHeight(): void {
  const top = document.querySelector<HTMLElement>(".appbar")?.getBoundingClientRect().height ?? 0;
  if (top > 0) document.documentElement.style.setProperty("--appbar-live", `${Math.ceil(top)}px`);
  const bar = advancedOpen ? null : el(`panel-${currentStep}`).querySelector<HTMLElement>(".action-bar");
  const h = bar ? bar.getBoundingClientRect().height : 0;
  if (h > 0) document.documentElement.style.setProperty("--actionbar-h", `${Math.ceil(h)}px`);
}

function renderImport(): void {
  el("file-limits").textContent = FILE_LIMITS_TEXT;
  const hasDoc = Boolean(controller.document);
  const btn = el<HTMLButtonElement>("btn-import-continue");
  setAriaDisabled(btn, !hasDoc || busyText !== null);
  const hint = el("import-continue-hint");
  hint.textContent = hasDoc ? "" : "Choose a file first";
  hint.hidden = hasDoc;
  // The drop area never changes shape. Reading progress shows on the notice board.
  el("dropzone").setAttribute("aria-busy", String(busyText !== null && readingFile));
}

function renderUnderTheHood(): void {
  el("nano-readiness-badge").textContent = controller.readinessState;
  el("nano-readiness-detail").textContent = controller.readinessDetail;
  // One "on this device" choice in the UI; the safe-fallback variant is an internal detail.
  const mode = controller.privacyMode === "HYBRID_ANONYMIZED" ? "HYBRID_ANONYMIZED" : "LOCAL_ONLY";
  el<HTMLSelectElement>("privacy-mode-select").value = mode;
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="privacy-mode"]')) {
    r.checked = r.value === mode;
  }
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
  syncErrorNotice();
  const warn = el("warnings-box");
  warn.replaceChildren();
  let shown = plainWarnings(controller.warnings);
  // On Review the side panel already carries the built-in-rules warning, so do not say it twice.
  // After Review the warning ("double-check the list in Review") no longer helps, so drop it there too.
  if ((currentStep === 2 && fallbackReviewWarning(controller.readinessState)) || currentStep > 2) {
    shown = shown.filter((w) => !w.startsWith("Private AI wasn't available for this document"));
  }
  warn.hidden = shown.length === 0;
  for (const w of shown) {
    const d = document.createElement("div");
    d.className = "warn-line";
    const icon = document.createElement("span");
    icon.className = "warn-icon";
    icon.setAttribute("aria-hidden", "true");
    const body = document.createElement("span");
    if (w.startsWith("Private AI wasn't available")) {
      const lead = document.createElement("strong");
      lead.textContent = "Heads up.";
      body.append(lead, ` ${w}`);
    } else {
      body.textContent = w;
    }
    d.append(icon, body);
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
  const hiddenRow = !pending && group.every((g) => g.reviewStatus === "ACCEPTED");
  card.className = `entity-card ${pending ? "is-pending" : hiddenRow ? "is-hidden" : "is-shown"}`;
  card.setAttribute("data-entity-id", ent.id);
  card.setAttribute("data-entity-ids", ids.join(" "));

  const main = document.createElement("div");
  main.className = "entity-main";
  const surface = document.createElement("div");
  surface.className = "entity-surface";
  surface.textContent = ent.surface;
  const meta = document.createElement("div");
  meta.className = "entity-meta";
  meta.id = `meta-${ent.id}`;
  const parts = [detectionNote(group)];
  if (group.length > 1) parts.push(occurrenceLabel(group.length));
  const how = parts.join(" · ");
  // The row itself says what will happen: Hidden, Will be sent, or Needs your decision.
  const state = document.createElement("strong");
  state.className = "entity-state";
  state.textContent = pending ? "Needs your decision" : hiddenRow ? "Hidden" : "Will be sent";
  meta.append(state, ` \u00b7 ${how}`);
  const tagText = roleTag(ent.role);
  if (tagText) {
    const tag = document.createElement("span");
    tag.className = "chip chip-kind role-tag";
    tag.textContent = tagText;
    tag.setAttribute("data-testid", `role-tag-${ent.id}`);
    surface.append(" ", tag);
  }
  main.append(surface, meta);

  const seg = document.createElement("div");
  seg.className = "seg";
  seg.setAttribute("role", "group");
  seg.setAttribute("aria-label", `Decision for ${ent.surface}`);
  const mk = (label: string, status: "ACCEPTED" | "REJECTED", testPrefix: string): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    const pressed = !pending && group.every((g) => g.reviewStatus === status);
    b.textContent = label;
    b.setAttribute("aria-pressed", String(pressed));
    b.setAttribute("data-testid", `${testPrefix}-${ent.id}`);
    b.setAttribute("aria-describedby", `meta-${ent.id}`);
    b.onclick = () =>
      reviewChange(status === "ACCEPTED" ? `${ent.surface} hidden` : `${ent.surface} kept visible`, () =>
        controller.toggleEntityStatus(ids, status)
      );
    return b;
  };
  seg.append(mk("Hide", "ACCEPTED", "accept"), mk("Show", "REJECTED", "reject"));

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

/** The privacy shield in the app bar: fills from the bottom as Review items are decided. */
function renderShield(rc: ReturnType<typeof reviewCounts>): void {
  const meter = el("shield-meter");
  const show = currentStep === 2 && Boolean(controller.document) && !advancedOpen;
  meter.hidden = !show;
  if (!show) return;
  const sp = shieldProgress(rc.hidden + rc.visible, rc.found);
  meter.setAttribute("aria-label", sp.ariaLabel);
  meter.classList.toggle("is-complete", sp.complete);
  const top = 22 - (20 * sp.pct) / 100;
  const fill = el("shield-fill");
  fill.setAttribute("y", String(top));
  fill.setAttribute("height", String(22 - top));
  const [long, short] = Array.from(el("shield-text").children);
  long.textContent = sp.complete ? "\u2713 All decided" : sp.label;
  short.textContent = sp.complete ? "\u2713" : sp.shortLabel;
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
    if (rc.visible > 0) chip(`${rc.visible} kept visible`, "");
    if (rc.pending === 0) chip("All set, nothing left to choose.", "chip-ok");
  }
  renderShield(rc);

  const warnText = controller.document ? fallbackReviewWarning(controller.readinessState) : null;
  el("review-fallback-warn").hidden = !warnText;
  const fbText = el("review-fallback-text");
  if (warnText) {
    const lead = document.createElement("strong");
    lead.textContent = "Heads up.";
    fbText.replaceChildren(lead, ` ${warnText}`);
  } else {
    fbText.textContent = "";
  }
  const reviewDl = el<HTMLButtonElement>("btn-review-download");
  reviewDl.hidden = !warnText || !describeDeviceAi(controller.readinessState, null).canSetUp;
  reviewDl.disabled = busyText !== null;
  el("manual-entity-form").classList.toggle("is-highlight", Boolean(warnText));

  const list = el("airlock-list");
  list.replaceChildren();
  for (const [cat, rows] of groupForReview(ents)) {
    const section = document.createElement("section");
    const h = document.createElement("h2");
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
    const title = b.querySelector(".mi-title");
    if (title) title.textContent = `${base} (${n})`;
  }
  el("btn-review-undo").hidden = undoSnapshot === null;

  // Side panel buttons mirror the bar and the ⋯ pane, and press the real buttons when clicked.
  const sideAccept = document.querySelector<HTMLButtonElement>("[data-side-accept]")!;
  sideAccept.hidden = counts.pendingTotal === 0;
  sideAccept.textContent = `Hide all ${rc.pending} undecided`;
  setAriaDisabled(sideAccept, isBusy());
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-side-bulk]")) {
    const n = bulkCount(b.dataset.sideBulk);
    b.hidden = n === 0;
    setAriaDisabled(b, isBusy());
  }
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
    status.textContent = "You approved this exact text. Nothing is sent yet.";
  } else if (hybrid) {
    status.textContent = "Nothing is sent yet. Approve below if you want it sent.";
  } else {
    status.textContent = "Nothing has been sent. The check stays on this device.";
  }

  const unresolved = counts.pendingTotal;
  const approveBtn = el<HTMLButtonElement>("btn-approve-payload");
  const analyzeBtn = el<HTMLButtonElement>("btn-analyze-cloud");
  const idle = busyText === null;
  setAriaDisabled(approveBtn, !idle || !hasDoc || !consent || unresolved > 0);
  approveBtn.hidden = approved && hybrid;
  analyzeBtn.disabled = !idle || !hasDoc || !hybrid || !approved;
  analyzeBtn.hidden = !(approved && hybrid);
  const localBtn = el<HTMLButtonElement>("btn-local-triage");
  localBtn.disabled = !idle || !controller.document;
  for (const side of document.querySelectorAll<HTMLElement>('[data-proxy="btn-local-triage"]')) {
    setAriaDisabled(side, localBtn.disabled);
  }
  // The primary button follows the choice: on this device only, the local check is the main action.
  approveBtn.hidden = approveBtn.hidden || !hybrid;
  localBtn.classList.toggle("btn-primary", !hybrid);
  localBtn.classList.toggle("action-main", !hybrid);
  localBtn.classList.toggle("btn-outline", hybrid);
  localBtn.classList.toggle("action-secondary", hybrid);
  el("approve-more-menu").closest<HTMLElement>(".action-more")!.classList.toggle("is-empty", !hybrid);
  el("consent-box").hidden = !hybrid;
  const aid = approvalId(controller.redaction?.sanitizedSha256);
  el("approval-id-line").hidden = aid === null;
  el("approval-id").textContent = aid ?? "";
  const card = practiceRunCard(
    controller.getObservedFirebaseTelemetry().hasLiveCloudConfig,
    el<HTMLInputElement>("chk-sim-cloud").checked
  );
  el("hybrid-title").textContent = card.title;
  el("hybrid-sub").textContent = card.sub;
  const badge = el("hybrid-badge");
  badge.hidden = !card.badge;
  badge.textContent = card.badge ?? "";
  const notSetUp = card.title === "Deeper check is not set up";
  const hybridRadio = document.querySelector<HTMLInputElement>('input[name="privacy-mode"][value="HYBRID_ANONYMIZED"]')!;
  hybridRadio.setAttribute("aria-disabled", String(notSetUp));
  hybridRadio.closest("label")?.classList.toggle("is-disabled", notSetUp);
  if (notSetUp && controller.privacyMode === "HYBRID_ANONYMIZED") controller.privacyMode = "LOCAL_ONLY";

  let hint = "";
  if (snap.state === "STALE_APPROVAL_INVALIDATED") hint = "You changed something after approving, so approval was reset. Check the text and approve again.";
  else if (unresolved > 0) hint = `${unresolved} item${unresolved === 1 ? " still needs" : "s still need"} a decision in Review.`;
  else if (approved && !hybrid) hint = "Approved, but the deeper check is set to stay on this device. Choose “Send the cleaned text” above to run it.";
  else if (hybrid && !consent && !approved) hint = "Tick the box to enable approval.";
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

/** Documents already counted in the on-device tally this session (by document id). */
const talliedDocs = new Set<string>();

/** The findings list the finish message was last shown for, so it appears once per result. */
let finishShownFor: unknown = null;

function renderFinish(): void {
  const done = controller.findings.length > 0 && Boolean(controller.document);
  const lede = el("results-lede");
  if (!done) {
    finishShownFor = null;
    removeNotice("finish");
    lede.textContent = "Real names and numbers are put back on this device only.";
    return;
  }
  const n = ledgerCounts(controller.entities).hiddenTotal;
  const sentToCloud = controller.lastCloudSdkSource === "in_cloud";
  lede.textContent = finishLede(n, sentToCloud);
  const docId = controller.document!.docId;
  if (currentStep === 4 && !talliedDocs.has(docId)) {
    talliedDocs.add(docId);
    recordTally(n);
  }
  if (currentStep === 4 && finishShownFor !== controller.findings) {
    // One happy notice for this result, with the running total kept on this device.
    finishShownFor = controller.findings;
    const t = readTally();
    postNotice({
      key: "finish",
      source: "Results",
      testid: "finish-card",
      text: `All done. ${n} detail${n === 1 ? "" : "s"} kept private.`,
      sub: [sentToCloud ? "Only the cleaned text was sent." : "Nothing personal was sent.", t.docs > 0 ? tallyText(t) : ""].filter(Boolean).join(" "),
      subTestid: "tally-pill",
    });
  }
}

function renderResults(): void {
  renderFinish();
  const list = el("findings-list");
  list.replaceChildren();
  el("findings-empty").hidden = controller.findings.length > 0;
  const srcBox = el("results-source");
  srcBox.hidden = true;

  for (const f of controller.findings) {
    const card = document.createElement("article");
    card.className = `finding sev-${f.severity}`;

    // The message comes first. Where it was checked is one small line at the bottom.
    const head = document.createElement("div");
    head.className = "finding-head";
    const sev = document.createElement("span");
    sev.className = `chip ${f.severity === "HIGH" ? "chip-err" : f.severity === "MEDIUM" ? "chip-warn" : "chip-ok"}`;
    sev.textContent = severityLabel(f.severity);
    const title = document.createElement("h2");
    title.className = "finding-title";
    const plain = plainFinding(f);
    title.textContent = plain.title;
    head.append(sev, title);

    const why = document.createElement("p");
    why.className = "finding-why";
    why.textContent = plain.message;
    card.append(head, why);

    const excerpt = f.rehydratedExcerpt || f.anonymizedExcerpt;
    if (f.rationale && excerpt) {
      const quote = document.createElement("p");
      quote.className = "finding-excerpt";
      quote.textContent = `From your document: ${excerpt}`;
      card.append(quote);
    }

    const foot = document.createElement("p");
    foot.className = "finding-foot";
    const where = document.createElement("span");
    where.className = "where-badge";
    where.textContent = findingFootText(f);
    foot.append(where);
    card.append(foot);
    list.appendChild(card);
  }
}

/** Briefly tint the row for a newly added item, and bring it into view on wide screens. */
/** Scroll a row into view inside the work area only, so the fixed page frame never moves. */
function scrollIntoWork(node: HTMLElement): void {
  const work = node.closest<HTMLElement>(".work");
  if (work && work.scrollHeight > work.clientHeight) {
    const r = node.getBoundingClientRect();
    const w = work.getBoundingClientRect();
    if (r.top < w.top || r.bottom > w.bottom) work.scrollTop += r.top - w.top - (w.height - r.height) / 2;
  } else {
    node.scrollIntoView({ block: "nearest" });
  }
}

function highlightRow(entityId: string): void {
  const row = Array.from(document.querySelectorAll<HTMLElement>(".entity-card")).find((c) =>
    (c.dataset.entityIds ?? "").split(" ").includes(entityId)
  );
  if (!row) return;
  row.classList.add("is-new");
  scrollIntoWork(row);
  window.setTimeout(() => row.classList.remove("is-new"), 3200);
}

function renderAll(): void {
  const focus = focusKey(document.activeElement);
  const maxStep = furthestStep(Boolean(controller.document), controller.findings.length > 0);
  if (currentStep > maxStep) currentStep = maxStep;
  renderStatusBar();
  renderBanners();
  renderStepper(maxStep);
  renderImport();
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
  clearNotices();
  const name = input.fileName || "your document";
  readingFile = true;
  const ok = await run(`Reading ${name} on this device…`, () => controller.ingestFileOrText(input), {
    source: "Import",
    done: () => {
      const n = controller.entities.length;
      return n === 0
        ? `Finished reading ${name}. No sensitive details were found automatically.`
        : `Finished reading ${name}. Found ${n} detail${n === 1 ? "" : "s"} to review.`;
    },
  });
  readingFile = false;
  if (ok) goTo(2);
  else renderAll();
}

/**
 * A small disclosure menu or popover: toggles on its button, closes on Esc and on a click outside,
 * and returns focus to the button when closed from inside. Returns a function that closes it.
 */
function wireDisclosure(btn: HTMLElement, panel: HTMLElement, opts: { focusFirst?: boolean } = {}): (returnFocus?: boolean) => void {
  const wrap = btn.parentElement ?? btn;
  const set = (open: boolean, returnFocus = false): void => {
    const wasOpen = !panel.hidden;
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (open && opts.focusFirst) {
      panel.querySelector<HTMLElement>('.menu-item:not([hidden]), [role="radio"][aria-checked="true"]')?.focus();
    } else if (!open && returnFocus && wasOpen) {
      btn.focus();
    }
  };
  btn.addEventListener("click", () => set(panel.hidden));
  // Esc closes from anywhere and puts focus back on the button that opened it.
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !panel.hidden) {
      ev.preventDefault();
      set(false, true);
    }
  });
  document.addEventListener("click", (ev) => {
    if (!panel.hidden && !wrap.contains(ev.target as Node)) set(false);
  });
  return (returnFocus = false) => set(false, returnFocus);
}

function setAdvanced(open: boolean): void {
  advancedOpen = open;
  renderAll();
  if (open) {
    window.scrollTo({ top: 0 });
    el("advanced-title").focus();
  } else {
    el("btn-app-menu").focus();
  }
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

  const themeGroup = el("theme-choice");
  if (!themeGroup.querySelector("[data-theme-note]")) {
    const note = document.createElement("span");
    note.className = "small muted theme-note";
    note.setAttribute("data-theme-note", "");
    themeGroup.after(note);
  }
  initThemeControls(el("theme-choice"));

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

  // Device AI setup. Every Download button forwards to the one real button.
  el("btn-init-nano").addEventListener("click", async () => {
    await run("Setting up private AI on this device…", async () => {
      await controller.initializeOnDeviceModel(() => renderAll());
    }, { source: "Private AI" });
  });
  for (const id of ["btn-chip-download", "btn-banner-download", "btn-review-download"]) {
    el(id).addEventListener("click", () => el("btn-init-nano").click());
  }
  el("btn-banner-hide").addEventListener("click", () => {
    bannerDismissed = true;
    try { sessionStorage.setItem("cg-ai-banner-hidden", "1"); } catch { /* storage may be blocked */ }
    renderAll();
  });
  el<HTMLInputElement>("chk-sim-cloud").addEventListener("change", () => renderAll());

  // Review
  el("btn-accept-all").addEventListener("click", () =>
    reviewChange("All undecided items hidden", () => controller.acceptAllPendingEntities(), { notice: true })
  );

  // Continue never asks a question. Undecided details are hidden (hiding is always safe), the next
  // step lists what was hidden, and a short-lived Undo toast puts the choices back.
  el("btn-review-continue").addEventListener("click", async () => {
    if (isBusy() || !controller.document) return;
    const pendingRows = reviewCounts(controller.entities).pending;
    if (!reviewContinueBlocker(pendingRows)) {
      goTo(3);
      return;
    }
    const before = new Map(controller.entities.map((e) => [e.id, e.reviewStatus]));
    resetConsent();
    snapshotStatuses();
    quietBusy = true;
    errorText = null;
    let ok = true;
    try {
      await controller.acceptAllPendingEntities();
    } catch (err) {
      ok = false;
      errorText = friendlyError(err);
    } finally {
      quietBusy = false;
    }
    if (!ok) {
      renderAll();
      return;
    }
    goTo(3);
    postNotice({
      text: undecidedHiddenText(pendingRows),
      source: "Review",
      action: {
        label: "Undo",
        ms: NOTICE_UNDO_MS,
        run: () => {
          goTo(2);
          void reviewChange("Undone", () => restoreStatuses(before));
        },
      },
    });
  });

  // "More actions" pane in the Review bar: opens in the bottom-right corner.
  const moreBtn = el<HTMLButtonElement>("btn-review-more");
  const moreMenu = el("review-more-menu");
  const closeMore = wireDisclosure(moreBtn, moreMenu, { focusFirst: true });
  for (const b of moreMenu.querySelectorAll<HTMLButtonElement>("[data-bulk]")) {
    b.addEventListener("click", async () => {
      const kind = b.dataset.bulk;
      const ids =
        kind === "names"
          ? idsToHide(controller.entities, new Set(["PERSON"]))
          : kind === "numbers"
            ? idsToHide(controller.entities, NUMBER_CATEGORIES)
            : idsToHide(controller.entities);
      closeMore(true);
      if (ids.length === 0) return;
      const what = kind === "names" ? "All names" : kind === "numbers" ? "All numbers and IDs" : "Everything on the list";
      await reviewChange(`${what} hidden`, () => controller.toggleEntityStatus(ids, "ACCEPTED"), { notice: true });
    });
  }
  el("btn-review-undo").addEventListener("click", async () => {
    const snap = undoSnapshot;
    closeMore(true);
    if (!snap || isBusy()) return;
    await reviewChange("Last change undone", () => restoreStatuses(snap));
    undoSnapshot = null;
    renderAll();
  });
  el("btn-review-add").addEventListener("click", () => {
    closeMore();
    const input = el<HTMLInputElement>("manual-surface");
    input.focus({ preventScroll: true });
    scrollIntoWork(input);
  });
  // Side panel buttons press the real ones. They never open or move focus into the ⋯ pane.
  document.querySelector<HTMLElement>("[data-side-accept]")!.addEventListener("click", (ev) => {
    if ((ev.currentTarget as HTMLElement).getAttribute("aria-disabled") === "true") return;
    el("btn-accept-all").click();
  });
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-side-bulk]")) {
    b.addEventListener("click", () => {
      if (b.getAttribute("aria-disabled") === "true") return;
      moreMenu.querySelector<HTMLButtonElement>(`[data-bulk="${b.dataset.sideBulk}"]`)?.click();
    });
  }
  const manualFeedback = el("manual-feedback");
  // The result goes to the notice board. This element keeps the last text for tests and tools.
  const showManualFeedback = (text: string | null, ok = true): void => {
    manualFeedback.textContent = text ?? "";
    if (text) postNotice({ text, source: "Review", tone: ok ? undefined : "warn" });
  };
  el<HTMLFormElement>("manual-entity-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (isBusy()) return;
    const surf = el<HTMLInputElement>("manual-surface").value.trim();
    if (!surf) {
      showManualFeedback("Type the word or phrase you want hidden first.", false);
      el("manual-surface").focus();
      return;
    }
    const catSelect = el<HTMLSelectElement>("manual-category");
    const cat = catSelect.value as DetectedEntity["category"];
    const catText = (catSelect.selectedOptions[0]?.textContent ?? categoryLabel(cat)).trim();
    const btn = el<HTMLButtonElement>("btn-add-entity");
    const idle = btn.textContent;
    resetConsent();
    snapshotStatuses();
    quietBusy = true;
    btn.textContent = "Hiding\u2026";
    setAriaDisabled(btn, true);
    let added = 0;
    try {
      added = await controller.addManualEntity(surf, cat, "PARTY");
    } catch (err) {
      showManualFeedback(friendlyError(err), false);
      return;
    } finally {
      quietBusy = false;
      btn.textContent = idle;
      setAriaDisabled(btn, false);
    }
    const fb = manualAddFeedback(surf, added, catText);
    showManualFeedback(fb.text, fb.ok);
    if (fb.ok) el<HTMLInputElement>("manual-surface").value = "";
    renderAll();
    if (fb.ok) {
      const found = controller.entities.find((e) => e.source === "HUMAN_ADDED" && e.surface === surf);
      if (found) highlightRow(found.id);
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
    }, {
      source: "Approve",
      done: () => {
        const id = approvalId(controller.redaction?.sanitizedSha256);
        return id ? `Approved. This exact text is locked in. Approval ID ${id}.` : "Approved. This exact text is locked in.";
      },
    });
  });
  el("btn-analyze-cloud").addEventListener("click", async () => {
    const ok = await run("Running the deeper check on the approved text…", async () => {
      try {
        await controller.runApprovedCloudAnalysis({
          allowSimulatedCloud: el<HTMLInputElement>("chk-sim-cloud").checked,
          modelId: controller.selectedCloudModel,
        });
        cloudRefused = false;
      } catch (err) {
        // Keep the status chip honest: after an App Check refusal the cloud is not "protected and ready".
        if (isCloudVerificationError(err)) cloudRefused = true;
        errorExt = true;
        throw err;
      }
    }, { source: "Cloud" });
    if (ok) {
      const n = controller.findings.length;
      const real = controller.lastCloudSdkSource === "in_cloud";
      postNotice({
        ext: real,
        source: real ? "Cloud" : "Approve",
        text: real
          ? `The deeper check replied with ${n} thing${n === 1 ? "" : "s"} worth a look. Only the cleaned text was sent.`
          : `The practice run finished on this device with ${n} thing${n === 1 ? "" : "s"} worth a look. Nothing was sent.`,
      });
      goTo(4);
    }
  });
  el("btn-local-triage").addEventListener("click", async () => {
    if (!controller.document) return;
    const doc = controller.document;
    const ok = await run("Checking on this device…", async () => {
      await controller.runOfflineLocalClauseTriage(doc.normalizedText.slice(0, 1200));
    }, { source: "Approve" });
    if (ok) {
      const n = controller.findings.length;
      postNotice({ source: "Approve", text: `Checked on this device. ${n} thing${n === 1 ? "" : "s"} worth a look. Nothing was sent.` });
      goTo(4);
    }
  });

  // Results
  el("btn-export-report").addEventListener("click", async () => {
    // A proper PDF made on this device (counts only, never real values). The raw JSON stays under Advanced settings.
    const report = controller.getPrivacyReport16();
    const ledger = ledgerCounts(controller.entities);
    const save = (blob: Blob, name: string): void => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    try {
      const { buildPrivacyReportPdf, pdfFileName, isCloudUsed } = await import("./reportPdf.ts");
      const bytes = await buildPrivacyReportPdf(report, {
        hiddenItems: ledger.hiddenByCategory.map((c) => ({ label: categoryLabel(c.category, c.count).replace(/^./, (ch) => ch.toUpperCase()), count: c.count })),
        hiddenTotal: ledger.hiddenTotal,
        sentCount: isCloudUsed(report) ? ledger.visibleTotal : 0,
        findings: controller.findings.map((f) => ({ severity: f.severity, ...plainFinding(f) })),
        // The file name can itself hold a real name, so the title names the kind of document only.
        documentTitle: controller.documentProfile?.label
          ? controller.documentProfile.label.replace(/^./, (ch) => ch.toUpperCase())
          : undefined,
      });
      save(new Blob([bytes as BlobPart], { type: "application/pdf" }), pdfFileName(controller.sessionId));
    } catch {
      // If the PDF cannot be made, still give a readable report.
      const html = buildReadablePrivacyReport(report, {
        hiddenItems: ledger.hiddenByCategory.map((c) => ({ label: c.label, category: "" })),
        hiddenTotal: ledger.hiddenTotal,
        findingsCount: controller.findings.length,
      });
      save(new Blob([html], { type: "text/html" }), `clauseguard_privacy_report_${controller.sessionId}.html`);
    }
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

  // App bar: status popovers, combined status sheet, ⋯ menu, Advanced settings
  wireDisclosure(el("chip-device"), el("pop-device"));
  wireDisclosure(el("chip-cloud"), el("pop-cloud"));
  const statusSheet = el<HTMLDialogElement>("status-sheet");
  el("chip-status").addEventListener("click", () => {
    statusSheet.showModal();
    el("status-sheet-title").focus();
  });
  el("btn-status-sheet-close").addEventListener("click", () => statusSheet.close());
  statusSheet.addEventListener("close", () => el("chip-status").focus());
  statusSheet.addEventListener("click", (ev) => {
    if (ev.target === statusSheet) statusSheet.close();
  });
  el("btn-init-nano-sheet").addEventListener("click", () => {
    statusSheet.close();
    el("btn-init-nano").click();
  });
  const closeAppMenu = wireDisclosure(el("btn-app-menu"), el("app-menu"), { focusFirst: true });
  for (const item of el("app-menu").querySelectorAll<HTMLElement>("a.menu-item")) {
    item.addEventListener("click", () => closeAppMenu());
  }
  el("btn-open-advanced").addEventListener("click", () => {
    closeAppMenu();
    setAdvanced(true);
  });
  el("btn-close-advanced").addEventListener("click", () => setAdvanced(false));
  el("advanced-view").addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !(ev.target as Element).closest("select, textarea, input")) setAdvanced(false);
  });

  // Phone: secondary actions sit in a ⋯ menu in the bar; each item presses the real button.
  for (const [btnId, menuId] of [["btn-approve-more", "approve-more-menu"], ["btn-results-more", "results-more-menu"]]) {
    const close = wireDisclosure(el(btnId), el(menuId), { focusFirst: true });
    for (const item of el(menuId).querySelectorAll<HTMLButtonElement>("[data-proxy]")) {
      item.addEventListener("click", () => {
        close(true);
        el<HTMLButtonElement>(item.dataset.proxy ?? "").click();
      });
    }
  }
  // Side panel buttons with data-proxy press the real button in the bar.
  for (const side of document.querySelectorAll<HTMLElement>(".side-panel [data-proxy]")) {
    side.addEventListener("click", () => {
      if (side.getAttribute("aria-disabled") === "true") return;
      el<HTMLButtonElement>(side.dataset.proxy ?? "").click();
    });
  }

  // Import: Continue goes on only once a document is loaded.
  el("btn-import-continue").addEventListener("click", () => {
    if (controller.document && busyText === null) {
      goTo(2);
      return;
    }
    el("file-input").focus();
  });

  // Approve: radio cards drive the (visually hidden) select, which the app logic listens to.
  const modeSelect = el<HTMLSelectElement>("privacy-mode-select");
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="privacy-mode"]')) {
    r.addEventListener("change", () => {
      if (!r.checked || modeSelect.value === r.value) return;
      if (r.getAttribute("aria-disabled") === "true") {
        r.checked = false;
        document.querySelector<HTMLInputElement>('input[name="privacy-mode"][value="LOCAL_ONLY"]')!.checked = true;
        return;
      }
      modeSelect.value = r.value;
      modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  // Keep page padding equal to the action bar, which can wrap at narrow widths or large text.
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => syncActionBarHeight());
    for (const bar of document.querySelectorAll(".action-bar")) ro.observe(bar);
  }

  // Clear everything
  el("btn-purge").addEventListener("click", async () => {
    closeAppMenu(true);
    resetConsent();
    el<HTMLTextAreaElement>("firebase-config-json").value = "";
    el<HTMLInputElement>("recaptcha-site-key").value = "";
    el<HTMLInputElement>("chk-debug-appcheck").checked = false;
    el<HTMLInputElement>("vault-passphrase").value = "";
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem("CG_LOCALHOST_APPCHECK_DEBUG");
    const ok = await run("Clearing everything…", () => controller.purgeAllSessionAndStorage(), { source: "App" });
    if (ok) {
      clearTally();
      talliedDocs.clear();
      finishShownFor = null;
      clearNotices();
      goTo(1, false);
      postNotice({ source: "App", text: "Cleared. Your document, results and saved data are gone from this device." });
    }
  });

  renderAll();
  await controller.refreshReadiness();
  renderAll();
}

void initUi();
