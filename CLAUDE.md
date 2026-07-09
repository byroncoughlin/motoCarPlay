# Project Notes for AI Agents — LIVI

LIVI is an Electron app for a Raspberry Pi 5 motorcycle dashboard: an **800×800
round display**, CarPlay-only build. This file is the single source of truth for
how to build, deploy, test, screenshot, and verify LIVI. It exists so you (and
any future AI or human) do **not** have to re-derive the workflow or re-discover
the gotchas. Read it fully before touching a build or the Pi.

If you learn something new the hard way, **add it here** so the next session
doesn't pay the same cost.

---

## 0. TL;DR / Golden Rules (read these first)

1. **BUILD ON THE PI, NEVER ON THE MAC.** A Mac build produces an AppImage with
   a missing/broken native GStreamer video addon → CarPlay center goes **black**
   (see §3). The Mac `npm run build:armLinux` "succeeds" but ships a broken app.
2. **To SEE the CarPlay video, use `grim` (Wayland screenshot), NOT CDP.** CDP
   `Page.captureScreenshot` only captures the DOM/overlay layer; the CarPlay
   video is composited *underneath* the Wayland surface and shows as
   white/black in CDP even when it is actually working (see §6).
3. **Never `pkill` the app/compositor.** It churns the Wayland session, drops
   your SSH (exit 255), and the app respawns. Deploy with an **atomic mv +
   reboot** instead (see §4).
4. **Do NOT rebuild `gst-video` on the Pi.** The wrong rebuild links too many
   libs and SIGBUS-crashes the whole app. Reuse the known-good binary (see §3).
5. **After any Mac electron-builder run, `git checkout -- package.json`.**
   electron-builder rewrites it in place and can corrupt it (see §9).
6. **Always leave the Pi clean:** app running on port 4000, port 9222 closed, no
   `--remote-debugging-port` flag in the process, no debug flags in autostart
   (see §8).

---

## 1. Environment & Topology

| Thing | Value |
|---|---|
| Mac workspace (edit + tests + git here) | `/Users/byron/LIVI` |
| Pi host | `byron@192.168.4.25` (passwordless sudo). Older notes say `motocarplay.local` — prefer the IP. |
| Pi source tree (BUILD here) | `~/LIVI-src` (git branch `codex/moto-round-livi`) |
| Pi prior-build tree (reference/backup) | `~/LIVI-build` |
| Deployed AppImage (autostart runs this) | `/home/byron/LIVI/LIVI.AppImage` |
| App log | `/home/byron/LIVI/LIVI.log` |
| Autostart entry | `~/.config/autostart/LIVI.desktop` |
| App config (settings/resolution) | `~/.config/LIVI/config.json` |
| Sensor socket / telemetry server | `http://localhost:4000` (socket.io) |
| Mac node / pnpm | Node 22, pnpm 11.5.3 (pinned in package.json) |
| Pi node / pnpm | Node **20**, `~/bin/pnpm` wrapper = pnpm **9.15.9** |

Git remotes (Mac):
- `origin` = `https://github.com/byroncoughlin/motoCarPlay.git` (repo renamed from LIVI 2026-07-05; old URL redirects) — **has push access, push here** (`git push origin main`).
- `upstream` = `https://github.com/f-io/LIVI.git` — no push access.
  (Note: the *round-carplay* repo uses a `fork` remote; LIVI does **not** — don't
  `git push fork` in LIVI, it will fail.)

**Always SSH with a timeout:** `ssh -o ConnectTimeout=8 byron@192.168.4.25 …`.
Right after a reboot SSH is slow and the harness auto-backgrounds long SSH
commands — don't spam; wait for the completion notification or poll gently.

---

## 2. Display geometry (the round screen)

- **800×800** round display, center `(400, 400)`, radius **400**. 3.4", ~235 DPI.
- **CarPlay center square: 586×586**, centered. Inset from each edge =
  `(800−586)/2 = 107px` → fraction `107/800 = 0.13375` (`SQUARE_PCT`/`MOTO_SQUARE_PCT` = **73.25%**).
