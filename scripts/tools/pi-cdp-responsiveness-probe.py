#!/usr/bin/env python3
"""
Measure LIVI renderer responsiveness during a synthetic projection drag.

Run this on the Pi while LIVI is started with Chromium remote debugging enabled:

  python3 scripts/tools/pi-cdp-responsiveness-probe.py --duration 8 --hz 30

It intentionally does not ship in the app and has zero runtime cost. The probe
uses CDP to:
  1. install a temporary requestAnimationFrame + pointer event recorder,
  2. dispatch a mouse drag around the projection center,
  3. print frame-gap and input-event timing statistics.

This measures renderer/UI-thread stalls under a given mode. It does not prove
end-to-end phone-side CarPlay latency, but it gives a repeatable local signal
for regressions that would make touch handling feel sticky.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
import urllib.request
from dataclasses import dataclass
from typing import Any


INSTALL_PROBE_JS = r"""
(() => {
  const existing = window.__liviResponsivenessProbe;
  if (existing && typeof existing.cleanup === 'function') existing.cleanup();

  const state = {
    started: performance.now(),
    lastRaf: performance.now(),
    rafDeltas: [],
    events: [],
    rafId: 0,
    cleanup: null
  };

  const maxSamples = 10000;
  const onPointer = (event) => {
    if (state.events.length >= maxSamples) return;
    state.events.push({
      type: event.type,
      t: performance.now(),
      x: event.clientX,
      y: event.clientY
    });
  };

  const onRaf = (t) => {
    state.rafDeltas.push(t - state.lastRaf);
    state.lastRaf = t;
    state.rafId = requestAnimationFrame(onRaf);
  };

  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup']) {
    window.addEventListener(type, onPointer, { capture: true, passive: true });
  }
  state.rafId = requestAnimationFrame(onRaf);

  state.cleanup = () => {
    cancelAnimationFrame(state.rafId);
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup']) {
      window.removeEventListener(type, onPointer, { capture: true });
    }
  };

  window.__liviResponsivenessProbe = state;
  return true;
})()
"""


SUMMARY_JS = r"""
(() => {
  const state = window.__liviResponsivenessProbe;
  if (!state) return null;

  const sorted = [...state.rafDeltas].filter(Number.isFinite).sort((a, b) => a - b);
  const pct = (p) => {
    if (sorted.length === 0) return null;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[index];
  };
  const countOver = (ms) => sorted.filter((v) => v > ms).length;
  const events = state.events;
  const eventGaps = [];
  for (let i = 1; i < events.length; i++) eventGaps.push(events[i].t - events[i - 1].t);
  const sortedEventGaps = eventGaps.filter(Number.isFinite).sort((a, b) => a - b);
  const eventPct = (p) => {
    if (sortedEventGaps.length === 0) return null;
    const index = Math.min(sortedEventGaps.length - 1, Math.max(0, Math.ceil((p / 100) * sortedEventGaps.length) - 1));
    return sortedEventGaps[index];
  };

  return {
    durationMs: performance.now() - state.started,
    frameCount: sorted.length,
    frameAvgMs: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null,
    frameP50Ms: pct(50),
    frameP95Ms: pct(95),
    frameP99Ms: pct(99),
    frameMaxMs: sorted.length ? sorted[sorted.length - 1] : null,
    framesOver33ms: countOver(33),
    framesOver50ms: countOver(50),
    framesOver100ms: countOver(100),
    pointerEventCount: events.length,
    pointerGapP95Ms: eventPct(95),
    pointerGapMaxMs: sortedEventGaps.length ? sortedEventGaps[sortedEventGaps.length - 1] : null,
    url: location.href
  };
})()
"""


CLEANUP_JS = r"""
(() => {
  const state = window.__liviResponsivenessProbe;
  if (state && typeof state.cleanup === 'function') state.cleanup();
  delete window.__liviResponsivenessProbe;
  return true;
})()
"""


@dataclass
class CdpClient:
  ws: Any
  next_id: int = 0

  def command(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    self.next_id += 1
    self.ws.send(json.dumps({"id": self.next_id, "method": method, "params": params or {}}))
    while True:
      msg = json.loads(self.ws.recv())
      if msg.get("id") == self.next_id:
        if "error" in msg:
          raise RuntimeError(f"CDP {method} failed: {msg['error']}")
        return msg.get("result", {})

  def eval(self, expression: str, *, return_by_value: bool = True) -> Any:
    result = self.command(
      "Runtime.evaluate",
      {
        "expression": expression,
        "awaitPromise": False,
        "returnByValue": return_by_value,
      },
    )
    return result.get("result", {}).get("value")


def load_page_ws(cdp_json_url: str) -> str:
  with urllib.request.urlopen(cdp_json_url, timeout=5) as res:
    targets = json.load(res)
  pages = [t for t in targets if t.get("type") == "page" and t.get("webSocketDebuggerUrl")]
  if not pages:
    raise RuntimeError(f"No CDP page target found at {cdp_json_url}")
  return pages[0]["webSocketDebuggerUrl"]


def import_websocket() -> Any:
  try:
    import websocket  # type: ignore

    return websocket
  except ImportError as exc:
    raise SystemExit(
      "Missing websocket-client. Install it on the Pi with: python3 -m pip install websocket-client"
    ) from exc


def dispatch_drag(client: CdpClient, args: argparse.Namespace) -> int:
  interval = 1.0 / args.hz
  moves = max(1, int(args.duration * args.hz))
  client.command(
    "Input.dispatchMouseEvent",
    {
      "type": "mousePressed",
      "x": args.x,
      "y": args.y,
      "button": "left",
      "buttons": 1,
      "clickCount": 1,
    },
  )

  start = time.monotonic()
  for i in range(moves):
    phase = (i / max(1, moves - 1)) * math.tau * args.cycles
    x = args.x + math.sin(phase) * args.radius
    y = args.y + math.cos(phase) * args.radius
    client.command(
      "Input.dispatchMouseEvent",
      {
        "type": "mouseMoved",
        "x": round(x, 2),
        "y": round(y, 2),
        "button": "left",
        "buttons": 1,
      },
    )
    deadline = start + (i + 1) * interval
    delay = deadline - time.monotonic()
    if delay > 0:
      time.sleep(delay)

  client.command(
    "Input.dispatchMouseEvent",
    {
      "type": "mouseReleased",
      "x": args.x,
      "y": args.y,
      "button": "left",
      "buttons": 0,
      "clickCount": 1,
    },
  )
  return moves


def verdict(summary: dict[str, Any], expected_moves: int) -> str:
  p95 = summary.get("frameP95Ms") or 0
  max_frame = summary.get("frameMaxMs") or 0
  over_100 = summary.get("framesOver100ms") or 0
  event_count = summary.get("pointerEventCount") or 0

  if over_100 > 0 or max_frame > 250:
    return "bad"
  if p95 > 50 or event_count < expected_moves * 0.8:
    return "warn"
  return "ok"


def print_human(summary: dict[str, Any], expected_moves: int) -> None:
  status = verdict(summary, expected_moves)
  print(f"status: {status}")
  print(f"url: {summary.get('url')}")
  print(
    "frames: "
    f"count={summary.get('frameCount')} "
    f"avg={fmt(summary.get('frameAvgMs'))}ms "
    f"p95={fmt(summary.get('frameP95Ms'))}ms "
    f"p99={fmt(summary.get('frameP99Ms'))}ms "
    f"max={fmt(summary.get('frameMaxMs'))}ms"
  )
  print(
    "long frames: "
    f">33ms={summary.get('framesOver33ms')} "
    f">50ms={summary.get('framesOver50ms')} "
    f">100ms={summary.get('framesOver100ms')}"
  )
  print(
    "input: "
    f"events={summary.get('pointerEventCount')} "
    f"expected_moves={expected_moves} "
    f"gap_p95={fmt(summary.get('pointerGapP95Ms'))}ms "
    f"gap_max={fmt(summary.get('pointerGapMaxMs'))}ms"
  )


def fmt(value: Any) -> str:
  return "n/a" if value is None else f"{float(value):.1f}"


def main() -> int:
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("--cdp", default="http://127.0.0.1:9222/json", help="CDP /json endpoint")
  parser.add_argument("--duration", type=float, default=8.0, help="Drag duration in seconds")
  parser.add_argument("--hz", type=float, default=30.0, help="Synthetic move rate")
  parser.add_argument("--x", type=float, default=400.0, help="Center X coordinate")
  parser.add_argument("--y", type=float, default=400.0, help="Center Y coordinate")
  parser.add_argument("--radius", type=float, default=120.0, help="Drag radius in pixels")
  parser.add_argument("--cycles", type=float, default=4.0, help="Number of circular wiggles")
  parser.add_argument("--json", action="store_true", help="Print machine-readable JSON only")
  args = parser.parse_args()

  if args.duration <= 0 or args.hz <= 0:
    parser.error("--duration and --hz must be positive")

  websocket = import_websocket()
  ws_url = load_page_ws(args.cdp)
  ws = websocket.create_connection(ws_url, timeout=5)
  client = CdpClient(ws)
  expected_moves = 0
  try:
    client.command("Page.enable")
    client.command("Runtime.enable")
    client.eval(INSTALL_PROBE_JS)
    time.sleep(0.25)
    expected_moves = dispatch_drag(client, args)
    time.sleep(0.5)
    summary = client.eval(SUMMARY_JS)
  finally:
    try:
      client.eval(CLEANUP_JS)
    finally:
      ws.close()

  if not isinstance(summary, dict):
    raise RuntimeError("Probe did not return a summary")
  summary["expectedMoves"] = expected_moves
  summary["status"] = verdict(summary, expected_moves)

  if args.json:
    print(json.dumps(summary, indent=2, sort_keys=True))
  else:
    print_human(summary, expected_moves)
    print("\njson:")
    print(json.dumps(summary, indent=2, sort_keys=True))
  return 0


if __name__ == "__main__":
  try:
    raise SystemExit(main())
  except KeyboardInterrupt:
    raise SystemExit(130)
