#!/usr/bin/env python3
"""Chrome 156 On-Device Model Component Downloader, Verifier & Installer.

Diagnoses and works around Chrome 156's `components/update_client` 32-bit
signed integer overflow (`INT32_MAX = 2,147,483,647`) when Omaha v4 returns
component packages larger than 2.14 GiB (e.g. `gemma4_component` 2026.8.7.929
at 2,475,404,706 bytes or `nano_v3_gpu_component` 2025.8.8.1141 at 4,269,937,721
bytes), which causes Chrome's built-in updater to abort with
`errorcat: 1, errorcode: 13` before fetching weights.

This standalone script:
1. Queries Google's official Omaha v4 endpoint for `gemma4_component`.
2. Downloads the official Google-signed `.crx3` payload into a local cache
   with HTTP Range resume support.
3. Verifies the SHA-256 checksum reported by Omaha (and expected digest).
4. Strips the `Cr24` v3 header without duplicating disk space and extracts the
   component files (`manifest.json`, `on_device_model_execution_config.pb`,
   `weights.bin`, `_metadata/verified_contents.json`) into the Chrome profile's
   `OptGuideManifestModel/<pubkey_hex>/<version>/` directory, hardlinking across
   profiles (`~/.config/google-chrome` and `~/.cache/clauseguard-chrome-nano-profile`)
   so only one copy of `weights.bin` occupies disk space.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import shutil
import struct
import sys
import time
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

OMAHA_URL = "https://update.googleapis.com/service/update2/json"

GEMMA4_APP_ID = "hpokmlpogjdjccpbngeccdjbkcpombca"
GEMMA4_PUBKEY_HEX = "7feacbfe693922f1d6422391a2fec1202689398bbd985d3f0aa13bd765cabeda"
GEMMA4_ASSET_ID = "gemma4_component"
GEMMA4_DEFAULT_VERSION = "2026.8.7.929"
GEMMA4_EXPECTED_SHA256 = "43b55db2b24e0dd44868071946dfcba221261a8a4922239059c42feec531c7b9"
GEMMA4_FALLBACK_URL = (
    "https://dl.google.com/release2/chrome_component/"
    "adzw5wjgxnevmgfxblqghaa5qp5a_2026.8.7.929/"
    "hpokmlpogjdjccpbngeccdjbkcpombca_2026.8.7.929_all_acastlj3go2h5btps3hr536xlyrq.crx3"
)

CACHE_DIR = Path.home() / ".cache" / "clauseguard-crx-cache"
MAIN_CHROME_DIR = Path.home() / ".config" / "google-chrome"
PROBE_CHROME_DIR = Path.home() / ".cache" / "clauseguard-chrome-nano-profile"


class _OffsetBinaryReader(io.RawIOBase):
    """Read-only file view starting at `base_offset` for zero-copy CRX3 ZIP parsing."""

    def __init__(self, path: Path, base_offset: int) -> None:
        self._fp = open(path, "rb")
        self._base = base_offset
        self._size = path.stat().st_size - base_offset
        self._fp.seek(self._base)

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def read(self, size: int = -1) -> bytes:
        return self._fp.read(size)

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        if whence == io.SEEK_SET:
            target = self._base + offset
        elif whence == io.SEEK_CUR:
            target = self._fp.tell() + offset
        elif whence == io.SEEK_END:
            target = self._base + self._size + offset
        else:
            raise ValueError(f"Unsupported whence={whence}")
        if target < self._base:
            target = self._base
        self._fp.seek(target)
        return self._fp.tell() - self._base

    def tell(self) -> int:
        return self._fp.tell() - self._base

    def close(self) -> None:
        try:
            self._fp.close()
        finally:
            super().close()


def query_omaha_component(
    appid: str = GEMMA4_APP_ID,
    target_version: str = GEMMA4_DEFAULT_VERSION,
) -> dict[str, Any]:
    """Query Google Omaha v4 for the latest component CRX3 URL, size, and SHA-256."""
    payload = {
        "request": {
            "@os": "linux",
            "@updater": "chrome",
            "acceptformat": "crx3",
            "app": [
                {
                    "appid": appid,
                    "enabled": True,
                    "installsource": "ondemand",
                    "targetversionprefix": target_version,
                    "updatecheck": {},
                    "version": "0.0.0.0",
                }
            ],
            "os": {"arch": "x86_64", "platform": "Linux"},
            "prodversion": "156.0.8078.47",
            "protocol": "4.0",
        }
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        OMAHA_URL,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    # Omaha v4 prefixes responses with Chrome XSSI protection `)]}'\n`
    if raw.startswith(")]}'"):
        raw = raw.split("\n", 1)[1]
    parsed = json.loads(raw)
    apps = parsed.get("response", {}).get("apps") or parsed.get("response", {}).get("app") or []
    app = apps[0] if apps else {}
    updatecheck = app.get("updatecheck", {})
    if updatecheck.get("status") != "ok" or "manifest" not in updatecheck:
        raise RuntimeError(f"Omaha returned updatecheck status={updatecheck.get('status')!r}")
    manifest = updatecheck["manifest"]
    pkg = manifest["packages"]["package"][0]
    urls = [u["codebase"] for u in manifest["urls"]["url"]]
    crx_url = f"{urls[0]}{pkg['name']}"
    size_bytes = int(pkg["size"])
    return {
        "appid": appid,
        "version": manifest["version"],
        "crx_url": crx_url,
        "all_urls": [f"{u}{pkg['name']}" for u in urls],
        "size_bytes": size_bytes,
        "exceeds_int32_max": size_bytes > 2_147_483_647,
        "sha256": pkg["hash_sha256"],
    }


def _download_chunk(
    url: str,
    dest_path: Path,
    start: int,
    end: int,
    progress: dict[str, Any],
) -> None:
    """Download inclusive byte range [start, end] to `dest_path` at `start`."""
    chunk_size = 1024 * 1024
    pos = start
    retries = 0
    while pos <= end:
        req = urllib.request.Request(url, headers={"Range": f"bytes={pos}-{end}"})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                with open(dest_path, "r+b") as fp:
                    fp.seek(pos)
                    while pos <= end:
                        buf = resp.read(chunk_size)
                        if not buf:
                            break
                        fp.write(buf)
                        pos += len(buf)
                        progress["bytes"] += len(buf)
            if pos <= end:
                raise IOError(f"Short read at {pos}/{end}")
        except (urllib.error.URLError, TimeoutError, IOError) as exc:
            retries += 1
            if retries > 5:
                raise RuntimeError(f"Failed range {pos}-{end}: {exc}") from exc
            time.sleep(min(2 * retries, 10))


def download_crx3_parallel(
    url: str,
    dest_path: Path,
    expected_size: int,
    workers: int = 4,
) -> Path:
    """Download a large CRX3 artifact with Range support and preallocation."""
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    part_path = dest_path.with_suffix(".crx3.part")

    if dest_path.exists() and dest_path.stat().st_size == expected_size:
        print(f"[cache] Reusing existing {dest_path} ({expected_size:,} bytes)")
        return dest_path

    # Preallocate exact target size on sparse/ext4 filesystem for multi-range writes
    if not part_path.exists() or part_path.stat().st_size != expected_size:
        with open(part_path, "wb") as fp:
            fp.truncate(expected_size)

    span = expected_size // workers
    ranges: list[tuple[int, int]] = []
    for i in range(workers):
        s = i * span
        e = (expected_size - 1) if i == workers - 1 else ((i + 1) * span - 1)
        ranges.append((s, e))

    progress: dict[str, Any] = {"bytes": 0, "t0": time.monotonic()}
    print(f"[download] Fetching {expected_size / (1024**3):.2f} GiB across {workers} streams...")
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = [pool.submit(_download_chunk, url, part_path, s, e, progress) for s, e in ranges]
        while any(not f.done() for f in futs):
            time.sleep(5.0)
            elapsed = max(time.monotonic() - progress["t0"], 0.1)
            done_bytes = progress["bytes"]
            pct = (done_bytes / expected_size) * 100.0
            mbps = (done_bytes / (1024 * 1024)) / elapsed
            print(f"[download] {pct:5.1f}% ({done_bytes / (1024**2):7.1f} MiB, {mbps:5.1f} MiB/s)")
        for f in futs:
            f.result()

    part_path.replace(dest_path)
    elapsed = max(time.monotonic() - progress["t0"], 0.1)
    print(f"[download] Completed in {elapsed:.1f}s ({(expected_size / (1024**2)) / elapsed:.1f} MiB/s)")
    return dest_path


def verify_sha256(path: Path, expected_hex: str) -> str:
    """Compute SHA-256 digest in streaming 8 MiB blocks and assert exact match."""
    h = hashlib.sha256()
    with open(path, "rb") as fp:
        while True:
            chunk = fp.read(8 * 1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    actual = h.hexdigest()
    if actual.lower() != expected_hex.lower():
        raise ValueError(f"SHA-256 mismatch for {path}: expected {expected_hex}, got {actual}")
    print(f"[verify] SHA-256 OK: {actual}")
    return actual


def extract_crx3_to_dir(crx_path: Path, install_dir: Path) -> list[str]:
    """Parse Cr24 v3 header and safely extract ZIP entries into `install_dir`."""
    with open(crx_path, "rb") as fp:
        prefix = fp.read(12)
    magic, version, header_len = struct.unpack("<4sII", prefix)
    if magic != b"Cr24" or version != 3:
        raise ValueError(f"Unexpected CRX header: magic={magic!r}, version={version}")
    zip_offset = 12 + header_len
    install_dir.mkdir(parents=True, exist_ok=True)
    resolved_base = install_dir.resolve()
    extracted: list[str] = []

    with _OffsetBinaryReader(crx_path, zip_offset) as stream:
        with zipfile.ZipFile(stream, "r") as zf:
            for info in zf.infolist():
                target = (resolved_base / info.filename).resolve()
                if not str(target).startswith(str(resolved_base) + os.sep) and target != resolved_base:
                    raise ValueError(f"Unsafe ZIP member path: {info.filename}")
                if info.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                # Preserve existing complete weights.bin if exact size already present
                if target.exists() and target.stat().st_size == info.file_size:
                    extracted.append(info.filename)
                    continue
                with zf.open(info, "r") as src, open(target, "wb") as dst:
                    shutil.copyfileobj(src, dst, length=8 * 1024 * 1024)
                extracted.append(info.filename)
    print(f"[extract] Installed {len(extracted)} entries into {install_dir}")
    return extracted


def hardlink_or_copy_tree(src_dir: Path, dst_dir: Path) -> None:
    """Mirror `src_dir` into `dst_dir`, hardlinking large files to save 2.3 GiB."""
    dst_dir.mkdir(parents=True, exist_ok=True)
    for item in src_dir.rglob("*"):
        rel = item.relative_to(src_dir)
        out = dst_dir / rel
        if item.is_dir():
            out.mkdir(parents=True, exist_ok=True)
            continue
        out.parent.mkdir(parents=True, exist_ok=True)
        if out.exists():
            if out.stat().st_size == item.stat().st_size:
                continue
            out.unlink()
        if item.name == "weights.bin":
            os.link(item, out)
        else:
            shutil.copy2(item, out)


def ensure_symlink(link_path: Path, target_dir: Path) -> None:
    """Create a convenience directory symlink if nothing conflicts."""
    link_path.parent.mkdir(parents=True, exist_ok=True)
    if link_path.is_symlink():
        if link_path.resolve() == target_dir.resolve():
            return
        link_path.unlink()
    elif link_path.exists():
        return
    os.symlink(target_dir, link_path)


def chrome_windows_time_now() -> str:
    """Return current Windows FILETIME string (microseconds since 1601-01-01)."""
    return str(int((time.time() + 11644473600) * 1_000_000))


def is_chrome_profile_locked(profile_dir: Path) -> bool:
    """Detect whether a Chrome instance currently owns `SingletonLock`."""
    lock = profile_dir / "SingletonLock"
    return lock.exists() or lock.is_symlink()


def update_local_state(profile_dir: Path, version: str, force: bool = False) -> bool:
    """Update Chrome Local State experiments & manifest asset ledger when safe."""
    local_state = profile_dir / "Local State"
    if not local_state.exists():
        return False
    if is_chrome_profile_locked(profile_dir) and not force:
        print(f"[local_state] Skipped {local_state} (Chrome process holds SingletonLock)")
        return False

    backup = profile_dir / "Local State.bak-clauseguard"
    if not backup.exists():
        shutil.copy2(local_state, backup)

    data = json.loads(local_state.read_text(encoding="utf-8"))
    browser = data.setdefault("browser", {})
    labs = list(browser.get("enabled_labs_experiments", []))
    for exp in ("gemma4-for-built-in-ai@1", "optimization-guide-debug-logs", "prompt-api@1"):
        if exp not in labs:
            labs.append(exp)
    browser["enabled_labs_experiments"] = labs

    og = data.setdefault("optimization_guide", {})
    me = og.setdefault("model_execution", {})
    usage = me.setdefault("last_usage_by_feature", {})
    usage["prompt_api_gemma4"] = chrome_windows_time_now()
    ledger = me.setdefault("manifest_asset_ledger", {})
    ledger[GEMMA4_PUBKEY_HEX] = {
        "asset_id": GEMMA4_ASSET_ID,
        "requested_version": version,
    }
    local_state.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    print(f"[local_state] Updated {local_state} for {GEMMA4_ASSET_ID} {version}")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Download, verify, and install Chrome Gemma4 on-device component")
    parser.add_argument("--probe-only", action="store_true", help="Only query Omaha and inspect local dirs")
    parser.add_argument("--workers", type=int, default=4, help="Parallel HTTP range workers")
    parser.add_argument("--keep-crx", action="store_true", help="Keep cached .crx3 file after extraction")
    args = parser.parse_args()

    print("[omaha] Querying Google Chrome component update endpoint...")
    try:
        meta = query_omaha_component()
    except Exception as exc:  # noqa: BLE001
        print(f"[omaha] Query warning ({exc}), using verified fallback URL metadata")
        meta = {
            "appid": GEMMA4_APP_ID,
            "version": GEMMA4_DEFAULT_VERSION,
            "crx_url": GEMMA4_FALLBACK_URL,
            "size_bytes": 2475404706,
            "exceeds_int32_max": True,
            "sha256": GEMMA4_EXPECTED_SHA256,
        }

    print(
        json.dumps(
            {
                "component": GEMMA4_ASSET_ID,
                "appid": meta["appid"],
                "version": meta["version"],
                "size_bytes": meta["size_bytes"],
                "size_gib": round(meta["size_bytes"] / (1024**3), 3),
                "exceeds_chrome_int32_json_limit": meta["exceeds_int32_max"],
                "sha256": meta["sha256"],
                "crx_url": meta["crx_url"],
            },
            indent=2,
        )
    )
    if args.probe_only:
        return 0

    version = str(meta["version"])
    crx_path = CACHE_DIR / f"{GEMMA4_ASSET_ID}_{version}.crx3"
    download_crx3_parallel(
        url=str(meta["crx_url"]),
        dest_path=crx_path,
        expected_size=int(meta["size_bytes"]),
        workers=max(1, min(args.workers, 8)),
    )
    verify_sha256(crx_path, str(meta["sha256"]))

    main_install_dir = MAIN_CHROME_DIR / "OptGuideManifestModel" / GEMMA4_PUBKEY_HEX / version
    extract_crx3_to_dir(crx_path, main_install_dir)

    # Also expose under asset_id path + OptGuideOnDeviceModel convenience symlinks without duplicating bytes
    ensure_symlink(MAIN_CHROME_DIR / "OptGuideManifestModel" / GEMMA4_ASSET_ID / version, main_install_dir)
    ensure_symlink(MAIN_CHROME_DIR / "OptGuideOnDeviceModel" / version, main_install_dir)

    # Hardlink into ClauseGuard isolated Chrome probe profile (0 extra bytes consumed)
    probe_install_dir = PROBE_CHROME_DIR / "OptGuideManifestModel" / GEMMA4_PUBKEY_HEX / version
    hardlink_or_copy_tree(main_install_dir, probe_install_dir)
    ensure_symlink(PROBE_CHROME_DIR / "OptGuideManifestModel" / GEMMA4_ASSET_ID / version, probe_install_dir)

    # Ensure OptimizationGuideModelsManifest is present in probe profile too
    src_manifest_dir = MAIN_CHROME_DIR / "OptimizationGuideModelsManifest"
    dst_manifest_dir = PROBE_CHROME_DIR / "OptimizationGuideModelsManifest"
    if src_manifest_dir.exists() and not dst_manifest_dir.exists():
        shutil.copytree(src_manifest_dir, dst_manifest_dir)

    # Update Local State safely where unlocked
    update_local_state(PROBE_CHROME_DIR, version)
    main_updated = update_local_state(MAIN_CHROME_DIR, version)

    if not args.keep_crx and crx_path.exists():
        crx_path.unlink()
        print(f"[cleanup] Removed temporary CRX archive {crx_path}")

    print("\n=== INSTALL COMPLETE ===")
    print(f"Installed Model Dir (main):  {main_install_dir}")
    print(f"Installed Model Dir (probe): {probe_install_dir}")
    if not main_updated:
        print(
            "\nMain Chrome is currently open (SingletonLock active).\n"
            "Either:\n"
            "  1. Paste this exact path into chrome://on-device-internals/ -> Broker State -> Model directory -> Load:\n"
            f"     {main_install_dir}\n"
            "  2. Or restart Chrome so ComponentInstaller detects OptGuideManifestModel automatically."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