- **Arc strips: 107px** each (`ARC_PCT`/`MOTO_ARC_PCT` = **13.375%**).
- Constants:
  - Main/shared: `src/main/shared/utils/motoGeometry.ts`
    (`MOTO_DISPLAY_SIZE`, `MOTO_CENTER_SQUARE_SIZE=586`, `MOTO_ARC_STRIP_SIZE=107`,
    `MOTO_SQUARE_INSET_FRAC=0.13375`, `isSquareContainedProjection`).
  - Renderer overlay: `motoLayout.ts` (`SQUARE_PCT`, `ARC_PCT`).
- **Everything in the sensor overlay must stay inside the circle.** Arc strips
  and gauge pills sit in the four 107px bands (top, bottom, left, right) around
  the center square. The corners of those bands are OUTSIDE the circle, so
  content near band edges/low-and-far-from-center can poke past the glass.

### Overlay container → screen-coordinate map (`ProjectionSensorOverlay.tsx`)
Root overlay: `position:absolute; inset:0; zIndex:10`.
- **Top arc**: `top:0; left:50%; translateX(-50%); width:SQUARE_PCT; height:ARC_PCT` → screen x∈[107,693], y∈[0,107].
- **Bottom arc**: same but `bottom:0` → x∈[107,693], y∈[693,800]. SVG `viewBox="0 0 586 107"`, `preserveAspectRatio="xMidYMid slice"` → 1:1: `screen=(107+svgX, 693+svgY)`.
- **Left CHT**: `left:0; top:50%; translateY(-50%); width:ARC_PCT; height:SQUARE_PCT` → x∈[0,107], y∈[107,693]. SVG `viewBox="0 0 107 586"`, `xMidYMid meet` (box is 107×586 so 1:1): `screen=(0+svgX, 107+svgY)`.
- **Right CHT**: same but `right:0` → x∈[693,800], y∈[107,693]: `screen=(693+svgX, 107+svgY)`.
- **Metric graph pane**: over-covers all four seams by 2px so no CarPlay peeks
  through: `top/left: calc(13.375% − 2px)`, `width/height: calc(73.25% + 4px)`,
  no `borderRadius`. (Helper `motoGraphPaneGeometry` handles inner SVG plotting.)

### True rounded-capsule circle-clearance formula
For a pill centered at screen `(cx,cy)`, width `w`, height `h`, corner radius
`rr=h/2`: the four arc-centers are at `(cx±(w/2−rr), cy±(h/2−rr))`. Clearance =
`R − max over corners of ( dist(corner, (400,400)) + rr )`. Negative = the pill
pokes outside the glass. This is exact and less conservative than bbox corners.
Run it with `/usr/bin/python3` on the Mac (it has PIL; the default `python3` may
not). Target ~**8–12px** clearance to match the other gauges. Reference clearances
achieved this project: speed 17.9px, ALT/G ~12px, lean 12.3px, CHT pills 8.1px.

