#!/usr/bin/env python3
"""
Check whether LIVI's Chromium renderer is using Raspberry Pi GPU rendering.

Run on the Pi. The safest first pass is read-only:

  python3 scripts/tools/pi-render-diagnostics.py

If LIVI is already running with remote debugging enabled, the script queries it.
If not, run a temporary checked launch:

  python3 scripts/tools/pi-render-diagnostics.py --launch

If LIVI is already running and you want the script to restart it for the check:

  python3 scripts/tools/pi-render-diagnostics.py --restart

For an explicit hardware-only trial, add --force-hardware. That launch disables
Chromium's software rasterizer for the temporary test. On exit, the script kills
only the temporary debug launch and, if it stopped an existing LIVI, relaunches
normal LIVI without the experimental flags.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import random
import shlex
import signal
import socket
import ssl
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


RENDERER_JS = r"""
(() => {
  const glInfo = (kind) => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext(kind, {
      alpha: false,
      antialias: false,
      failIfMajorPerformanceCaveat: false,
      powerPreference: 'high-performance'
    });
    if (!gl) return { available: false };

    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const info = {
      available: true,
      vendor: gl.getParameter(gl.VENDOR),
      renderer: gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION),
      shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION)
    };
    if (dbg) {
      info.unmaskedVendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);
      info.unmaskedRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
    }
    return info;
  };

  return {
    url: location.href,
    title: document.title,
    userAgent: navigator.userAgent,
    webgl: glInfo('webgl'),
    webgl2: glInfo('webgl2')
  };
})()
"""


SOFTWARE_MARKERS = (
  "llvmpipe",
  "softpipe",
  "swiftshader",
  "software rasterizer",
  "lavapipe",
)

PI_GPU_MARKERS = (
  "v3d",
  "vc4",
  "videocore",
  "broadcom",
)


def log(message: str = "") -> None:
  print(message, flush=True)


def run_text(command: list[str], *, timeout: float = 4.0) -> str:
  try:
    completed = subprocess.run(
      command,
      check=False,
      text=True,
      stdout=subprocess.PIPE,
      stderr=subprocess.STDOUT,
      timeout=timeout,
    )
  except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
    return f"{type(exc).__name__}: {exc}"
  return completed.stdout.strip()


def command_exists(name: str) -> bool:
  return subprocess.run(
    ["sh", "-lc", f"command -v {shlex.quote(name)} >/dev/null 2>&1"],
    check=False,
  ).returncode == 0


def read_text(path: str) -> str | None:
  try:
    data = Path(path).read_bytes()
  except OSError:
    return None
  return data.replace(b"\x00", b"").decode("utf-8", "replace").strip()


def collect_system_info() -> dict[str, Any]:
  info: dict[str, Any] = {
    "hostname": socket.gethostname(),
    "uname": run_text(["uname", "-a"]),
    "model": read_text("/proc/device-tree/model"),
    "osRelease": read_text("/etc/os-release"),
    "session": {
      "XDG_SESSION_TYPE": os.environ.get("XDG_SESSION_TYPE"),
      "XDG_RUNTIME_DIR": os.environ.get("XDG_RUNTIME_DIR"),
      "WAYLAND_DISPLAY": os.environ.get("WAYLAND_DISPLAY"),
      "DISPLAY": os.environ.get("DISPLAY"),
    },
    "devDri": run_text(["sh", "-lc", "ls -l /dev/dri 2>/dev/null || true"]),
    "groups": run_text(["id"]),
    "loadedGpuModules": run_text(
      ["sh", "-lc", "lsmod 2>/dev/null | awk '/^(vc4|v3d|drm|gpu_sched)/ { print }'"]
    ),
  }

  if command_exists("eglinfo"):
    info["eglinfoBrief"] = run_text(["sh", "-lc", "eglinfo -B 2>&1 | sed -n '1,80p'"], timeout=8)
  if command_exists("glxinfo"):
    info["glxinfoBrief"] = run_text(["glxinfo", "-B"], timeout=8)
  if command_exists("vulkaninfo"):
    info["vulkaninfoBrief"] = run_text(
      ["sh", "-lc", "vulkaninfo --summary 2>&1 | sed -n '1,120p'"], timeout=8
    )

  return info


class WebSocket:
  def __init__(self, url: str, timeout: float = 5.0):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("ws", "wss"):
      raise ValueError(f"unsupported websocket scheme in {url}")
    self._secure = parsed.scheme == "wss"
    self._host = parsed.hostname or "127.0.0.1"
    self._port = parsed.port or (443 if self._secure else 80)
    self._path = parsed.path or "/"
    if parsed.query:
      self._path += f"?{parsed.query}"
    raw = socket.create_connection((self._host, self._port), timeout=timeout)
    self._socket = ssl.create_default_context().wrap_socket(raw, server_hostname=self._host) if self._secure else raw
    self._socket.settimeout(timeout)
    self._handshake()

  def _handshake(self) -> None:
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    request = (
      f"GET {self._path} HTTP/1.1\r\n"
      f"Host: {self._host}:{self._port}\r\n"
      "Upgrade: websocket\r\n"
      "Connection: Upgrade\r\n"
      f"Sec-WebSocket-Key: {key}\r\n"
      "Sec-WebSocket-Version: 13\r\n"
      "\r\n"
    )
    self._socket.sendall(request.encode("ascii"))
    response = b""
    while b"\r\n\r\n" not in response:
      chunk = self._socket.recv(4096)
      if not chunk:
        break
      response += chunk
    header = response.decode("iso-8859-1", "replace")
    if " 101 " not in header.split("\r\n", 1)[0]:
      raise RuntimeError(f"websocket upgrade failed: {header.splitlines()[0] if header else 'empty response'}")
    expected = base64.b64encode(
      hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")).digest()
    ).decode("ascii")
    if expected.lower() not in header.lower():
      raise RuntimeError("websocket upgrade failed: accept key mismatch")

  def send_json(self, payload: dict[str, Any]) -> None:
    self._send_frame(json.dumps(payload, separators=(",", ":")).encode("utf-8"))

  def recv_json(self) -> dict[str, Any]:
    while True:
      opcode, payload = self._recv_frame()
      if opcode == 0x1:
        return json.loads(payload.decode("utf-8"))
      if opcode == 0x8:
        raise RuntimeError("websocket closed")
      if opcode == 0x9:
        self._send_frame(payload, opcode=0xA)

  def close(self) -> None:
    try:
      self._send_frame(b"", opcode=0x8)
    except OSError:
      pass
    self._socket.close()

  def _send_frame(self, payload: bytes, opcode: int = 0x1) -> None:
    mask_key = random.randbytes(4) if hasattr(random, "randbytes") else os.urandom(4)
    header = bytearray([0x80 | opcode])
    length = len(payload)
    if length < 126:
      header.append(0x80 | length)
    elif length < 65536:
      header.append(0x80 | 126)
      header.extend(struct.pack("!H", length))
    else:
      header.append(0x80 | 127)
      header.extend(struct.pack("!Q", length))
    header.extend(mask_key)
    masked = bytes(byte ^ mask_key[index % 4] for index, byte in enumerate(payload))
    self._socket.sendall(bytes(header) + masked)

  def _recv_exact(self, count: int) -> bytes:
    chunks = bytearray()
    while len(chunks) < count:
      chunk = self._socket.recv(count - len(chunks))
      if not chunk:
        raise RuntimeError("websocket closed during frame")
      chunks.extend(chunk)
    return bytes(chunks)

  def _recv_frame(self) -> tuple[int, bytes]:
    first, second = self._recv_exact(2)
    opcode = first & 0x0F
    masked = bool(second & 0x80)
    length = second & 0x7F
    if length == 126:
      length = struct.unpack("!H", self._recv_exact(2))[0]
    elif length == 127:
      length = struct.unpack("!Q", self._recv_exact(8))[0]
    mask_key = self._recv_exact(4) if masked else b""
    payload = self._recv_exact(length) if length else b""
    if masked:
      payload = bytes(byte ^ mask_key[index % 4] for index, byte in enumerate(payload))
    return opcode, payload


@dataclass
class CdpClient:
  ws: WebSocket
  next_id: int = 0

  def command(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    self.next_id += 1
    self.ws.send_json({"id": self.next_id, "method": method, "params": params or {}})
    while True:
      message = self.ws.recv_json()
      if message.get("id") != self.next_id:
        continue
      if "error" in message:
        raise RuntimeError(f"CDP {method} failed: {message['error']}")
      return message.get("result", {})

  def eval(self, expression: str) -> Any:
    result = self.command(
      "Runtime.evaluate",
      {
        "expression": expression,
        "awaitPromise": False,
        "returnByValue": True,
      },
    )
    remote = result.get("result", {})
    if "exceptionDetails" in result:
      raise RuntimeError(f"Runtime.evaluate exception: {result['exceptionDetails']}")
    return remote.get("value")


def get_json(url: str, timeout: float = 3.0) -> Any:
  with urllib.request.urlopen(url, timeout=timeout) as response:
    return json.load(response)


def cdp_base(port: int) -> str:
  return f"http://127.0.0.1:{port}"


def wait_for_cdp(port: int, timeout: float) -> bool:
  deadline = time.monotonic() + timeout
  while time.monotonic() < deadline:
    try:
      get_json(f"{cdp_base(port)}/json/version", timeout=1.0)
      return True
    except (OSError, urllib.error.URLError, TimeoutError):
      time.sleep(0.25)
  return False


def choose_page_target(targets: list[dict[str, Any]]) -> dict[str, Any] | None:
  pages = [target for target in targets if target.get("type") == "page" and target.get("webSocketDebuggerUrl")]
  if not pages:
    return None
  for page in pages:
    url = str(page.get("url", ""))
    title = str(page.get("title", ""))
    if url.startswith("app://") or "livi" in title.lower():
      return page
  return pages[0]


def query_cdp(port: int) -> dict[str, Any]:
  version = get_json(f"{cdp_base(port)}/json/version")
  targets = get_json(f"{cdp_base(port)}/json")
  page_target = choose_page_target(targets)
  result: dict[str, Any] = {
    "version": version,
    "targets": [
      {
        "id": target.get("id"),
        "type": target.get("type"),
        "title": target.get("title"),
        "url": target.get("url"),
      }
      for target in targets
    ],
  }

  browser_ws_url = version.get("webSocketDebuggerUrl")
  if browser_ws_url:
    browser_ws = WebSocket(browser_ws_url)
    try:
      browser = CdpClient(browser_ws)
      try:
        result["systemInfo"] = browser.command("SystemInfo.getInfo")
      except Exception as exc:  # Chromium can disable this on some builds.
        result["systemInfoError"] = str(exc)
    finally:
      browser_ws.close()

  if page_target:
    page_ws = WebSocket(str(page_target["webSocketDebuggerUrl"]))
    try:
      page = CdpClient(page_ws)
      page.command("Runtime.enable")
      result["pageRenderer"] = page.eval(RENDERER_JS)
    finally:
      page_ws.close()
  else:
    result["pageRendererError"] = "No page target found"

  result["classification"] = classify_result(result)
  return result


def flatten_strings(value: Any) -> list[str]:
  strings: list[str] = []
  if isinstance(value, dict):
    for item in value.values():
      strings.extend(flatten_strings(item))
  elif isinstance(value, list):
    for item in value:
      strings.extend(flatten_strings(item))
  elif isinstance(value, str):
    strings.append(value)
  return strings


def classify_result(result: dict[str, Any]) -> dict[str, str]:
  text = "\n".join(flatten_strings(result)).lower()
  software_hits = [marker for marker in SOFTWARE_MARKERS if marker in text]
  pi_gpu_hits = [marker for marker in PI_GPU_MARKERS if marker in text]
  if software_hits:
    verdict = "software"
  elif pi_gpu_hits:
    verdict = "hardware"
  else:
    verdict = "unknown"
  return {
    "verdict": verdict,
    "softwareMarkers": ", ".join(software_hits),
    "piGpuMarkers": ", ".join(pi_gpu_hits),
  }


def livi_processes() -> list[tuple[int, str]]:
  processes: list[tuple[int, str]] = []
  proc = Path("/proc")
  if not proc.exists():
    return processes
  own_pid = os.getpid()
  for entry in proc.iterdir():
    if not entry.name.isdigit():
      continue
    pid = int(entry.name)
    if pid == own_pid:
      continue
    try:
      cmdline = (entry / "cmdline").read_bytes().replace(b"\x00", b" ").decode("utf-8", "replace").strip()
      comm = (entry / "comm").read_text(encoding="utf-8", errors="replace").strip().lower()
    except OSError:
      continue
    lower = cmdline.lower()
    if "pi-render-diagnostics.py" in lower:
      continue
    is_livi = (
      "livi.appimage" in lower
      or "dev.f-io.livi" in lower
      or "livi-compositor" in lower
      or ".mount_livi" in lower
      or comm in {"livi", "livi-compositor"}
    )
    if is_livi:
      processes.append((pid, cmdline))
  return processes


def terminate_processes(processes: list[tuple[int, str]]) -> None:
  if not processes:
    return
  log("Stopping existing LIVI processes for the temporary diagnostic launch:")
  for pid, cmdline in processes:
    log(f"  TERM {pid}: {cmdline}")
    try:
      os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
      pass
  deadline = time.monotonic() + 6
  while time.monotonic() < deadline:
    remaining = {pid for pid, _ in livi_processes()}
    if not any(pid in remaining for pid, _ in processes):
      return
    time.sleep(0.25)
  for pid, cmdline in processes:
    try:
      os.kill(pid, signal.SIGKILL)
      log(f"  KILL {pid}: {cmdline}")
    except ProcessLookupError:
      pass


def terminate_new_livi_processes(baseline_pids: set[int]) -> None:
  processes = [(pid, cmdline) for pid, cmdline in livi_processes() if pid not in baseline_pids]
  if processes:
    log("Cleaning up temporary LIVI diagnostic processes.")
    terminate_processes(processes)


def launch_environment() -> dict[str, str]:
  env = os.environ.copy()
  uid = os.getuid()
  runtime = env.get("XDG_RUNTIME_DIR") or f"/run/user/{uid}"
  env.setdefault("XDG_RUNTIME_DIR", runtime)
  if not env.get("WAYLAND_DISPLAY"):
    for candidate in ("wayland-0", "wayland-1"):
      if Path(runtime, candidate).exists():
        env["WAYLAND_DISPLAY"] = candidate
        break
  if not env.get("DISPLAY") and Path("/tmp/.X11-unix/X0").exists():
    env["DISPLAY"] = ":0"
  return env


def launch_livi(appimage: Path, port: int, *, force_hardware: bool) -> subprocess.Popen[str]:
  if not appimage.exists():
    raise FileNotFoundError(f"LIVI AppImage not found: {appimage}")
  args = [
    str(appimage),
    f"--remote-debugging-port={port}",
    "--remote-allow-origins=*",
  ]
  if force_hardware:
    args.extend(
      [
        "--enable-gpu",
        "--ignore-gpu-blocklist",
        "--enable-gpu-rasterization",
        "--enable-zero-copy",
        "--disable-software-rasterizer",
      ]
    )
  log("Launching temporary LIVI diagnostic process:")
  log("  " + " ".join(shlex.quote(arg) for arg in args))
  log_path = Path("/tmp/livi-render-diagnostics.log")
  log_file = log_path.open("a", encoding="utf-8")
  log(f"  log: {log_path}")
  try:
    return subprocess.Popen(args, env=launch_environment(), stdout=log_file, stderr=subprocess.STDOUT, text=True)
  finally:
    log_file.close()


def relaunch_normal(appimage: Path) -> None:
  if not appimage.exists():
    log(f"Normal fallback skipped; AppImage not found: {appimage}")
    return
  log("Fallback: relaunching normal LIVI without diagnostic hardware flags.")
  subprocess.Popen([str(appimage)], env=launch_environment(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def print_human(system_info: dict[str, Any], cdp_result: dict[str, Any] | None) -> None:
  log("\n=== Pi / Session ===")
  for key in ("hostname", "model", "uname"):
    if system_info.get(key):
      log(f"{key}: {system_info[key]}")
  session = system_info.get("session", {})
  log(
    "session: "
    + " ".join(f"{key}={value or '-'}" for key, value in session.items())
  )
  log("/dev/dri:")
  log(system_info.get("devDri") or "  unavailable")
  if system_info.get("loadedGpuModules"):
    log("GPU modules:")
    log(system_info["loadedGpuModules"])

  if not cdp_result:
    log("\n=== Chromium Renderer ===")
    log("No CDP renderer result. Start LIVI with --remote-debugging-port=9222 or rerun with --launch/--restart.")
    return

  log("\n=== Chromium Renderer ===")
  classification = cdp_result.get("classification", {})
  log(f"verdict: {classification.get('verdict', 'unknown')}")
  if classification.get("softwareMarkers"):
    log(f"software markers: {classification['softwareMarkers']}")
  if classification.get("piGpuMarkers"):
    log(f"pi GPU markers: {classification['piGpuMarkers']}")
  page = cdp_result.get("pageRenderer") or {}
  for kind in ("webgl", "webgl2"):
    info = page.get(kind) or {}
    log(f"{kind}: available={info.get('available')}")
    renderer = info.get("unmaskedRenderer") or info.get("renderer")
    vendor = info.get("unmaskedVendor") or info.get("vendor")
    if vendor or renderer:
      log(f"  vendor:   {vendor}")
      log(f"  renderer: {renderer}")


def main() -> int:
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("--port", type=int, default=9222, help="Chromium remote debugging port")
  parser.add_argument("--appimage", default=os.environ.get("LIVI_APPIMAGE", "~/LIVI/LIVI.AppImage"))
  parser.add_argument("--launch", action="store_true", help="Launch a temporary debug LIVI if CDP is not already available")
  parser.add_argument("--restart", action="store_true", help="Stop an existing LIVI, run the temporary check, then relaunch normal LIVI")
  parser.add_argument("--force-hardware", action="store_true", help="Temporary launch with Chromium software rasterizer disabled")
  parser.add_argument("--keep-running", action="store_true", help="Leave the temporary diagnostic LIVI running")
  parser.add_argument("--timeout", type=float, default=18.0, help="Seconds to wait for CDP after launch")
  parser.add_argument("--json", action="store_true", help="Print JSON only")
  args = parser.parse_args()

  appimage = Path(args.appimage).expanduser()
  temporary: subprocess.Popen[str] | None = None
  stopped_existing = False
  launch_baseline_pids: set[int] | None = None
  cdp_result: dict[str, Any] | None = None
  system_info = collect_system_info()

  try:
    if wait_for_cdp(args.port, 1.0):
      cdp_result = query_cdp(args.port)
    elif args.launch or args.restart:
      existing = livi_processes()
      if existing and not args.restart:
        log("LIVI appears to be running, but CDP is not available.")
        log("Rerun with --restart to do a temporary debug restart with automatic fallback.")
      else:
        if existing:
          terminate_processes(existing)
          stopped_existing = True
        launch_baseline_pids = {pid for pid, _ in livi_processes()}
        temporary = launch_livi(appimage, args.port, force_hardware=args.force_hardware)
        if wait_for_cdp(args.port, args.timeout):
          cdp_result = query_cdp(args.port)
        else:
          log(f"CDP did not become available within {args.timeout:.1f}s.")
          log("Check /tmp/livi-render-diagnostics.log on the Pi for launch errors.")
    output = {
      "system": system_info,
      "cdp": cdp_result,
      "appimage": str(appimage),
      "temporaryLaunch": bool(temporary),
      "forceHardware": bool(args.force_hardware),
    }
    if args.json:
      print(json.dumps(output, indent=2, sort_keys=True))
    else:
      print_human(system_info, cdp_result)
      log("\n=== JSON ===")
      print(json.dumps(output, indent=2, sort_keys=True))
  finally:
    if temporary and not args.keep_running:
      temporary.terminate()
      try:
        temporary.wait(timeout=4)
      except subprocess.TimeoutExpired:
        temporary.kill()
      if launch_baseline_pids is not None:
        terminate_new_livi_processes(launch_baseline_pids)
    if stopped_existing and not args.keep_running:
      relaunch_normal(appimage)

  verdict = ((cdp_result or {}).get("classification") or {}).get("verdict")
  return 0 if verdict in (None, "hardware") else 2


if __name__ == "__main__":
  try:
    raise SystemExit(main())
  except KeyboardInterrupt:
    raise SystemExit(130)
