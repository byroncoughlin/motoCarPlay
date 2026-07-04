# Project Notes for Claude — LIVI

LIVI is an Electron app for a Raspberry Pi 5 motorcycle dashboard (800×800 round
display, CarPlay-only build). These notes capture hard-won build/deploy workflow
so future sessions don't re-derive them.

## Display geometry

- 800×800 round display.
- CarPlay center square: **586×586** (centered). Inset from each edge =
  `(800-586)/2 = 107px` → fraction `107/800 = 0.13375`.
- Constants live in `src/main/shared/utils/motoGeometry.ts`
  (`MOTO_DISPLAY_SIZE`, `MOTO_CENTER_SQUARE_SIZE`, `MOTO_SQUARE_INSET_FRAC`,
  `isSquareContainedProjection`).

## CarPlay resolution containment (compositor inset — Fix A)

Non-800 CarPlay resolutions must be **contained inside the 586 center square**,
not stretched to fill the whole 800 output. Three layers must agree:

1. **Native compositor** (`native/livi-compositor/livi-compositor.c`): the
   `videocfg` control message takes an optional destination inset expressed as a
   fraction (0..0.5) of the output. `videocfg <tag> <screen> <cropL> <cropT>
   <visW> <visH> <tierW> <tierH> [<dstInsetXFrac> <dstInsetYFrac>]` — 8 fields =
   legacy (fill output), 10 fields = contained to inner rect
   `(ow-2*dix, oh-2*diy)`.
2. **Main process** (`GstVideo.ts` → `ProjectionService.applyVideoCrop`):
   computes `squareInsetFrac = isSquareContainedProjection(w,h) ?
   MOTO_SQUARE_INSET_FRAC : 0` and forwards it through `setContentRegion` →
   `videocfg`.
3. **Renderer**: `Projection.tsx` sets the `<ViewAreaMask>` to the 586 square and
   passes `displayInsetX/Y` into `useProjectionTouch`, whose `norm()` shrinks the
   usable rect by the inset before AR-letterboxing so touch maps pixel-perfect.

A stream is "square-contained" when `projectionWidth < 800 || projectionHeight <
800`.

## ⚠️ gst_video.node MUST NOT be rebuilt on the Pi

`node_modules/gst-video/build/Release/gst_video.node` is a native addon
(node-gyp) compiled on the target (ARM). It is **not** in git (build/ is
gitignored) and cannot be cross-compiled from Mac.

**THE TRAP:** a freshly `node-gyp rebuild`-ed `gst_video.node` on the Pi's
*current* environment produces a **~78832-byte binary linking 31 libraries** that
**crashes the whole app with SIGBUS** in Chromium child processes at startup →
port 4000 never opens, only a loading spinner. The Pi's gstreamer/pkg-config
environment changed since the addon was first built, so `pkg-config --libs` now
emits extra transitive `-l` flags that drag in 14 extra deps and corrupt the
process.

**The WORKING binary is the ~144408-byte one linking 17 libraries** (built
Jun 30, from the identical `gst_video.cc` source). **REUSE it. Do NOT rebuild
gst-video.** A copy lives at
`~/LIVI-build/dist/linux-arm64-unpacked/resources/app.asar.unpacked/node_modules/gst-video/build/Release/gst_video.node`
on the Pi.

Do NOT keep ARM `gst_video.node` / `livi-gst-host` in the Mac tree — a Mac
electron-builder would ship the broken binary silently. If a Mac build is ever
attempted, it should fail loudly (ENOENT) instead.

## Build (do it ON THE PI, not on Mac)

Mac cannot produce a working ARM AppImage (missing/broken native gst-video, and
the compositor is Linux/ARM-only). Build in `~/LIVI-src` on the Pi:

1. rsync Mac `src/` (with `--delete`) + `native/livi-compositor/livi-compositor.c`
   to `~/LIVI-src/`. **Do NOT re-sync/rebuild gst-video** (keep the 144k
   `gst_video.node`).
2. `export PATH=$PWD/node_modules/.bin:$PATH && vite build`
3. `bash scripts/compositor/build-linux.sh` (verify BuildID / `dst_inset` appears
   9× in the .c). Compositor is Linux/ARM only; `build-linux.sh` no-ops on Darwin.
4. electron-builder needs a working pnpm. Pi global pnpm 11.5.3 needs Node 22
   (Pi has Node 20) → `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`. Workaround:
   `~/bin/pnpm` wrapper = `exec node
   ~/.cache/node/corepack/pnpm/9.15.9/dist/pnpm.cjs "$@"`, temporarily set
   `package.json` `"packageManager": "pnpm@9.15.9"` (restore after), then:
   `PATH=$HOME/bin:$PWD/node_modules/.bin:$PATH electron-builder --linux AppImage
   --arm64 --publish never --config`.

## Deploy to the Pi

Target: `/home/byron/LIVI/LIVI.AppImage` (autostart runs it). The running app
holds the file busy, so a direct `cp` fails ("Text file busy"). Use atomic mv:

```bash
cp <appimage> ~/LIVI/LIVI.AppImage.new
mv -f ~/LIVI/LIVI.AppImage.new ~/LIVI/LIVI.AppImage
chmod +x ~/LIVI/LIVI.AppImage
sudo reboot
```

## Pi testing workflow

- Host: `byron@192.168.4.25`, passwordless sudo. Always `ssh -o ConnectTimeout`.
- **Don't `pkill` the app/compositor** — it churns the Wayland session and drops
  your SSH (exit 255) and the app respawns. Prefer reboots + atomic mv.
- **Boot health:** `ss -ltn | grep 4000` (UP = server healthy),
  `grep -acE 'Segmentation|Bus error' ~/LIVI/LIVI.log`, check `/tmp/core.*`
  (none = good), stream caps via
  `grep -aoE 'width=\(int\)[0-9]+, height=\(int\)[0-9]+' ~/LIVI/LIVI.log`.
- **Screenshots (sees composited video):**
  `ssh … 'export XDG_RUNTIME_DIR=/run/user/1000; export WAYLAND_DISPLAY=wayland-0;
  grim /tmp/r.png'`, scp to Mac, analyze with `/usr/bin/python3` (has PIL).
  NOTE: CDP `Page.captureScreenshot` only sees the DOM layer — the CarPlay video
  is composited *under* the Wayland surface and shows as white in CDP. Use grim
  to see actual video pixels.
- **Resolution test:** `~/setres.py <R>` sets projectionWidth/Height=R +
  view-area insets=0 in `~/.config/LIVI/config.json`; reboot (~85s). Backup:
  `~/config.backup.json` (800 / insets 107).
- **Touch test over CDP:** add `--remote-debugging-port=9222
  --remote-allow-origins=*` to the autostart Exec line, reboot, then
  `Input.dispatchMouseEvent` (mousePressed+mouseReleased, pointerType touch) at a
  screen coord; verify the correct CarPlay element responds (inside the 586
  square) and margin taps hit dash UI (outside the square). Revert the flag after.
  `/tmp` is tmpfs (wiped on reboot) — re-scp helper scripts each boot.

## Git

origin = `https://github.com/byroncoughlin/LIVI.git` (has push access).