### Stream edge artifact + rounded corners (learned 2026-07-04)
- The CarPlay stream's **outermost view-area row/column can arrive black** (a
  1px dark ring at the 586-square boundary). Three coordinated defenses:
  - Bar modes (solid/average): `ViewAreaMask` bars bleed **1px inward** (`BAR_BLEED_PX`).
  - Blur right edge: native pipeline shaves 1 source column (`fg_vr = vr+1` in `gst_video.cc`).
  - Blur bottom edge: `ProjectionService.mainGstVideoOptions` passes **viewAreaBottom+1**
    (can't fix in native — gst-video must not be rebuilt). `mainGstVideoOptionsKey`
    deliberately uses RAW config insets so this shave never recreates the live plane.
- **Rounded corners are always on** (policy): `fieldsForMode` sets
  `roundedCornerMaskEnabled: true` in all four modes, `applyMotoLinkedSettings`
  never writes false, default is true. Rendering: DOM corner mask in solid/average;
  **blur rounds natively** in the gst pipeline (radius 38 = `MOTO_CENTER_CORNER_RADIUS_PX`);
  extend has no window boundary so nothing renders. Only the manual "Round
  Corners" checkbox can turn it off.

### Working from the container (not the Mac)
- Claude sessions may run in a Linux container ("doscar", repo at `/home/byron/LIVI`)
  playing the Mac-workspace role: Node 22 + pnpm 11.5.3, Mac SSH agent forwarded
  (passwordless Pi SSH + sudo works). **No rsync** — sync by hash-manifest compare
  (`find src -type f -exec md5sum {} + | LC_ALL=C sort` both sides, diff, then scp
  only the differing files; sort with the SAME locale or the diff is garbage).
  No PIL by default — `pip3 install --user Pillow` works for grim pixel forensics.
- Use `ssh -o BatchMode=yes` (fails fast instead of hanging on a password prompt).
  First connect may need `-o StrictHostKeyChecking=accept-new`.
- `.claude/settings.local.json` here has `permissions.defaultMode: "bypassPermissions"`
  (Byron's choice). Never commit `.claude/`.
- **`git push origin main` works from this container**: `gh` is logged in to
  github.com as byroncoughlin (device-flow, 2026-07-04) and `~/.gitconfig` routes
  github.com credentials through `gh auth git-credential` (an empty `helper =`
  entry first resets the broken VS Code helpers inherited from /etc/gitconfig).
  If auth ever breaks again: `gh auth login -h github.com` needs a pty — drive it
  with a python `pty.fork()` script that answers `\x1b[6n` cursor queries with
  `\x1b[1;1R` and the prompts with `y\r` / `\r`, then have Byron enter the
  one-time code at github.com/login/device.

### Forcing gauge states for screenshots (no CDP needed)
- The Pi has **python-socketio**; `sio.emit("telemetry:push", {...})` on :4000 merges
  top-level fields into the store: `gpsFix` (bool), `gpsSatellites`, `imuRecalibrating`
  (bool), `chtLeftC/chtRightC`, `leanDeg`, `pitchDeg`, `gForceX/Y`, `ambientC`…
- Live sensors override pushed values every tick — **stop the systemd user service
  first**: `systemctl --user stop gps.service imu.service` (also `cht-temp.service`,
  `ambient-temp.service`), push, grim, then `start` them again.
- Restarting `imu.service` triggers a REAL "CALIBRATING" period (~1 min) while the
  BNO055 fusion re-converges — expected, clears itself.
- `/tmp` on the Pi is wiped every reboot — re-scp helper scripts after each boot.

### Top-band layout constraint (TopArc)
- The speed slot is only ~234px wide (left/right 30% of the 586 band); heading and
  temperature pills flank it at left/right 70. A one-line pill with the 72px numeral
  plus any status text OVERFLOWS into the neighbors — that's why the GPS no-fix
  state renders as a compact two-line pill (48px numeral over dot + label).

---

## 3. ⚠️ THE #1 GOTCHA: build on the Pi, or CarPlay center goes black

### Symptom
- Center square is **black** (no CarPlay video), even though the dash overlay
  (gauges/arcs) renders fine.
- Log shows:
  - `[GstVideo] native addon load failed: ENOENT, node_modules/gst-video/build/Release/gst_video.node not found …`
  - `[ProjectionService] GStreamer codecs: h264(hw=false sw=false) h265(hw=false sw=false) …` (all `false`)
  - `uncaughtException: spawn …/gst-video/build/Release/livi-gst-host ENOENT`

### Cause
CarPlay video needs two **native ARM-Linux binaries** that CANNOT be produced on
a Mac:
- `node_modules/gst-video/build/Release/gst_video.node` (node-gyp native addon)
- `…/gst-video/build/Release/livi-gst-host` (the GStreamer host process)

Plus the Wayland compositor `livi-compositor` (Linux/ARM only). A Mac
`electron-builder` build silently omits/breaks these. **`npm run build:armLinux`
on the Mac exits 0 and produces an AppImage, but that AppImage is broken.**

### Healthy log (what a correct Pi build looks like)
- `[GstVideo] GStreamer 1.26.2`
- `[ProjectionService] GStreamer codecs: h264(sw=true) h265(hw=true sw=true) vp9(sw=true) …`
- `[Perf] AppStart→FirstFrame: ~18000 ms`, `Dongle connected`, `Link established`
- No ENOENT, no `uncaughtException`, no core files.

### ⚠️ Sub-trap: do NOT rebuild `gst-video` on the Pi either
`gst_video.node` is gitignored (build/ dir) and env-sensitive. A fresh
`node-gyp rebuild` on the Pi's *current* pkg-config env produces a **~78832-byte
binary linking 31 libs** that **SIGBUS-crashes** the app at startup (port 4000
never opens; only a spinner). The **WORKING binary is ~144408 bytes linking 17
libs** (`livi-gst-host` ~78072 bytes). **Reuse it; never rebuild gst-video.**
Known-good copies live on the Pi at:
- `~/LIVI-src/native/gst-video/build/Release/gst_video.node` (144408) + `livi-gst-host` (78072)
- `~/LIVI-build/dist/linux-arm64-unpacked/resources/app.asar.unpacked/node_modules/gst-video/build/Release/gst_video.node`

Verify sizes before/after a build. If you ever see the 78832-byte one bundled, stop.

---

## 4. Build on the Pi — exact recipe

The Pi build tree `~/LIVI-src` is already set up: `node_modules` installed,
`~/bin/pnpm` (9.15.9) wrapper present, `package.json` `packageManager` already
pinned to `pnpm@9.15.9`, and the known-good native binaries in place. You only
sync your changed **source**, then build.

**Step 1 — sync your edited `src/` from Mac to Pi (NEVER touch `native/gst-video`):**
```bash
# From Mac, in /Users/byron/LIVI. Dry-run FIRST to confirm only your files change:
rsync -azn --delete --itemize-changes src/ byron@192.168.4.25:/home/byron/LIVI-src/src/
# Then for real (only sync src/ — do not --delete the whole tree, do not sync native/):
rsync -az  --delete --itemize-changes src/ byron@192.168.4.25:/home/byron/LIVI-src/src/
```
If you also changed the compositor, sync `native/livi-compositor/livi-compositor.c` too.
Confirm the dry-run shows ONLY your intended files (this session it was the 2 edited files).

**Step 2 — build on the Pi (three sub-steps):**
```bash
ssh -o ConnectTimeout=8 byron@192.168.4.25 'cd ~/LIVI-src && \
  export PATH=$PWD/node_modules/.bin:$PATH && \
  vite build'                                   # ~3s
ssh -o ConnectTimeout=8 byron@192.168.4.25 'cd ~/LIVI-src && \
  bash scripts/compositor/build-linux.sh'       # builds livi-compositor + bundles libs into out/compositor
ssh -o ConnectTimeout=8 byron@192.168.4.25 'cd ~/LIVI-src && \
  PATH=$HOME/bin:$PWD/node_modules/.bin:$PATH \
  electron-builder --linux AppImage --arm64 --publish never --config'   # ~2 min
```
Notes:
- The `~/bin/pnpm` wrapper exists because Pi global pnpm 11.5.3 needs Node 22 but
  the Pi has Node 20 (`ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`). The wrapper is
  `exec node ~/.cache/node/corepack/pnpm/9.15.9/dist/pnpm.cjs "$@"`.
- `package.json` `packageManager` is already `pnpm@9.15.9` on the Pi; if it's
  ever `11.5.3`, temporarily set it to `9.15.9` for the electron-builder step and
  restore after.
- Output: `~/LIVI-src/dist/LIVI-7.1.0-linux-arm64.AppImage` (~152 MB).

**Step 3 — verify the AppImage bundled the RIGHT native binaries (do NOT skip):**
```bash
ssh -o ConnectTimeout=8 byron@192.168.4.25 'cd ~/LIVI-src && \
  ls -la dist/linux-arm64-unpacked/resources/app.asar.unpacked/node_modules/gst-video/build/Release/gst_video.node \
         dist/linux-arm64-unpacked/resources/app.asar.unpacked/node_modules/gst-video/build/Release/livi-gst-host \
         dist/linux-arm64-unpacked/resources/compositor/bin/livi-compositor'
# Expect: gst_video.node = 144408 bytes, livi-gst-host = 78072, livi-compositor ~82928.
```

---

## 5. Deploy to the Pi (atomic mv + reboot)

The running app holds `LIVI.AppImage` busy, so a direct `cp`/`rsync` over it can
fail ("Text file busy"). Copy to a temp name, then atomic `mv`:
```bash
ssh -o ConnectTimeout=8 byron@192.168.4.25 '
  cp ~/LIVI-src/dist/LIVI-7.1.0-linux-arm64.AppImage ~/LIVI/LIVI.AppImage.new &&
  mv -f ~/LIVI/LIVI.AppImage.new ~/LIVI/LIVI.AppImage &&
  chmod +x ~/LIVI/LIVI.AppImage'
ssh -o ConnectTimeout=8 byron@192.168.4.25 'sudo systemctl reboot -i'
```
- **Prefer `sudo systemctl reboot -i` over `sudo reboot`.** Plain `sudo reboot`
  has silently failed to actually reboot (the old process kept running). Verify
  the reboot happened: `uptime -s` should change.
- Boot to a healthy app takes ~60–90s; `FirstFrame` ~18s after that.
- Wait, then confirm port 4000 is listening before doing anything else.

---

## 6. Verify — screenshots & the CDP-vs-grim distinction (CRITICAL)

There are TWO screenshot paths and they see DIFFERENT layers:

| Method | Sees | Use for |
|---|---|---|
| **`grim`** (Wayland) | The **real composited output** incl. CarPlay video under the surface | Confirming CarPlay renders in the center; final visual truth |
| **CDP `Page.captureScreenshot`** | **Only the DOM/overlay layer**; CarPlay video shows as **white/black** | Overlay geometry, but NOT video |

**If you screenshot with CDP and the center is white/black, that tells you
NOTHING about whether CarPlay works — it's expected. Use `grim`.** (This session,
CDP white centers masked a genuinely broken video build for a while.)

### grim (real screen, incl. video)
```bash
ssh -o ConnectTimeout=8 byron@192.168.4.25 'export XDG_RUNTIME_DIR=/run/user/1000; export WAYLAND_DISPLAY=wayland-0; grim /tmp/r.png'
scp -o ConnectTimeout=8 byron@192.168.4.25:/tmp/r.png /tmp/grim.png
# Then Read /tmp/grim.png. CarPlay working = Maps/dock visible in center square.
```
- `/tmp` is tmpfs — **wiped on every reboot.** Re-scp helper scripts each boot.
- Analyze/measure/crop on the Mac with `/usr/bin/python3` (has PIL).
- To overlay the circle for clearance checks:
  `ImageDraw.ellipse([1,1,799,799], outline=(255,0,0), width=2)` then crop the pill region.

### CDP (DOM measurement, clicks, geometry)
Enable by adding the flag INSIDE the `sh -c '… LIVI.AppImage > …log'` autostart Exec:
```bash
# add:
ssh … "sed -i 's#LIVI.AppImage >#LIVI.AppImage --remote-debugging-port=9222 --remote-allow-origins=* >#' ~/.config/autostart/LIVI.desktop && sudo systemctl reboot -i"
# remove (restore clean):
ssh … "sed -i 's# --remote-debugging-port=9222 --remote-allow-origins=\*##' ~/.config/autostart/LIVI.desktop && sudo systemctl reboot -i"
```
Then: `GET http://localhost:9222/json` → the `type:"page"` target's
`webSocketDebuggerUrl`. `websocket-client` + `urllib` are on the Pi.
- **Write CDP helper scripts to a local file and `scp` them** — heredocs with
  `r"""…"""` / globs break over SSH. Keep them as plain `.py` files.
- Useful calls: `Runtime.evaluate {returnByValue:true}` (read
  `getBoundingClientRect()`, compute clearance in-page), `Page.captureScreenshot`,
  `Input.dispatchMouseEvent` (`mousePressed`+`mouseReleased`) to click/open graphs.
- **Measure real rendered geometry via DOM**, e.g. clearance for
  `[data-testid=projection-cht-pill-L]` — this is the trustworthy method vs pixel
  guessing on a translucent scrim.
- **Worst-case text width**: temporarily overwrite a text node's value in the same
  `Runtime.evaluate` and read `getBBox()`/`getBoundingClientRect().width` before
  React reverts it (e.g. set CHT to "188"/"205", speed to 3 digits, ALT "18,000").
- Idle-overlay note: an idle clock overlay can cover the top arc + center; tap the
  bottom strip (~180,745) to open a graph so the overlay hides.

### Worker perf probing over CDP
Workers appear in `/json` as `type:worker` but their direct
`webSocketDebuggerUrl` doesn't answer — connect to the **page** target, send
`Target.setAutoAttach {autoAttach:true, flatten:true}`, collect
`Target.attachedToTarget`, then message the worker via its `sessionId`. The Render
worker's `targetInfo.url` contains `Render.worker`. Module-scope objects aren't
reachable from `Runtime.evaluate`, but **prototype patching works**
(`VideoDecoder.prototype.decode`, `WebGLRenderingContext.prototype.texImage2D/drawArrays`,
`createImageBitmap`). Workers here use **WebGL1** (getContext('webgl2') is null on this Mesa/V3D).

---

## 7. Telemetry / settings injection (socket.io on :4000)

- The app relays sensor events to any socket.io client on `:4000`. Only
  `telemetry:update` is broadcast to arbitrary clients; there is **no** `settings`
  push to random clients (so you can't read settings that way — use CDP to read
  the store, or `~/.config/LIVI/config.json`).
- `sio.emit("telemetry:push", payload)` merges into the store, BUT **live sensors
  override speed/altitude/heading every tick** (leanDeg, gForce, and CHT tend to
  stick). To force a worst-case value for a screenshot, overwrite the DOM text
  node directly via CDP and capture in the same evaluate.
- `sio.emit("gforce",{x,y})` latches `imuPeak.g`.
- Toggling extend mode (`projectionSafeAreaDrawOutside`) etc. is most reliable via
  CDP into the renderer store, or by editing `config.json` + reboot.
- **Sensor-only changes are the FAST path** (round-carplay-style setups): sensor
  scripts under `~/sensors/*.py` run as `systemd --user` services; `scp` the file
  and `systemctl --user restart <svc>` — no app rebuild/reboot. (LIVI's sensor
  wiring may differ; check before assuming.)

### ⚠️ BNO085 board #1 KILLED by 5V on VIN (2026-07-08 late) — READ BEFORE WIRING #2
- **NEVER feed this Adafruit BNO085 breakout (4754) 5V on VIN.** Its P0/P1
  mode-select solder jumpers tie the pins to **VIN directly** (measured: P0
  = VIN exactly), so VIN=5V puts 5V on a 3.3V-max mode pin. Board #1 ran
  perfectly on 3V3-VIN for ~30 min, spent minutes on 5V (attempted crank-
  brownout mitigation), then went permanently mute on EVERY supply incl.
  wall power. Post-mortem meter readings: P1 floating at 1.42V (should be
  0 via pulldown), RST dragged to 2.1V through its own 10k pullup (~120µA
  leak) = damaged I/O ring. Green power LED proves only the regulator.
- Diagnostic technique that worked (remote, via pinctrl): RX(GPIO15) pull-
  DOWN probe — stays hi = TX wire attached; RST(GPIO17) pull-down probe —
  hi = board powered (its 10k pullup wins); RST reads LOW even with Pi
  pull-UP = board UNPOWERED (ESD clamp) → check VIN/GND wires first.
- While VIN is pulled for a latch-up power-cycle, the Pi's GPIO pull-ups
  (RX + RST) trickle-feed the dead board and can hold the chip above true
  zero — disable them first (`pinctrl set 15 pn; pinctrl set 17 ip pn`,
  stop imu.service so it doesn't re-arm them) for a genuine cold discharge.
- Bike-supply observation (pre-damage, still to solve for board #2): chip
  powering up TOGETHER with the Pi on bike power failed twice; powering it
  up AFTER the Pi was fully booted (hot VIN replug) worked. Plan for #2:
  keep VIN on 3V3 (pin 1), add small series resistors (~330-470Ω) in SDA
  and RST wires, and a GPIO-controlled load switch on VIN so the driver
  can sequence power AND auto-power-cycle as the final ladder rung.
- Interim: BNO055 can be rewired (VIN pin1, GND, SDA→pin10, SCL→pin8, PS1
  high, RST→pin11); restore its driver from `~/sensors/imu.py.bak-bno055-final`.

### BNO085 (target architecture, board #1 installed then lost 2026-07-08) — UART-RVC driver
- The BNO055 was RETIRED 2026-07-08 (see its sections below for history) and
  replaced with a BNO085 running **UART-RVC mode**: streams 19-byte frames at
  100 Hz/115200 from the instant it has power — no init, no calibration state,
  no CALIBRATING on the dash ever, brownout = ~1s stream gap that self-heals.
- Wiring: VIN→pin1 (3V3), GND, SDA→pin10 (RVC TX), RST→pin11 (GPIO17, ladder
  kept). **P0 solder jumper bridged on the board back selects RVC; P1 open.**
  (BNO055 tied PS1 high — do NOT carry that wire pattern over.)
- Driver: `~/sensors/imu.py` (container archive `~/LIVI-sensor-backups/
  imu.py-bno085-rvc-2026-07-08`; BNO055 final = `imu.py.bak-bno055-final` on
  Pi). Emits the same events (`lean`/`pitch`/`gforce`/`imu-status`), 10 Hz.
- **Empirical RVC conventions on this board (measured, do not "fix" from a
  datasheet):** bike lean lives on RVC *roll*, bike pitch on RVC *pitch*
  (mounted chip-up, VIN edge forward), BUT gravity pairs OPPOSITE to
  aerospace ZYX: gravity_in_body = (−sin r·cos p, +sin p·cos r, cos r·cos p).
  RVC accel is RAW (gravity included) unlike BNO055 LIA — the driver
  subtracts analytically; **install check: parked G must read 0.00 at any
  lean** (verified 2026-07-08). Frame parser must advance ONE byte on
  checksum failure (stray 0xAA overlaps eat real frames otherwise).
- Display sign flips / zeroing are APP-side and persist in config.json:
  Reverse Tilt, Reverse Pitch toggles + Tilt Calibration "Set Level"
  (settings). Byron tuned these himself 2026-07-08 — don't override in the
  driver (LEAN_SIGN/PITCH_SIGN stay +1).
- Watchdog: no frames 3s → reopen serial ×2 → GPIO17 RST pulse ×3 → declare
  dead, honest status, 30s retries. Validated live: detected a dead board
  (unplugged VIN during mounting) and recovered the instant power returned.
  Unpowered-board signature via pinctrl: RX (GPIO15) idles LOW and GPIO17
  reads LOW even with Pi pull-up (ESD clamp) — that means NO POWER, check
  VIN/GND before software.

### BNO055 crank failures — THREE modes, not one (RETIRED CHIP — history)
- **Mode A — fusion wedge** (the two lost rides): UART ACKs, Euler frozen,
  sys-cal 0, dash stuck CALIBRATING. RST_SYS can't clear it; the GPIO17
  hardware RST pulse can.
- **Mode B — full latch-up** (proven by experiment): a crank brownout can
  leave the chip silent on EVERY bus (UART and I2C both dead, probed with
  proper pullups). The RST pin does NOT recover this. ONLY removing power
  does — 15s ignition-off fixed it with zero wiring changes. Next hardware
  step if this recurs often: GPIO-controlled load switch on BNO VIN (a
  power-cycle rung for the ladder), or replace with BNO085.
- **Not a failure — Pi reboot on start**: sometimes the crank reboots the
  whole Pi. That path is GOOD (BNO gets a clean power-on). But beware the
  crank rail gate in imu.py: this bike's EXT5V rail is 4.73-4.86V STEADY
  with the engine running (its normal healthy state). A gate threshold of
  4.85V made every engine-on boot hold IMU init for the full 45s max-wait,
  which reads as "no data / not fixed" on the dash. Threshold is now 4.65V
  (settle 6s, max-wait 15s) — genuine crank sags go below 4.6V. Do not
  raise it back.
- **Mode C — parked false-positive**: a healthy DEAD-STILL bike with sys-cal
  0 can hold bit-identical Euler 30s+ (side stand, garage). The parked-freeze
  detector now stands down after 2 parked resets until real gyro motion or
  sys>0 — do not "fix" the churn by re-arming it off the healthy-ladder
  clear; those two cycle against each other (observed).

### BNO055 hardware reset line (learned 2026-07-05)
- **Failure:** engine cranking sags the 12V rail → partial brownout wedges the
  BNO055's internal fusion core: UART still ACKs, raw sensors read, but Euler
  freezes bit-identical with sys-cal stuck 0. Dash shows CALIBRATING forever,
  lean/G graphs empty. **Register reset (RST_SYS) can NOT clear a hard wedge**,
  and a Pi reboot doesn't either (3V3 stays up). Historically only a physical
  power pull recovered it.
- **Fix:** BNO RST pin is jumpered to **GPIO17 (physical pin 11)**. `imu.py`
  runs an escalation ladder: 2× RST_SYS → hardware RST pulse (validated live:
  the pulse recovered a real hard wedge on 2026-07-05) → after 3 failed pulses,
  declares hard-wedge (honest status, no fake CALIBRATING, 120s retries).
  Ladder clears after 60s of healthy output.
- GPIO via Pi 5's `pinctrl` (no python GPIO deps): assert = `pinctrl set 17 op
  dl`, release = `pinctrl set 17 ip pu`. The service pins GPIO17 input+pull-up
  at startup — **a floating RST line causes random resets**.
- Manual test: pulse per above; imu.service logs "chip left NDOF" and
  re-initializes in place with live telemetry back within ~15s.
- Backups of pre-change script: `~/sensors/imu.py.bak-preRST-*`.

---

## 8. Restore clean Pi state (ALWAYS do this at the end)

After any debug session:
```bash
# remove CDP flag if present, then reboot
ssh … "sed -i 's# --remote-debugging-port=9222 --remote-allow-origins=\*##' ~/.config/autostart/LIVI.desktop && sudo systemctl reboot -i"
```
Then verify ALL of:
- `ss -ltn | grep 4000` → listening (app healthy); **9222 NOT listening**.
- Process cmdline has **no** `--remote-debugging-port`:
  `cat /proc/$(pgrep -f LIVI.AppImage | head -1)/cmdline | tr '\0' ' '`
- Autostart flag count 0: `grep -c 9222 ~/.config/autostart/LIVI.desktop`
- No crashes: `grep -acE 'Segmentation|Bus error|uncaughtException|ENOENT' ~/LIVI/LIVI.log` → 0
- No core files: `ls /tmp/core.*` → none.

---

## 9. ⚠️ electron-builder rewrites `package.json` (Mac tree)

During packaging, electron-builder rewrites `./package.json` in place, stripping
`scripts` + `devDependencies`. If interrupted mid-write it leaves **truncated /
invalid JSON**; a later build then bakes a broken `package.json` into `app.asar`
→ Electron can't find `main`, falls back to `default_app.asar`, exits 1 → **black
screen / app never starts** (port 4000 never opens).

After every Mac build, before committing/rebuilding:
```bash
git checkout -- package.json
python3 -c "import json; json.load(open('package.json'))"   # must parse
```
Never commit the stripped package.json. Diagnose a broken one with:
`strace -f -e openat ./LIVI.AppImage 2>&1 | grep default_app` (a `default_app.asar`
lookup confirms the broken-package.json cause).

---

## 10. Checks / tests (run on the Mac before deploying)

```bash
npm run typecheck                                   # tsc node + web
npx biome check --write <edited files>              # lint/format only what you touched
npm test                                            # full suite (~3146: 2103 main + 1043 renderer)
npx jest Projection                                 # just the projection/overlay tests when iterating
```
- `motoGraphPaneGeometry` and the graph-pane container style are asserted in
  `src/renderer/src/components/pages/projection/__tests__/Projection.test.tsx`;
  update those assertions if you change the pane geometry.
- Tests print "A worker process has failed to exit gracefully" — harmless.

---

## 11. Git

- Push to **`origin`**: `git push origin main` (byroncoughlin/motoCarPlay, has access).
- Do NOT `git push fork` in LIVI (that's a round-carplay convention; LIVI has no
  `fork` remote).
- Only commit when asked. Never commit `.claude/` (untracked helper dir).

---

## 12. One-shot health checklist (paste-and-run)

```bash
ssh -o ConnectTimeout=8 byron@192.168.4.25 '
  echo "boot: $(uptime -s)";
  echo -n "port4000: "; ss -ltn | grep -q ":4000" && echo UP || echo DOWN;
  echo -n "port9222(should be closed): "; ss -ltn | grep -q ":9222" && echo OPEN || echo closed;
  echo -n "debug flag in proc: "; cat /proc/$(pgrep -f LIVI.AppImage | head -1)/cmdline 2>/dev/null | tr "\0" " " | grep -q remote-debugging && echo YES || echo no;
  echo "gst: $(grep -aoE "GStreamer [0-9.]+|native addon load failed" ~/LIVI/LIVI.log | tail -1)";
  echo "codecs: $(grep -a "GStreamer codecs" ~/LIVI/LIVI.log | tail -1)";
  echo "firstframe: $(grep -a FirstFrame ~/LIVI/LIVI.log | tail -1)";
  echo "crashes: $(grep -acE "Segmentation|Bus error|uncaughtException|ENOENT" ~/LIVI/LIVI.log)";
'
```
Healthy = 4000 UP, 9222 closed, no debug flag, `GStreamer <ver>` (not "load
failed"), codecs with `sw=true`/`hw=true`, FirstFrame present, crashes 0. Then
`grim` to confirm CarPlay renders in the center square.

