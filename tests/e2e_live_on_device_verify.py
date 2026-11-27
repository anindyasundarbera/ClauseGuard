#!/usr/bin/env python3
"""LIVE on-device proof for the four-step guided UI.

Drives the production build (`dist/`, run `npm run build` first) in the locally installed Google Chrome
using the persistent profile that holds the manually installed Gemma 4 on-device component
(see `probes/install_chrome_on_device_model.py`). Weights are never downloaded, copied or committed here.

Everything recorded in `evidence/wo062-live-on-device-proof.json` is observed from the real runtime:
  * real Chrome `LanguageModel` (Prompt API) via Firebase AI Logic `ONLY_ON_DEVICE`
  * real CDP network capture (no mocks, no simulated cloud)
The cloud step is only probed for *blocking* (it must refuse before approval); no cloud request is
ever approved or sent by this script.

If Chrome or the model cannot run, the script writes the exact blocker to the JSON and exits 2
instead of fabricating results.
"""

from __future__ import annotations

import json
import mimetypes
import os
import platform
import subprocess
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from playwright.sync_api import sync_playwright

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DIST_DIR = PROJECT_ROOT / "dist"
OUT_JSON = PROJECT_ROOT / "evidence" / "wo062-live-on-device-proof.json"
PROFILE_DIR = Path.home() / ".cache" / "clauseguard-chrome-nano-profile"
CHROME = "/usr/bin/google-chrome"

# Same flags as evidence/phase2-nano-runtime-matrix.json
CHROME_FEATURES = (
    "OptimizationGuideOnDeviceModel:BypassPerfRequirement/true,"
    "OptimizationGuideManifestBroker,OnDeviceModelSpeculativeDecoding,"
    "AIApiFoundationalModel:model_version/v4,AIPromptAPIParams,PromptAPIForGeminiNano,"
    "PromptAPIForGeminiNanoMultimodalInput,AISummarizationAPI,AIWriterAPI,AIRewriterAPI,OptimizationHints"
)
CHROME_ARGS = ["--enable-experimental-web-platform-features", f"--enable-features={CHROME_FEATURES}"]
# Playwright's default `--disable-features=...OptimizationHints...` MUST be dropped (same as probes/nano_runtime_probe.py),
# otherwise Chrome 158 reports LanguageModel.availability()='unavailable' and chrome://on-device-internals never loads.
PLAYWRIGHT_DISABLE_FEATURES_DEFAULT = (
    "--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,DestroyProfileOnBrowserClose,DialMediaRouteProvider,"
    "GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,"
    "BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,"
    "msEdgeUpdateLaunchServicesPreferredVersion"
)
IGNORE_DEFAULT_ARGS = [
    "--disable-component-update", "--disable-background-networking",
    "--disable-component-extensions-with-background-pages", PLAYWRIGHT_DISABLE_FEATURES_DEFAULT,
]
MODEL_WAIT_S = 900  # wait this long if Chrome reports 'downloading' (component fetch by Chrome itself)

SAMPLES = [
    {"id": "sample-tenant-lease", "label": "tenant lease"},
    {"id": "sample-medical-bill", "label": "medical bill"},
]
INGEST_TIMEOUT_S = 240


def clean_chrome_env() -> dict[str, str]:
    drop = {"GSETTINGS_SCHEMA_DIR", "GIO_MODULE_DIR", "GTK_PATH", "GTK_EXE_PREFIX", "GTK_IM_MODULE_FILE",
            "GDK_PIXBUF_MODULE_FILE", "GDK_PIXBUF_MODULEDIR", "LOCPATH"}
    env = {k: v for k, v in os.environ.items() if not k.startswith("SNAP") and k not in drop}
    env["XDG_DATA_DIRS"] = "/usr/local/share:/usr/share"
    return env


def chrome_version() -> str:
    try:
        return subprocess.run([CHROME, "--version"], capture_output=True, text=True, timeout=10).stdout.strip()
    except Exception as exc:  # noqa: BLE001
        return f"unknown ({exc})"


