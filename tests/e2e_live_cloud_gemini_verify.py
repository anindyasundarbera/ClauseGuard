#!/usr/bin/env python3
"""LIVE cloud proof: one real Firebase AI Logic -> Gemini call through the four-step UI.

Nothing is mocked. The script:
  1. builds the app with your `.env.local` (live Firebase web config + a localhost App Check debug token)
     into a throwaway folder (`.cg-live-cloud-build/`, deleted afterwards, never `dist/`), so a debug
     token is never baked into a build you might deploy;
  2. serves it on http://localhost:<port> and drives it in Chromium: import the synthetic `sample-msa-trap`
     contract, hide every suggested item, choose "send the cleaned text", tick consent, approve the exact
     payload, then run the deeper check with the local simulation switched OFF;
  3. records every request the page makes to an external host, the exact body of the generateContent call,
     the Gemini response metadata, and the app's own state, into `evidence/live-cloud-gemini-run.json`
     plus a screenshot of the results step.

Secrets are never written: query strings (API key) and request headers (App Check token) are dropped, and
UUID-shaped strings (debug tokens) are scrubbed from console lines. The Firebase web config values are public
identifiers, but only the project id is recorded.

Exit codes: 0 PASS, 1 ran but a check failed, 2 blocked before a cloud call could be made (reason in the JSON).

Usage:
    python3 tests/e2e_live_cloud_gemini_verify.py [--headed] [--model gemini-3.5-flash-lite] [--chrome /path/to/chrome]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import platform
import re
import shutil
import subprocess
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BUILD_DIR = PROJECT_ROOT / ".cg-live-cloud-build"
ENV_LOCAL = PROJECT_ROOT / ".env.local"
OUT_JSON = PROJECT_ROOT / "evidence" / "live-cloud-gemini-run.json"
OUT_PNG = PROJECT_ROOT / "evidence" / "live-cloud-gemini-results.png"
SAMPLE_ID = "sample-msa-trap"
REQUIRED_ENV = [
    "VITE_FIREBASE_API_KEY",
    "VITE_FIREBASE_AUTH_DOMAIN",
    "VITE_FIREBASE_PROJECT_ID",
    "VITE_FIREBASE_STORAGE_BUCKET",
    "VITE_FIREBASE_MESSAGING_SENDER_ID",
    "VITE_FIREBASE_APP_ID",
    "VITE_FIREBASE_APPCHECK_DEBUG_TOKEN",
]
UUID_RE = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
CLOUD_TIMEOUT_S = 120


def read_env_local() -> dict[str, str]:
    out: dict[str, str] = {}
    if not ENV_LOCAL.exists():
        return out
    for line in ENV_LOCAL.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*(.*)$", line)
        if m:
            out[m.group(1)] = m.group(2).strip().strip("'\"")
    return out


def scrub(text: str) -> str:
    return UUID_RE.sub("<uuid-redacted>", text)


def safe_url(url: str) -> str:
    """Host + path only: drops the query string, which can carry the API key."""
    p = urlsplit(url)
    return f"{p.scheme}://{p.netloc}{p.path}"


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def prompt_text(body: str) -> str:
    """All text parts of a generateContent request body, joined (falls back to the raw body)."""
    try:
        j = json.loads(body)
        return "\n".join(part.get("text", "") for c in j.get("contents", []) for part in c.get("parts", []))
    except Exception:  # noqa: BLE001
        return body


def write_report(report: dict[str, Any]) -> None:
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    text = scrub(json.dumps(report, indent=2, ensure_ascii=False))
    OUT_JSON.write_text(text + "\n", encoding="utf-8")
    print(text)
    print(f"\nWrote {OUT_JSON.relative_to(PROJECT_ROOT)}")


def serve(directory: Path) -> ThreadingHTTPServer:
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a: Any) -> None:
            return

        def do_GET(self) -> None:  # noqa: N802
            rel = self.path.split("?", 1)[0].lstrip("/") or "index.html"
            target = (directory / rel).resolve()
            if not str(target).startswith(str(directory.resolve())) or not target.is_file():
                target = directory / "index.html"
            data = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(str(target))[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def build_app(model: str) -> tuple[bool, str]:
    env_args = ["npx", "vite", "build", "--outDir", str(BUILD_DIR), "--emptyOutDir"]
    env = dict(os.environ)
    env["VITE_FIREBASE_CLOUD_MODEL"] = model
    try:
        res = subprocess.run(env_args, cwd=PROJECT_ROOT, env=env, capture_output=True, text=True, timeout=600)
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)[:600]
    tail = (res.stdout + res.stderr)[-1200:]
    return res.returncode == 0 and (BUILD_DIR / "index.html").exists(), scrub(tail)


def run(args: argparse.Namespace) -> int:
    report: dict[str, Any] = {
        "verification_id": "CG-LIVE-CLOUD-GEMINI-RUN",
        "evidence_class": "LIVE_CLOUD (real Firebase AI Logic ONLY_IN_CLOUD -> Gemini Developer API; nothing simulated)",
        "ui_flow": "four-step (Import, Review, Approve, Results), driven through the real buttons",
        "executed_at_utc": datetime.now(timezone.utc).isoformat(),
        "host": {"os": platform.platform()},
        "sample": SAMPLE_ID,
        "requested_model": args.model,
        "secrets_policy": "No API key, App Check token or debug token is recorded: query strings and headers are dropped and UUIDs are scrubbed.",
    }

    env = read_env_local()
    missing = [k for k in REQUIRED_ENV if not env.get(k)]
    if missing:
        report["status"] = "BLOCKED"
        report["blocker"] = f".env.local is missing values for: {', '.join(missing)} (see docs/live-cloud-run.md)."
        write_report(report)
        return 2
    if env["VITE_FIREBASE_APPCHECK_DEBUG_TOKEN"] == "true":
        report["status"] = "BLOCKED"
        report["blocker"] = (
            "VITE_FIREBASE_APPCHECK_DEBUG_TOKEN is 'true', which makes a new token every run that the console does not know. "
            "Pin a registered debug token UUID in .env.local (see docs/live-cloud-run.md step 2)."
        )
        write_report(report)
        return 2
    report["firebase_project_id"] = env["VITE_FIREBASE_PROJECT_ID"]

    ok, build_log = build_app(args.model)
    if not ok:
        report["status"] = "BLOCKED"
        report["blocker"] = "Build failed."
        report["build_log_tail"] = build_log
        write_report(report)
        return 2

    srv = serve(BUILD_DIR)
    origin = f"http://localhost:{srv.server_address[1]}"
    report["app_url_origin"] = origin
    phase = {"name": "load"}
    external: list[dict[str, Any]] = []
    generate_calls: list[dict[str, Any]] = []
    console: list[str] = []

    def is_external(url: str) -> bool:
        return not (url.startswith(origin) or url.startswith(("data:", "blob:", "about:", "chrome-extension:")))

    def on_request(req: Any) -> None:
        if is_external(req.url):
            external.append({"phase": phase["name"], "method": req.method, "url": safe_url(req.url)})

    def on_response(resp: Any) -> None:
        url = resp.url
        if not is_external(url) or ":generateContent" not in url:
            return
        entry: dict[str, Any] = {
            "phase": phase["name"],
            "url": safe_url(url),
            "method": resp.request.method,
            "http_status": resp.status,
            "request_body": resp.request.post_data or "",
        }
        try:
            entry["response_body"] = resp.text()
        except Exception as exc:  # noqa: BLE001
            entry["response_body_error"] = str(exc)[:300]
        generate_calls.append(entry)

    try:
        with sync_playwright() as p:
            launch_kwargs: dict[str, Any] = {"headless": not args.headed}
            if args.chrome:
                launch_kwargs["executable_path"] = args.chrome
            browser = p.chromium.launch(**launch_kwargs)
            report["host"]["browser"] = f"{browser.browser_type.name} {browser.version}"
            ctx = browser.new_context(viewport={"width": 1280, "height": 900})
            page = ctx.new_page()
            page.on("request", on_request)
            page.on("response", on_response)
            page.on("console", lambda m: console.append(scrub(m.text[:300])))

            page.goto(origin + "/", wait_until="networkidle")
            time.sleep(1.0)
            boot = page.evaluate(
                """() => { const c = window.__clauseguardController; const cfg = c.firebaseConfig || {};
                    return { live: Boolean(cfg.apiKey && cfg.projectId && cfg.appId), project: cfg.projectId || null,
                             debug: cfg.debugAppCheckToken !== undefined && cfg.debugAppCheckToken !== false,
                             app_check_badge: document.querySelector('[data-testid=appcheck-status-badge]').textContent }; }"""
            )
            report["boot"] = {k: v for k, v in boot.items() if k != "debug"} | {"debug_app_check_configured": boot["debug"]}
            report["external_requests_at_boot"] = list(external)
            if not boot["live"] or not boot["debug"]:
                report["status"] = "BLOCKED"
                report["blocker"] = "The built app did not pick up a live Firebase config with a localhost debug token."
                write_report(report)
                return 2

            # Step 1 -> 2: import the synthetic MSA (local only)
            phase["name"] = "local_steps"
            page.click(f'[data-testid="{SAMPLE_ID}"]')
            page.wait_for_selector("#panel-2:not([hidden])", timeout=240_000)
            acc = page.locator('[data-testid="btn-accept-all"]')
            if acc.is_visible():
                acc.click()
                time.sleep(0.3)
            page.click('[data-testid="btn-review-continue"]')
            page.wait_for_selector("#panel-3:not([hidden])")

            # Step 3: send-the-cleaned-text mode, simulation OFF, consent, approve
            page.select_option('[data-testid="privacy-mode-select"]', "HYBRID_ANONYMIZED")
            page.evaluate("() => { const s = document.getElementById('chk-sim-cloud'); s.checked = false; s.dispatchEvent(new Event('change')); }")
            page.check('[data-testid="chk-explicit-consent"]')
            page.click('[data-testid="btn-approve-payload"]')
            page.wait_for_selector('[data-testid="btn-analyze-cloud"]:not([hidden])')
            approved = page.evaluate(
                """() => { const c = window.__clauseguardController; const s = c.approvalMachine.getSnapshot();
                    return { state: s.state, sha: s.approvedPayloadSha256, payload: s.approvedBrandPayload,
                             surfaces: Object.values(c.redaction.tokenToSurface || {}),
                             placeholders: c.redaction.entries.length, local_source: c.localInferenceSource }; }"""
            )
            external_before_approval_click = [r for r in external if r["phase"] == "local_steps"]

            # Step 3 -> 4: the one real cloud call
            phase["name"] = "approved_cloud_call"
            t0 = time.perf_counter()
            page.click('[data-testid="btn-analyze-cloud"]')
            try:
                # Stop at whichever comes first: the results step, or the app's own error banner.
                page.wait_for_function(
                    """() => !document.getElementById('panel-4').hidden
                           || !document.querySelector('[data-testid=error-box]').hidden""",
                    timeout=CLOUD_TIMEOUT_S * 1000,
                )
            except Exception:  # noqa: BLE001
                pass
            reached_results = page.locator("#panel-4").is_visible()
            latency_s = round(time.perf_counter() - t0, 2)
            time.sleep(0.5)
            state = page.evaluate(
                """() => { const c = window.__clauseguardController;
                    return { cloud_inference_source: c.cloudInferenceSource, last_cloud_sdk_source: c.lastCloudSdkSource,
                             app_check_status: c.appCheckStatus, firebase_init_sequence: c.firebaseInitSequence,
                             model_used: c.selectedCloudModel,
                             approval_state_after: c.approvalMachine.getSnapshot().state,
                             error_box: document.querySelector('[data-testid=error-box]').hidden ? null
                                        : document.querySelector('[data-testid=error-box]').textContent,
                             findings: c.findings.map(f => ({ severity: f.severity, title: f.title, clauseRefs: f.clauseRefs,
                                 anonymizedExcerpt: f.anonymizedExcerpt, rationale: f.rationale,
                                 analysisSource: f.analysisSource, observedInferenceSource: f.observedInferenceSource,
                                 modelUsed: f.modelUsed })),
                             privacy_report: c.getPrivacyReport16() }; }"""
            )
            if reached_results:
                page.screenshot(path=str(OUT_PNG), full_page=True)
            browser.close()
    finally:
        srv.shutdown()
        if not args.keep_build:
            shutil.rmtree(BUILD_DIR, ignore_errors=True)

    # ---- assemble evidence ----
    payload = approved["payload"] or ""
    call_records = []
    for c in generate_calls:
        body = c["request_body"]
        leaks = sorted({s for s in approved["surfaces"] if s and s.lower() in body.lower()})
        rec: dict[str, Any] = {
            "url": c["url"],
            "method": c["method"],
            "http_status": c["http_status"],
            "request_body_sha256": sha256(body),
            "request_body_bytes": len(body.encode("utf-8")),
            "request_contains_exact_approved_payload": bool(payload) and payload in prompt_text(body),
            "request_contains_approved_sha": bool(approved["sha"]) and approved["sha"] in body,
            "raw_values_found_in_request": leaks,
        }
        try:
            rec["request_body"] = json.loads(body)
        except Exception:  # noqa: BLE001
            rec["request_body_text"] = body[:4000]
        try:
            rj = json.loads(c.get("response_body", ""))
            rec["response"] = {
                "modelVersion": rj.get("modelVersion"),
                "responseId": rj.get("responseId"),
                "usageMetadata": rj.get("usageMetadata"),
                "finishReason": (rj.get("candidates") or [{}])[0].get("finishReason"),
                "candidate_text": "".join(
                    part.get("text", "") for part in ((rj.get("candidates") or [{}])[0].get("content", {}).get("parts") or [])
                ),
                "error": rj.get("error"),
            }
        except Exception:  # noqa: BLE001
            rec["response_body_text"] = (c.get("response_body") or c.get("response_body_error") or "")[:2000]
        call_records.append(rec)

    hosts_after_approval = sorted({urlsplit(r["url"]).netloc for r in external if r["phase"] == "approved_cloud_call"})
    report["approval"] = {
        "state_before_call": approved["state"],
        "approved_payload_sha256": approved["sha"],
        "approved_payload_sha256_recomputed": sha256(payload),
        "placeholders": approved["placeholders"],
        "local_inference_source": approved["local_source"],
        "approved_payload": payload,
    }
    report["cloud_call"] = {"reached_results_step": reached_results, "latency_s": latency_s} | {
        k: v for k, v in state.items() if k not in ("findings", "privacy_report")
    }
    report["generate_content_calls"] = call_records
    report["findings"] = state["findings"]
    report["privacy_report"] = state["privacy_report"]
    report["external_requests_before_approval_click"] = external_before_approval_click
    report["external_hosts_during_cloud_step"] = hosts_after_approval
    report["external_requests_during_cloud_step"] = [r for r in external if r["phase"] == "approved_cloud_call"]
    report["console_firebase_lines"] = [m for m in console if "firebase" in m.lower() or "app check" in m.lower()][:10]

    ok_calls = [c for c in call_records if c["http_status"] == 200]
    checks = {
        "no_external_request_before_approval": len(external_before_approval_click) == 0,
        "approved_sha_matches_payload": approved["sha"] == sha256(payload),
        "real_generate_content_call_http_200": len(ok_calls) >= 1,
        "call_went_to_google_endpoint": all(urlsplit(c["url"]).netloc.endswith(".googleapis.com") for c in call_records)
        and bool(call_records),
        "request_body_is_exact_approved_payload": all(c["request_contains_exact_approved_payload"] for c in ok_calls) and bool(ok_calls),
        "no_raw_values_in_any_request": all(not c["raw_values_found_in_request"] for c in call_records),
        "sdk_reported_in_cloud": state["last_cloud_sdk_source"] == "in_cloud",
        "app_check_attested": state["app_check_status"] == "ATTESTATION_VERIFIED",
        "findings_from_real_cloud": bool(state["findings"])
        and all(f["analysisSource"] == "FIREBASE_AI_LOGIC_ONLY_IN_CLOUD" for f in state["findings"]),
        "results_step_reached": reached_results,
    }
    report["checks"] = checks
    report["status"] = "PASS" if all(checks.values()) else "FAIL"
    write_report(report)
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--headed", action="store_true", help="show the browser window")
    ap.add_argument("--model", default="gemini-3.5-flash-lite",
                    choices=["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-4-hydrogen"])
    ap.add_argument("--chrome", default=None, help="path to a Chrome binary (default: Playwright's Chromium)")
    ap.add_argument("--keep-build", action="store_true", help="keep .cg-live-cloud-build/ for debugging")
    raise SystemExit(run(ap.parse_args()))
