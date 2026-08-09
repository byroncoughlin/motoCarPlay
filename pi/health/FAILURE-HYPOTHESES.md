# What is probably wrong with the bike dashboard

Written 2026-08-09, after a two-day trip (~5 h riding each day) during which
USB devices repeatedly dropped — sometimes all four at once, recoverable only by
killing bike power — and, on other occasions, the entire display froze including
the clock and every sensor.

This is a ranked set of hypotheses reasoned from the setup as it is actually
installed, not from the logs: **no log evidence of the trip survives.** `LIVI.log`
was truncated on every boot, the systemd journal was volatile, and core dumps
landed in tmpfs. That gap is now closed (§ *Instruments*), so the value of this
document is that each hypothesis below names the thing that would confirm or kill
it and the instrument that will capture it next time.

## The setup, as measured

| | |
|---|---|
| Power | One 5 V feed off the bike. `psu_max_current` reports **unknown** — the firmware never negotiated or verified the supply's capability |
| USB budget | `usb_max_current_enable=1` in `config.txt` — this **lifts** the Pi 5's default 600 mA USB cap to 1.6 A, regardless of whether the supply can source it |
| Bus 1 (`xhci-hcd.0`) | CarPlay dongle `1-1` (Magic Communication "Auto Box", declares **bMaxPower 0 mA**), touch panel `1-2` (Waveshare 034-HD, declares 100 mA, **takes its power over this cable**) |
| Bus 3 (`xhci-hcd.1`) | IMU `3-1` (CH340), GPS `3-2` (CP2102N), 100 mA each |
| Hubs | None. All four devices are direct, all USB 2.0 |
| Video | HDMI-A-1. Only the panel's *power* is USB |
| Rail, engine off | 4.856–5.085 V over 4 065 samples; `throttled` = `0x0` throughout; `uv_ever` never set |
| Rail cost of the app | Running the app lowers the minimum by ~120 mV (idle windows bottomed at 5.006, app-running windows at 4.856–4.900) |
| SoC temp, garage | 52.9–61.7 °C |
| Memory | ≥6.7 GB available at all times — not a factor |
| Kernel watchdog | BCM2835, armed, `RuntimeWatchdogSec=1m`, PID 1 petting it |

## Ranked hypotheses

### 1. Transient 5 V collapse dragging USB VBUS down — the leading explanation for "all four drop at once"

The single most diagnostic detail Byron reported is that recovery required
**killing bike power**. A driver or enumeration problem clears on a controller
rebind; needing the rail to actually go away points at port power or a device
stuck below its own reset threshold. That is a supply symptom.

The margin supports it. Undervoltage trips at roughly 4.63 V on a Pi 5; the
lowest reading in an hour of *garage idling* was 4.856 V, leaving ~220 mV, and
simply running the app spends ~120 mV of it. Add the backlight at full
brightness, the dongle streaming, GPS and IMU polling, engine heat, and a
12 V→5 V converter working off a charging system from 1975, and the remaining
headroom is thin. `usb_max_current_enable=1` makes this worse rather than
better: it authorises up to 1.6 A of USB draw from a supply the firmware has
never verified — the flag raises the *permission*, not the *capability*.

Two further details fit. The dongle declares `bMaxPower 0 mA`, so the host
cannot budget for it at all. And all four devices share one rail, which is
exactly why they would fail together.

- **Predicts:** simultaneous drops, correlated with load rather than with road
  surface; `uv_ever` latching; possibly `over-current` in `dmesg`.
- **Confirms it:** `health.csv` showing `ext5v` below ~4.7 or a nonzero
  `throttled`/`uv_ever` within seconds of a `USB-GONE` burst in `events.log`.
- **Kills it:** a multi-device `USB-GONE` burst with `ext5v` flat above 5.0 and
  `throttled` still `0x0` for the whole window.
- **Honest limit:** the recorder samples at 1 Hz and cannot see a microsecond
  droop. The catch for that is `uv_ever`, which is a *sticky* firmware bit — it
  latches on a transient the sampler would miss entirely. Watch that column, not
  the instantaneous voltage.

### 2. Connector fretting from vibration

A 1975 airhead vibrates, four unstrained USB-A plugs hang off the Pi, and the
CHT investigation already established that this harness's weak point is long
unsupported jumper wire. A partially backed-out plug intermittently opens VBUS,
which looks identical to a device failure.

- **Predicts:** drops track rough road and revs rather than load; *individual*
  devices drop independently far more often than all four together; one port is
  consistently worse; re-seating fixes it for a while.
- **Confirms it:** `USB-GONE` for a single device with the rail flat, clustering
  by riding condition rather than by CPU/GPU activity.
- **Kills it:** every recorded episode is all-four-at-once — that is a shared-rail
  signature, not a mechanical one.
- **Instrument:** the per-port columns `u11`/`u12`/`u31`/`u32` in `health.csv`,
  which distinguish "one device" from "the whole bus" at 1 Hz.

### 3. Thermal, as the cause of the *freeze* rather than the USB drops

