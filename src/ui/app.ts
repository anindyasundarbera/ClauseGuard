import {
  ClauseGuardSessionController,
  SYNTHETIC_SAMPLE_CONTRACTS,
} from "../core/sessionController.ts";
import type { ContractRole, DetectedEntity } from "../core/types.ts";

const controller = new ClauseGuardSessionController();
(window as unknown as { __clauseguardController?: ClauseGuardSessionController }).__clauseguardController =
  controller;

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function renderAll(): void {
  el("nano-readiness-badge").textContent = controller.readinessState;
  el("nano-readiness-detail").textContent = controller.readinessDetail;
  el<HTMLSelectElement>("privacy-mode-select").value = controller.privacyMode;

  const warnBox = el("warnings-box");
  warnBox.replaceChildren();
  if (controller.warnings.length > 0) {
    warnBox.hidden = false;
    for (const w of controller.warnings) {
      const p = document.createElement("div");
      p.textContent = w;
      warnBox.appendChild(p);
    }
  } else {
    warnBox.hidden = true;
  }

  // Render Airlock safely via textContent (never raw innerHTML on document text)
  const airlock = el("airlock-list");
  airlock.replaceChildren();
  if (controller.entities.length === 0) {
    const empty = document.createElement("p");
    empty.className = "small-note";
    empty.textContent = "No entities loaded yet.";
    airlock.appendChild(empty);
  } else {
    for (const ent of controller.entities) {
      const card = document.createElement("div");
      card.className = "entity-card";
      card.setAttribute("data-entity-id", ent.id);

      const head = document.createElement("div");
      head.className = "entity-head";

      const title = document.createElement("strong");
      title.textContent = `${ent.surface} [${ent.category}]`;

      const statusBadge = document.createElement("span");
      statusBadge.className =
        ent.reviewStatus === "ACCEPTED"
          ? "badge badge-accepted"
          : ent.reviewStatus === "REJECTED"
            ? "badge badge-rejected"
            : "badge badge-pending";
      statusBadge.textContent = ent.reviewStatus;

      head.appendChild(title);
      head.appendChild(statusBadge);

      const meta = document.createElement("div");
      meta.className = "small-note";
      meta.textContent = `Source: ${ent.source} | Conf: ${Math.round(ent.confidence * 100)}% | Role: ${ent.role} | Offsets: ${ent.normStart}..${ent.normEnd} — ${ent.rationale}`;

      const btnRow = document.createElement("div");
      btnRow.className = "actions-row";

      const btnAccept = document.createElement("button");
      btnAccept.type = "button";
      btnAccept.className = "btn-secondary";
      btnAccept.textContent = "Accept";
      btnAccept.setAttribute("data-testid", `accept-${ent.id}`);
      btnAccept.onclick = async () => {
        el<HTMLInputElement>("chk-explicit-consent").checked = false;
        await controller.toggleEntityStatus(ent.id, "ACCEPTED");
        renderAll();
      };

      const btnReject = document.createElement("button");
      btnReject.type = "button";
      btnReject.className = "btn-secondary";
      btnReject.textContent = "Reject (Restore)";
      btnReject.setAttribute("data-testid", `reject-${ent.id}`);
      btnReject.onclick = async () => {
        el<HTMLInputElement>("chk-explicit-consent").checked = false;
        await controller.toggleEntityStatus(ent.id, "REJECTED");
        renderAll();
      };

      const roleSel = document.createElement("select");
      roleSel.setAttribute("aria-label", `Role for ${ent.surface}`);
      for (const r of [
        "CLIENT",
        "VENDOR",
        "BUYER",
        "TARGET",
        "DISCLOSING_PARTY",
        "RECEIVING_PARTY",
        "ADVISOR",
        "BANK",
        "SIGNATORY",
        "PARTY",
      ] as ContractRole[]) {
        const opt = document.createElement("option");
        opt.value = r;
        opt.textContent = r;
        if (ent.role === r) opt.selected = true;
        roleSel.appendChild(opt);
      }
      roleSel.onchange = async () => {
        el<HTMLInputElement>("chk-explicit-consent").checked = false;
        await controller.updateCanonicalGroupRole(ent.canonicalKey, roleSel.value as ContractRole);
        renderAll();
      };

      btnRow.appendChild(btnAccept);
      btnRow.appendChild(btnReject);
      btnRow.appendChild(roleSel);

      card.appendChild(head);
      card.appendChild(meta);
      card.appendChild(btnRow);
      airlock.appendChild(card);
    }
  }

  // Approval state & sanitized preview
  const snap = controller.approvalMachine.getSnapshot();
  el("approval-state").textContent = snap.state;
  el("payload-sha").textContent = controller.redaction?.sanitizedSha256 ?? "NONE";
  el("sanitized-preview").textContent =
    controller.redaction?.sanitizedText ??
    "(Import a contract or select a synthetic sample to inspect the exact sanitized payload.)";

  const consentChecked = el<HTMLInputElement>("chk-explicit-consent").checked;
  const unresolvedCount = controller.entities.filter(
    (e) => e.reviewStatus === "PENDING_REVIEW" || e.reviewStatus === "NEEDS_DECISION"
  ).length;
  const hasDoc = Boolean(controller.redaction);
  el<HTMLButtonElement>("btn-accept-all").disabled = unresolvedCount === 0;
  el<HTMLButtonElement>("btn-approve-payload").disabled = !hasDoc || !consentChecked || unresolvedCount > 0;
  el<HTMLButtonElement>("btn-analyze-cloud").disabled =
    !hasDoc ||
    controller.privacyMode !== "HYBRID_ANONYMIZED" ||
    snap.state !== "HUMAN_APPROVED_FOR_CLOUD";
  el<HTMLButtonElement>("btn-local-triage").disabled = !controller.document;

  // Findings
  const findingsBox = el("findings-list");
  findingsBox.replaceChildren();
  for (const f of controller.findings) {
    const fc = document.createElement("div");
    fc.className = "finding-card";
    const h = document.createElement("strong");
    h.textContent = `[${f.severity}] ${f.title} (${f.analysisSource})`;
    const pAnon = document.createElement("div");
    pAnon.className = "small-note";
    pAnon.textContent = `Anonymized Cloud Excerpt: ${f.anonymizedExcerpt}`;
    const pReh = document.createElement("div");
    pReh.textContent = `Locally Rehydrated: ${f.rehydratedExcerpt}`;
    const pRat = document.createElement("div");
    pRat.className = "small-note";
    pRat.textContent = `Rationale: ${f.rationale}${f.unmappedTokens.length ? ` | Unmapped tokens: ${f.unmappedTokens.join(", ")}` : ""}`;
    fc.append(h, pAnon, pReh, pRat);
    findingsBox.appendChild(fc);
  }

  // 16-field Privacy Report
  el("privacy-report-pre").textContent = JSON.stringify(controller.getPrivacyReport16(), null, 2);
}