def dir_size_mib(path: Path) -> float | None:
    if not path.exists():
        return None
    total = 0
    for f in path.rglob("*"):
        try:
            if f.is_file():
                total += f.stat().st_size
        except OSError:
            pass
    return round(total / (1024 * 1024), 1)


def serve_dist() -> ThreadingHTTPServer:
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a: Any) -> None:  # noqa: D401
            return

        def do_GET(self) -> None:  # noqa: N802
            rel = self.path.split("?", 1)[0].lstrip("/") or "index.html"
            target = (DIST_DIR / rel).resolve()
            if not str(target).startswith(str(DIST_DIR.resolve())) or not target.is_file():
                target = DIST_DIR / "index.html"
            data = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(str(target))[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def write_report(report: dict[str, Any]) -> None:
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


def summarize_entities(page: Any) -> dict[str, Any]:
    return page.evaluate(
        """() => {
            const c = window.__clauseguardController;
            const by = {};
            for (const e of c.entities) by[e.source] = (by[e.source] || 0) + 1;
            return {
                total: c.entities.length,
                by_source: by,
                nano_entities: c.entities.filter(e => e.source === 'NANO_ON_DEVICE')
                    .map(e => ({ surface: e.surface, category: e.category, confidence: e.confidence })),
                local_inference_source: c.localInferenceSource,
                last_local_sdk_source: c.lastLocalSdkSource,
                readiness_state: c.readinessState,
                privacy_mode: c.privacyMode,
                warnings: c.warnings.slice(0, 8),
            };
        }"""
    )


def run() -> int:
    started = datetime.now(timezone.utc).isoformat()
    report: dict[str, Any] = {
        "verification_id": "CG-WO062-LIVE-ON-DEVICE-PROOF",
        "evidence_class": "LIVE_ON_DEVICE_RUNTIME (nothing simulated)",
        "ui_flow": "four-step (Import, Review, Approve, Results)",
        "executed_at_utc": started,
        "host": {"os": platform.platform(), "chrome_version": chrome_version(), "profile_dir_is_default_probe_profile": True},
        "chrome_flags": CHROME_ARGS,
        "weights": {
            "note": "Weights are manually installed in the Chrome profile (probes/install_chrome_on_device_model.py); never committed or re-downloaded by this script.",
            "OptGuideOnDeviceModel_mib": dir_size_mib(PROFILE_DIR / "OptGuideOnDeviceModel"),
            "optimization_guide_model_store_mib": dir_size_mib(PROFILE_DIR / "optimization_guide_model_store"),
        },
        "not_covered": [
            "Live Firebase/Gemini cloud call (not made; see phase6 evidence for mock-cloud wire checks)",
            "Gemma entity recall/accuracy benchmarking (this proves the runtime path and egress, not entity recall)",
        ],
    }
    if not DIST_DIR.joinpath("index.html").exists():
        report["status"] = "BLOCKED"
        report["blocker"] = "dist/ missing: run `npm run build` first."
        write_report(report)
        return 2

    srv = serve_dist()
    app_url = f"http://localhost:{srv.server_address[1]}/"
    app_origin = f"http://localhost:{srv.server_address[1]}"
    report["app_url_origin"] = app_origin

    requests: list[dict[str, Any]] = []
    console: list[str] = []
    phase = {"name": "init"}

    def is_external(url: str) -> bool:
        return not (url.startswith(app_origin) or url.startswith("data:") or url.startswith("blob:") or url == "about:blank")

    try:
        with sync_playwright() as p:
            try:
                ctx = p.chromium.launch_persistent_context(
                    user_data_dir=str(PROFILE_DIR), executable_path=CHROME, headless=False, env=clean_chrome_env(),
                    viewport={"width": 1280, "height": 900}, ignore_default_args=IGNORE_DEFAULT_ARGS, args=CHROME_ARGS,
                )
            except Exception as exc:  # noqa: BLE001
                report["status"] = "BLOCKED"
                report["blocker"] = f"Chrome failed to launch with the probe profile: {str(exc)[:600]}"
                write_report(report)
                return 2

            page = ctx.new_page()
            cdp = ctx.new_cdp_session(page)
            cdp.send("Network.enable")
            cdp.on("Network.requestWillBeSent", lambda ev: requests.append({
                "phase": phase["name"], "url": ev.get("request", {}).get("url", "")[:300],
                "method": ev.get("request", {}).get("method", ""),
            }))
            page.on("console", lambda m: console.append(m.text[:300]))

            page.goto(app_url, wait_until="networkidle")
            time.sleep(1.5)
            avail_js = """async () => {
                    if (!('LanguageModel' in self)) return 'no-api';
                    return await Promise.race([LanguageModel.availability(), new Promise(r => setTimeout(() => r('HANG_GT_10S'), 10000))]);
                }"""
            avail = page.evaluate(avail_js)
            wait_t0 = time.time()
            availability_trace = [avail]
            while avail in ("downloading", "downloadable") and time.time() - wait_t0 < MODEL_WAIT_S:
                time.sleep(15)
                avail = page.evaluate(avail_js)
                availability_trace.append(avail)
            report["availability_wait_s"] = round(time.time() - wait_t0, 1)
            report["availability_trace"] = availability_trace[-6:]
            if avail == "available":
                page.reload(wait_until="networkidle")
                time.sleep(1.5)
            badge = page.text_content('[data-testid="nano-readiness-badge"]')
            report["runtime_readiness"] = {
                "language_model_availability": avail,
                "app_readiness_badge": badge,
                "device_ai_status_text": page.text_content('[data-testid="device-ai-status"]'),
            }
            model_ready = avail == "available" and badge == "READY_ON_DEVICE"
            report["model_ready"] = model_ready
            if not model_ready:
                internals = ""
                try:
                    diag = ctx.new_page()
                    diag.goto("chrome://on-device-internals")
                    time.sleep(5)
                    internals = diag.evaluate(
                        """() => { function w(r){let o="";for(const n of r.childNodes){if(n.nodeType===3)o+=n.textContent+" ";else if(n.nodeType===1){if(n.shadowRoot)o+=w(n.shadowRoot)+" ";o+=w(n)+" ";}}return o.replace(/\\s+/g," ").trim();} return w(document.body); }"""
                    )
                    diag.close()
                except Exception as exc:  # noqa: BLE001
                    internals = f"could not read chrome://on-device-internals: {exc}"
                report["blocker"] = (
                    f"On-device model NOT usable in this Chrome: LanguageModel.availability()={avail!r}, app badge={badge!r}. "
                    "Gemma 4 weights.bin is present in the profile, but Chrome did not expose it. Everything under "
                    "'samples_online'/'offline_run' below is therefore the DETERMINISTIC FALLBACK path, NOT on-device model results."
                )
                report["blocker_diagnostics"] = {
                    "chrome_version_now": chrome_version(),
                    "previous_working_run": "evidence/phase2-nano-runtime-matrix.json (Chrome 156.0.8078.47, availability='available', gemma4_gpu_low_tier_model loaded)",
                    "on_device_internals_text_excerpt": internals[:900],
                    "interpretation": (
                        "chrome://on-device-internals never leaves 'Device performance class: Loading...' and its mojo pipe errors, "
                        "i.e. the model broker did not initialize after Chrome updated 156 -> 158 on this machine."
                    ),
                    "manual_attempts_2026_11_22": [
                        "Same feature flags as phase2 (BypassPerfRequirement etc.): unavailable",
                        "Plus OptimizationGuideModelExecution/OptimizationGuideOnDeviceModel: unavailable",
                        "Dropping Playwright's --disable-field-trial-config: unavailable",
                        "Pasting the OptGuideManifestModel/<pubkey>/2026.8.7.929 dir into internals 'Model directory -> Load': no effect (page not responding)",
                    ],
                    "suggested_user_actions": [
                        "Open chrome://on-device-internals in the profile and check Broker State / Model Status",
                        "Re-run probes/install_chrome_on_device_model.py (will not re-download if weights exist) and check whether Chrome 158 expects a newer gemma4_component version",
                        "Or pin/downgrade to the Chrome build that worked (156.0.8078.47) for the demo recording",
                    ],
                }

            samples_out: dict[str, Any] = {}
            # ---- local steps, online ----
            for smp in SAMPLES:
                phase["name"] = f"online:{smp['id']}"
                page.goto(app_url, wait_until="networkidle")
                time.sleep(0.8)
                before = len(requests)
                t0 = time.perf_counter()
                page.click(f'[data-testid="{smp["id"]}"]')
                try:
                    page.wait_for_selector("#panel-2:not([hidden])", timeout=INGEST_TIMEOUT_S * 1000)
                    ok = True
                except Exception:  # noqa: BLE001
                    ok = False
                ingest_s = round(time.perf_counter() - t0, 2)
                ents = summarize_entities(page)
                ext_new = [r for r in requests[before:] if is_external(r["url"])]
                samples_out[smp["id"]] = {
                    "label": smp["label"],
                    "import_to_review_completed": ok,
                    "ingest_plus_on_device_extraction_latency_s": ingest_s,
                    "entities": ents,
                    "on_device_model_contributed_entities": ents["by_source"].get("NANO_ON_DEVICE", 0) > 0,
                    "external_requests_during_local_steps": ext_new,
                }

                # Review -> Approve, still local. Hide all suggestions, continue, then try the cloud path BEFORE approval.
                if ok:
                    acc = page.locator('[data-testid="btn-accept-all"]')
                    if acc.is_visible():
                        acc.click()
                        time.sleep(0.4)
                    page.click('[data-testid="btn-review-continue"]')
                    page.wait_for_selector("#panel-3:not([hidden])")
                    mode_default = page.input_value('[data-testid="privacy-mode-select"]')
                    page.select_option('[data-testid="privacy-mode-select"]', "HYBRID_ANONYMIZED")
                    cloud_before = len(requests)
                    gate = page.evaluate(
                        """async () => {
                            const c = window.__clauseguardController;
                            let blocked = false, err = null;
                            try { await c.runApprovedCloudAnalysis({ allowSimulatedCloud: false }); }
                            catch (e) { blocked = true; err = String(e).slice(0, 200); }
                            return { blocked, err, approval_state: c.approvalMachine.getSnapshot().state, findings: c.findings.length };
                        }"""
                    )
                    cloud_btn_hidden = page.locator('[data-testid="btn-analyze-cloud"]').is_hidden()
                    approve_disabled_no_consent = page.is_disabled('[data-testid="btn-approve-payload"]')
                    samples_out[smp["id"]]["cloud_gate_before_approval"] = {
                        "default_privacy_mode": mode_default,
                        "run_cloud_call_rejected": gate["blocked"],
                        "error": gate["err"],
                        "approval_state": gate["approval_state"],
                        "findings_created": gate["findings"],
                        "analyze_cloud_button_hidden": cloud_btn_hidden,
                        "approve_button_disabled_until_consent": approve_disabled_no_consent,
                        "external_requests_during_gate_probe": [r for r in requests[cloud_before:] if is_external(r["url"])],
                    }
                    # on-device clause triage latency (local-only, step 3 -> 4)
                    tri0 = time.perf_counter()
                    page.click('[data-testid="btn-local-triage"]')
                    try:
                        page.wait_for_selector("#panel-4:not([hidden])", timeout=INGEST_TIMEOUT_S * 1000)
                        tri_ok = True
                    except Exception:  # noqa: BLE001
                        tri_ok = False
                    tri_s = round(time.perf_counter() - tri0, 2)
                    fin = page.evaluate("window.__clauseguardController.findings.map(f => ({source: f.analysisSource, observed: f.observedInferenceSource, severity: f.severity}))")
                    samples_out[smp["id"]]["local_clause_triage"] = {"completed": tri_ok, "latency_s": tri_s, "findings": fin}
                    samples_out[smp["id"]]["external_requests_total_all_local_steps"] = [r for r in requests if r["phase"] == phase["name"] and is_external(r["url"])]

            report["samples_online"] = samples_out

            # ---- offline run: page already loaded; cut the network then import in-page ----
            phase["name"] = "offline"
            page.goto(app_url, wait_until="networkidle")
            time.sleep(0.8)
            ctx.set_offline(True)
            off_before = len(requests)
            t0 = time.perf_counter()
            page.click('[data-testid="sample-tenant-lease"]')
            try:
                page.wait_for_selector("#panel-2:not([hidden])", timeout=INGEST_TIMEOUT_S * 1000)
                off_ok = True
            except Exception:  # noqa: BLE001
                off_ok = False
            off_s = round(time.perf_counter() - t0, 2)
            off_ents = summarize_entities(page)
            online_flag = page.evaluate("navigator.onLine")
            off_new = [r for r in requests[off_before:] if is_external(r["url"])]
            ctx.set_offline(False)
            report["offline_run"] = {
                "navigator_onLine_during_run": online_flag,
                "sample": "sample-tenant-lease",
                "import_to_review_completed": off_ok,
                "latency_s": off_s,
                "entities": off_ents,
                "on_device_model_contributed_entities": off_ents["by_source"].get("NANO_ON_DEVICE", 0) > 0,
                "external_requests": off_new,
            }

            report["console_messages_sample"] = [m for m in console if "LanguageModel" in m or "firebase" in m.lower()][:5]
            ctx.close()
    finally:
        srv.shutdown()

    all_external = [r for r in requests if is_external(r["url"])]
    report["total_page_requests_observed"] = len(requests)
    report["external_requests_all_phases"] = all_external
    checks = {
        "on_device_runtime_ready": report["runtime_readiness"]["app_readiness_badge"] == "READY_ON_DEVICE",
        "on_device_inference_ran_both_samples": all(
            s["entities"]["last_local_sdk_source"] == "on_device" for s in samples_out.values()
        ),
        # Informational, not a pass/fail gate: Gemma may legitimately add nothing beyond the deterministic detectors
        # (or its finds overlap them and are de-duplicated). Recall is not benchmarked here.
        "on_device_model_added_entities_per_sample": {
            k: len(s["entities"]["nano_entities"]) for k, s in samples_out.items()
        },
        "zero_external_requests_all_phases": len(all_external) == 0,
        "cloud_blocked_until_approval_both_samples": all(
            s.get("cloud_gate_before_approval", {}).get("run_cloud_call_rejected") for s in samples_out.values()
        ),
        "offline_run_completed_with_zero_requests": report["offline_run"]["import_to_review_completed"]
        and not report["offline_run"]["external_requests"],
        "offline_run_used_on_device_model": report["offline_run"]["on_device_model_contributed_entities"],
    }
    report["checks"] = checks
    if not report.get("model_ready"):
        report["status"] = "BLOCKED_ON_DEVICE_MODEL_UNAVAILABLE"
        report["evidence_class"] = "FALLBACK_PATH_ONLY_ON_REAL_CHROME (on-device model unavailable; on-device results NOT proven)"
        fallback_checks = {
            k: v for k, v in checks.items()
            if k in ("zero_external_requests_all_phases", "cloud_blocked_until_approval_both_samples")
        }
        fallback_checks["offline_run_completed_with_zero_requests"] = checks["offline_run_completed_with_zero_requests"]
        report["fallback_path_checks"] = fallback_checks
        write_report(report)
        return 2
    gates = {k: v for k, v in checks.items() if isinstance(v, bool)}
    report["status"] = "PASS" if all(gates.values()) else "PARTIAL_OR_FAIL"
    write_report(report)
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(run())