61.7 °C in a cool garage with the engine off is a floor, not a ceiling. Behind a
fairing, in sun, above a hot air-cooled engine, five hours in, 75–85 °C is
entirely plausible; the Pi 5 soft-throttles at 80 °C and hard-throttles at 85 °C.
Throttling degrades performance rather than dropping USB, which is why this sits
under the freeze and not under hypothesis 1.

- **Predicts:** failures cluster late in a long ride and on the hotter of the two
  days; `soc_c` climbs monotonically; `throttled` shows `0x2`/`0x8`.
- **Confirms it:** `soc_c` above 75 °C in the minutes before an event.
- **Kills it:** `soc_c` under 70 °C across a failure.

### 4. A userspace deadlock in the renderer or compositor — the freeze itself

That the *clock* froze is the important part: the clock is drawn by the renderer,
not by the CarPlay pipeline, so this was not a video-decode stall. And because
the hardware watchdog is armed and would have rebooted a genuine kernel hang
within 60 s, the fact that Byron had to power-cycle proves the kernel was alive.
Something in userspace stopped painting while the kernel kept petting the dog.

- **Predicts:** renderer CPU at zero while the main process still runs, or the
  compositor alive but no longer producing frames for `grim`.
- **Confirms it:** `livi-freeze-watch` firing with `renderer-frozen` or
  `compositor-wedged`, plus its forensics dump of per-process states.
- **Instrument:** this is precisely what `livi-freeze-watch` was built for, and
  it now also *recovers* it — restart first, reboot only if that fails. Core
  dumps land in `~/LIVI/cores` instead of vanishing with tmpfs.

### 5. The freeze and the USB drops are one event, not two

A touch panel that drops off bus 1 takes an input device out from under the
compositor; a dongle that disappears mid-stream can wedge the GStreamer pipeline
while it holds GPU resources. Either could present as a frozen screen whose real
cause was a USB event seconds earlier. Equally, the causation could run the other
way. This is worth its own line because **it is the cheapest thing on this list
to settle** — `events.log` now records USB transitions and freeze verdicts in one
file against one clock, so the ordering will simply be visible.

### 6. Ignition EMI

CLAUDE.md states that ignition EMI is the trigger for the CHT register
corruption. **That is stated more confidently there than the evidence supports** —
bike power measured clean at rest, `throttled=0x0`, `EXT5V ≈ 5.03 V`, and the
EMI attribution rests on the fault clustering with the engine running rather than
on any direct measurement. It remains plausible for USB too: a points-and-coil
airhead, unshielded cable runs, and USB 2.0 differential pairs are a poor
combination. It is ranked here rather than higher because EMI more typically
corrupts traffic than removes a device from the bus, and removal is what was
reported.

- **Kills it:** any drop recorded with the engine off.

### 7. Dongle firmware

Wireless CarPlay boxes are a flaky class of hardware, and this one declares no
power requirement at all. Ranked last on current evidence: of the 67 dongle
disconnects on record, **65 were artefacts of the app not running** — with
nothing driving it, the dongle re-enumerates on a fixed ~13 s cycle, and every
one of those bursts began about a second after `APP LOST telemetry port 4000`.
**Zero dongle drops have been recorded while the app was healthy.** Do not read
that disconnect count as a fault rate.

## What is now instrumented

| Question | Where the answer will be |
|---|---|
| Did the rail sag? | `health.csv` → `ext5v`, `throttled`, `uv_now`, **`uv_ever`** (sticky) |
| Was it hot? | `health.csv` → `soc_c` |
| Which device went, and when? | `health.csv` → `u11`/`u12`/`u31`/`u32`; `events.log` → `USB-GONE`/`USB-BACK` |
| Did the app freeze, and which part? | `events.log` → `FREEZE-*`; per-process CPU columns |
| Did a USB event precede the freeze? | `events.log` — one file, one clock, both event types |
| What did the app say? | `~/LIVI/logs/LIVI-<boot>.log`, one per boot, no longer truncated |
| Did something crash? | `~/LIVI/cores/`, and the journal is now persistent across boots |

## What would move this forward fastest

Cheap and diagnostic, in order:

1. **Ride it and read `events.log`.** Hypotheses 1, 2, 5 and 6 are separated by
   evidence that now gets collected automatically. This costs nothing.
2. **Measure the 5 V supply under load with the engine running** — the one number
   nobody has. Specifically its rated current and its behaviour at peak draw, not
   its idle voltage.
3. **Consider setting `usb_max_current_enable=0`** as an experiment. It is a
   one-line change in `config.txt`. If the failures stop, hypothesis 1 is proven
   and the fix is a better supply rather than a lower cap. The risk is that
   600 mA may not run the panel plus the dongle, in which case the experiment
   fails loudly and immediately rather than subtly.
4. **Strain-relieve the four USB plugs.** Independently worth doing, and it
   removes hypothesis 2 from the board.

## Open questions for Byron

Answers to these would re-rank the list immediately:

- Was the engine running at each failure, or did any happen with it off?
- Did the freezes and the USB drops ever happen at the same time, or always
  separately?
- Rough ambient temperature on each day, and was the dash in direct sun?
- How is the Pi powered off the bike — what converter, what rating, what cable?
- Did failures correlate with rough road, or with engine start, or with neither?
- Roughly how far into each ride did they happen?
