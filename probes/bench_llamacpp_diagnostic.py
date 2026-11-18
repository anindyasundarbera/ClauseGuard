#!/usr/bin/env python3
"""ClauseGuard Hybrid — Separated llama.cpp Local SLM Diagnostic Benchmark.

IMPORTANT GOVERNANCE & COMPLIANCE BOUNDARY:
- `diagnostic_only_not_competition_nano_path = True`
- Evaluates local GGUF inference (`Qwen2.5-1.5B-Instruct-Q4_K_M` and `gemma-3-270m-it-Q8_0`)
  strictly via `llama.cpp` (`llama-cli`) as a comparative local baseline vs. ClauseGuard's
  deterministic regex/graph extractor (`ARCH-RET-4.1`).
- Ollama is NOT installed on this workstation and is NOT used anywhere.
- This diagnostic script MUST NEVER be counted as Web/Chrome Gemini Nano compliance (`R-12`).
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
LLAMA_RUNTIME_DIR = (Path.home() / ".local/share/nano-workaround/runtime")
LLAMA_CLI = LLAMA_RUNTIME_DIR / "llama-cli"
MODELS_DIR = (Path.home() / ".local/share/nano-workaround/models")
OUT_PATH = ROOT / "research" / "evidence" / "clauseguard-mvp" / "llamacpp-diagnostic-comparison.json"

SYSTEM_PROMPT = (
    "Extract only proper-noun organizations (ORG), people (PERSON), and project codenames (CODENAME) "
    "from the contract clause. Return strictly a JSON array of objects with keys v and t. No markdown."
)

SAMPLE_CLAUSES = [
    {
        "id": "SYNTH-CLAUSE-1",
        "text": (
            "1. PARTIES AND SCOPE. This Master Supply Agreement is entered into by "
            "Meridian Precision Robotics GmbH (Supplier) and Zenith Biologics GmbH (Customer), "
            "superseding negotiations led by Dr. Lukas Weber and Clara Vance for Project Nightingale."
        ),
        "expected": [
            "Meridian Precision Robotics GmbH",
            "Zenith Biologics GmbH",
            "Dr. Lukas Weber",
            "Clara Vance",
            "Project Nightingale",
        ],
    },
    {
        "id": "SYNTH-CLAUSE-2",
        "text": (
            "14. SUBCONTRACTING. Supplier may engage Helios Cryo Systems Ltd solely for cleanroom "
            "calibration under the supervision of Elena Rostova at the Basel BioPark campus."
        ),
        "expected": [
            "Helios Cryo Systems Ltd",
            "Elena Rostova",
            "Basel BioPark",
        ],
    },
]

MODELS = [
    ("Qwen2.5-1.5B-Instruct-Q4_K_M", MODELS_DIR / "Qwen2.5-1.5B-Instruct-Q4_K_M.gguf"),
    ("gemma-3-270m-it-Q8_0", MODELS_DIR / "gemma-3-270m-it-Q8_0.gguf"),
]


def extract_json_array(raw_text: str) -> list[dict]:
    match = re.search(r"\[[\s\S]*\]", raw_text)
    if not match:
        return []
    try:
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, list) else []
    except json.JSONDecodeError:
        return []


def run_model_on_clause(model_path: Path, clause_text: str) -> dict:
    env = os.environ.copy()
    existing_ld = env.get("LD_LIBRARY_PATH", "")
    env["LD_LIBRARY_PATH"] = (
        f"{LLAMA_RUNTIME_DIR}:{existing_ld}" if existing_ld else str(LLAMA_RUNTIME_DIR)
    )
    cmd = [
        str(LLAMA_CLI),
        "-m",
        str(model_path),
        "-sys",
        SYSTEM_PROMPT,
        "-p",
        f"Clause:\n{clause_text}\nJSON:",
        "-n",
        "192",
        "-c",
        "1024",
        "--temp",
        "0",
        "--single-turn",
        "--simple-io",
        "--no-warmup",
        "--no-show-timings",
    ]
    t0 = time.perf_counter()
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        env=env,
        timeout=120,
        stdin=subprocess.DEVNULL,
    )
    elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 2)
    parsed = extract_json_array(proc.stdout)
    return {
        "returncode": proc.returncode,
        "latency_ms": elapsed_ms,
        "valid_json_array": len(parsed) > 0,
        "extracted": parsed,
        "raw_output_excerpt": proc.stdout[-500:] if proc.stdout else "",
        "stderr_tail": proc.stderr[-250:] if proc.stderr else "",
    }


def score_extraction(expected: list[str], extracted: list[dict]) -> dict:
    extracted_vals = [str(item.get("v", "")).strip() for item in extracted if isinstance(item, dict)]
    matched = [exp for exp in expected if any(exp.lower() in val.lower() or val.lower() in exp.lower() for val in extracted_vals)]
    false_positives = [val for val in extracted_vals if val and not any(exp.lower() in val.lower() or val.lower() in exp.lower() for exp in expected)]
    recall = round(len(matched) / len(expected), 4) if expected else 1.0
    precision = round(len(matched) / (len(matched) + len(false_positives)), 4) if (matched or false_positives) else 0.0
    return {
        "expected_count": len(expected),
        "matched_count": len(matched),
        "false_positive_count": len(false_positives),
        "precision": precision,
        "recall": recall,
        "matched": matched,
        "false_positives": false_positives,
    }


def main() -> int:
    if not LLAMA_CLI.exists():
        raise FileNotFoundError(f"llama-cli not found at {LLAMA_CLI}")

    report = {
        "benchmark_id": "CG-LLAMACPP-DIAGNOSTIC-001",
        "executed_at_utc": datetime.now(timezone.utc).isoformat(),
        "diagnostic_only_not_competition_nano_path": True,
        "ollama_installed": False,
        "runtime_binary": str(LLAMA_CLI),
        "results": [],
    }

    for model_name, model_path in MODELS:
        if not model_path.exists():
            report["results"].append({"model": model_name, "status": "MISSING", "path": str(model_path)})
            continue
        clause_runs = []
        total_expected = 0
        total_matched = 0
        total_fp = 0
        total_latency = 0.0
        for clause in SAMPLE_CLAUSES:
            run = run_model_on_clause(model_path, clause["text"])
            scores = score_extraction(clause["expected"], run["extracted"])
            total_expected += scores["expected_count"]
            total_matched += scores["matched_count"]
            total_fp += scores["false_positive_count"]
            total_latency += run["latency_ms"]
            clause_runs.append(
                {
                    "clause_id": clause["id"],
                    "run": run,
                    "scores": scores,
                }
            )
        agg_precision = round(total_matched / (total_matched + total_fp), 4) if (total_matched + total_fp) else 0.0
        agg_recall = round(total_matched / total_expected, 4) if total_expected else 1.0
        report["results"].append(
            {
                "model": model_name,
                "model_file": model_path.name,
                "size_bytes": model_path.stat().st_size,
                "status": "EXECUTED",
                "aggregate": {
                    "matched": total_matched,
                    "expected": total_expected,
                    "false_positives": total_fp,
                    "precision": agg_precision,
                    "recall": agg_recall,
                    "total_latency_ms": round(total_latency, 2),
                },
                "clauses": clause_runs,
            }
        )

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