async function initUi(): Promise<void> {
  await controller.refreshReadiness();

  const samplesDiv = el("sample-buttons");
  for (const smp of SYNTHETIC_SAMPLE_CONTRACTS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn-secondary";
    b.textContent = smp.label;
    b.setAttribute("data-testid", smp.id);
    b.onclick = async () => {
      el<HTMLInputElement>("chk-explicit-consent").checked = false;
      await controller.ingestFileOrText({
        fileName: smp.fileName,
        mimeType: "text/plain",
        text: smp.text,
      });
      renderAll();
    };
    samplesDiv.appendChild(b);
  }

  el<HTMLInputElement>("file-input").addEventListener("change", async (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    el<HTMLInputElement>("chk-explicit-consent").checked = false;
    const buf = new Uint8Array(await file.arrayBuffer());
    try {
      await controller.ingestFileOrText({
        fileName: file.name,
        mimeType: file.type || (file.name.endsWith(".pdf") ? "application/pdf" : "text/plain"),
        bytes: buf,
      });
    } catch (err) {
      controller.warnings = [String(err)];
    }
    renderAll();
  });

  el<HTMLSelectElement>("privacy-mode-select").addEventListener("change", (ev) => {
    controller.privacyMode = (ev.target as HTMLSelectElement).value as "LOCAL_ONLY" | "HYBRID_ANONYMIZED";
    renderAll();
  });

  el<HTMLInputElement>("chk-explicit-consent").addEventListener("change", () => renderAll());

  el<HTMLFormElement>("manual-entity-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const surf = el<HTMLInputElement>("manual-surface").value;
    const cat = el<HTMLSelectElement>("manual-category").value as DetectedEntity["category"];
    const role = el<HTMLSelectElement>("manual-role").value as ContractRole;
    el<HTMLInputElement>("chk-explicit-consent").checked = false;
    await controller.addManualEntity(surf, cat, role);
    el<HTMLInputElement>("manual-surface").value = "";
    renderAll();
  });

  el("btn-accept-all").addEventListener("click", async () => {
    el<HTMLInputElement>("chk-explicit-consent").checked = false;
    await controller.acceptAllPendingEntities();
    renderAll();
  });

  el("btn-approve-payload").addEventListener("click", async () => {
    try {
      await controller.approveCurrentPayload();
    } catch (err) {
      controller.warnings.push(String(err));
    }
    renderAll();
  });

  el("btn-analyze-cloud").addEventListener("click", async () => {
    try {
      const apiKey = el<HTMLInputElement>("gemini-api-key").value.trim() || undefined;
      const simOk = el<HTMLInputElement>("chk-sim-cloud").checked;
      const customUrl = (window as unknown as { __clauseguardCloudUrl?: string }).__clauseguardCloudUrl;
      await controller.runApprovedCloudAnalysis({
        cloudEndpointUrl: customUrl,
        geminiApiKey: apiKey,
        allowSimulatedCloud: simOk,
      });
    } catch (err) {
      controller.warnings.push(String(err));
    }
    renderAll();
  });

  el("btn-local-triage").addEventListener("click", async () => {
    if (!controller.document) return;
    try {
      await controller.runOfflineLocalClauseTriage(controller.document.normalizedText.slice(0, 1200));
    } catch (err) {
      controller.warnings.push(`Local triage error: ${String(err)}`);
    }
    renderAll();
  });

  el("btn-save-vault").addEventListener("click", async () => {
    const wsId = el<HTMLInputElement>("vault-workspace-id").value.trim() || "default";
    const pass = el<HTMLInputElement>("vault-passphrase").value;
    try {
      const cnt = await controller.commitApprovedToEncryptedWorkspace(wsId, pass);
      controller.warnings.push(`Encrypted ${cnt} human-approved canonical entities to IndexedDB workspace '${wsId}'.`);
    } catch (err) {
      controller.warnings.push(String(err));
    }
    renderAll();
  });

  el("btn-unlock-vault").addEventListener("click", async () => {
    const wsId = el<HTMLInputElement>("vault-workspace-id").value.trim() || "default";
    const pass = el<HTMLInputElement>("vault-passphrase").value;
    try {
      const ok = await controller.unlockWorkspaceFromIdb(wsId, pass);
      controller.warnings.push(ok ? `Unlocked workspace '${wsId}'.` : `No vault found or wrong passphrase for '${wsId}'.`);
    } catch (err) {
      controller.warnings.push(`Vault unlock failed (tampered or wrong passphrase): ${String(err)}`);
    }
    renderAll();
  });

  el("btn-export-report").addEventListener("click", () => {
    const rpt = JSON.stringify(controller.getPrivacyReport16(), null, 2);
    const blob = new Blob([rpt], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clauseguard_privacy_report_${controller.sessionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  el("btn-purge").addEventListener("click", async () => {
    el<HTMLInputElement>("chk-explicit-consent").checked = false;
    el<HTMLInputElement>("gemini-api-key").value = "";
    el<HTMLInputElement>("vault-passphrase").value = "";
    await controller.purgeAllSessionAndStorage();
    renderAll();
  });

  renderAll();
}

void initUi();
