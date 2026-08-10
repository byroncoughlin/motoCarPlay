# What is probably wrong with the bike dashboard

Written 2026-08-09, after a two-day trip (~5 h riding each day) during which
USB devices repeatedly dropped — sometimes all four at once, recoverable only by
killing bike power — and, on other occasions, the entire display froze including
the clock and every sensor.

Revised the same day with Byron's answers, which changed the ranking materially.
The originally-leading "transient rail collapse" and the third-ranked "thermal"
turned out to be one hypothesis, not two.

**No log evidence of the trip survives.** `LIVI.log` was truncated on every boot,
the systemd journal was volatile, and core dumps landed in tmpfs. That gap is now
closed (§ *What is now instrumented*), so the value of this document is that each
hypothesis names the thing that would confirm or kill it, and the instrument that
will capture it next time.

## What Byron reported

| Question | Answer | What it does to the ranking |
|---|---|---|
| Engine running at each failure? | **Always.** Never with the engine off | Keeps EMI alive; adds engine heat and the charging system to every candidate |
| Freezes and USB drops together? | **Sometimes separately** | Weakens "they are one event", does not kill it |
| Ambient / sun? | **Very hot**, not direct sun | Thermal is live |
| Supply | **5 V 5 A USB-C.** The Pi complains it is not 27 W, so the firmware override was set | See below — the override is a *warning suppressor*, not a capability |
| Rough road? | **No correlation** | Effectively kills the vibration hypothesis |
| Timing | Random through the trip, **but by the end it was re-freezing within 5–45 s of a reboot** | This is the strongest clue of the lot |

## The setup, as measured

| | |
|---|---|
| Power | 5 V 5 A USB-C off the bike. `psu_max_current` reports **unknown** — the firmware never negotiated or verified the supply's capability |
| USB budget | `usb_max_current_enable=1` in `config.txt`, set to silence the 27 W warning. It tells the firmware to **assume** 5 A is available and lifts the default 600 mA USB cap to 1.6 A. It does not verify anything |
| Bus 1 (`xhci-hcd.0`) | CarPlay dongle `1-1` (Magic Communication "Auto Box", declares **bMaxPower 0 mA**), touch panel `1-2` (Waveshare 034-HD, declares 100 mA, **takes its power over this cable**) |
| Bus 3 (`xhci-hcd.1`) | IMU `3-1` (CH340), GPS `3-2` (CP2102N), 100 mA each |
| Hubs | None. All four devices are direct, all USB 2.0 |
| Video | HDMI-A-1. Only the panel's *power* is USB |
| Rail, engine off, garage | 4.856–5.085 V over 4 065 samples; `throttled` = `0x0` throughout; `uv_ever` never set. The official 27 W PSU measures **lower** than this — see the reference measurement below |
| Rail cost of the app | Running the app lowers the minimum by ~120 mV (idle windows bottomed at 5.006 V, app-running windows at 4.856–4.900 V) |
| SoC temp, garage, engine off | 52.9–61.7 °C |
| Memory | ≥6.7 GB available at all times — not a factor |
| Kernel watchdog | BCM2835, armed, `RuntimeWatchdogSec=1m`, PID 1 petting it |

---

## Ranked hypotheses

### 1. A heat-derated supply browning out — the single story that fits every reported detail

*Merges what were separately ranked 1st (rail collapse) and 3rd (thermal). Byron's
answers show they are the same fault.*

The decisive clue is that by the end of the trip the dash was re-freezing **within
5–45 seconds of a reboot**. A fault that returns immediately after a restart, and
only once everything is heat-soaked, is not a random software deadlock. It is a
component that has drifted out of spec and stays out until it cools. And boot is
exactly when the Pi draws its peak: four cores spinning up, USB enumerating, the
backlight coming on, all at once.

A 5 A buck converter is rated at 25 °C. Behind a fairing, above an air-cooled
engine, on a very hot day, ambient at the module can easily reach 60–70 °C, where
the same part may deliver half its rating before it folds back or its thermal
protection trips. Every reported detail follows from that one mechanism:

- **Engine always running** — engine heat plus the charging system's ripple.
- **Worse at the end of a long ride** — heat soak is cumulative.
- **Instant re-freeze after reboot** — the converter is still hot, and boot is peak draw.
- **All four USB devices dropping together** — they share one rail.
- **Recovery only by killing bike power** — that is what lets the module cool and reset.
- **No correlation with rough road** — this is thermal and electrical, not mechanical.

`usb_max_current_enable=1` is not the cause but it removes the last guard rail:
the firmware stops asking whether 5 A is really there and lets the load grow to
1.6 A on USB alone. Setting it was the right call to clear the 27 W nag; the
consequence is that a supply which is fine cold and sagging hot has nothing
checking it.

The garage numbers are consistent with a thin margin even *before* heat: 4.856 V
minimum against a ~4.63 V undervoltage trip, with the app alone costing ~120 mV.

> **Correction (2026-08-09, measured).** This section used to continue: "a genuine
> 5 V/5 A source at the Pi's pins would normally read closer to 5.1 V, so roughly
> 150–250 mV is already being lost somewhere." **That was wrong**, and the reference
> measurement below shows why. It was an assumption about what a good supply reads,
> presented as if it were a measured shortfall. The bike converter is not losing
> 150–250 mV against a good supply; it *beats* one. Nothing else in this section
> depended on that sentence — the heat-derating argument stands on the trip-return
> timing, which is untouched.

- **Confirms it:** `uv_ever` latching, or `ext5v` below ~4.7 V, in `health.csv`
  within seconds of a `USB-GONE` burst or a freeze. Also `over-current` in `dmesg`.
- **Kills it:** a failure with `ext5v` flat above 5.0 V and `throttled` still `0x0`
  across the whole window.
- **Honest limit:** the recorder samples at 1 Hz and cannot see a microsecond
  droop. The catch is `uv_ever`, a **sticky** firmware bit that latches on exactly
  the transient the sampler would miss. Watch that column, not the instantaneous
  voltage.
- **Instrument gap:** nothing measures the *converter's* temperature. `soc_c` is
  a poor proxy — the SoC has a heatsink and the converter may not. An IR reading
  of the module right after a hot ride would be worth more than any log line here.

### 2. The panel hung, not the Pi

This was missed on the first pass and is ranked second on the strength of one
observation: **the touch panel takes its power over USB.** If the rail sags, the
panel's own controller can hang while the Pi carries on perfectly underneath. A
frozen image on a hung panel is indistinguishable, by eye, from a frozen
dashboard — the clock stops either way — and it too would need a power cycle to
clear.

This is a sub-case of hypothesis 1 rather than a rival to it, but it matters
because it changes what to look at, and because of the blind spot below.

> ⚠️ **`livi-freeze-watch` cannot detect this.** It judges liveness from `grim`,
> which reads what the Pi *composites*, not what the panel *displays*. Through a
> panel-side hang, grim keeps returning fresh changing frames and the watchdog
> correctly concludes all is well — while the screen in front of the rider is
> frozen. Do not read "the watchdog took no action" as "the dash was fine".

- **Confirms it:** a freeze during which `health.csv` shows renderer CPU healthy
  and frames still changing throughout. That is proof the Pi was alive and the
  panel was not.
- **Kills it:** renderer CPU at zero across the freeze — then it really was the app.
- **How to settle it:** note the wall-clock time of the next freeze and read the
  CSV for that minute. No new code required; the flight recorder keeps running
  through a panel freeze, which is the whole point.

### 3. Ignition EMI

Promoted from sixth. Every failure happened with the engine running and none with
it off, which is exactly the signature EMI predicts, and this is a points-and-coil
airhead with unshielded cable runs near USB 2.0 differential pairs. The CHT
register corruption is already attributed to the same mechanism.

It stays below the supply hypothesis for two reasons. EMI more typically corrupts
traffic than removes a device from the bus, and removal is what was reported. And
EMI does not explain the heat correlation or the 5-second re-freeze at the end of
the trip.

One caveat carried over: CLAUDE.md states the EMI attribution for the CHT fault
more confidently than the evidence supports. It rests on the fault clustering with
the engine running, not on direct measurement — and "clusters with the engine
running" is equally satisfied by engine *heat*, which is hypothesis 1.

- **Kills it:** any drop recorded with the engine off.
- **Cheap mitigation, worth doing regardless:** shorter, shielded, ferrite-cored
  USB runs routed away from the plug leads.

### 4. SoC thermal throttling or shutdown, as distinct from the supply

61.7 °C in a cool garage with the engine off is a floor, not a ceiling. Five hours
in, on a very hot day, above an air-cooled engine, 75–85 °C is entirely plausible;
the Pi 5 soft-throttles at 80 °C and hard-throttles at 85 °C.

Ranked below the supply because throttling *degrades* rather than freezes, and it
would not drop USB devices. Kept as its own line because it is trivially separable
from hypothesis 1 in the data.

- **Confirms it:** `soc_c` above 75 °C with `throttled` showing `0x2`/`0x8`
  before an event.
- **Kills it:** `soc_c` under 70 °C across a failure while `ext5v` dips — that is
  the supply, not the chip.

### 5. A userspace deadlock in the renderer or compositor

Still possible for the freezes that happened at random earlier in the trip, which
may be a different fault from the end-of-trip cluster. The hardware watchdog is
armed and would have rebooted a genuine kernel hang within 60 s, so the fact that
a power-cycle was needed proves the kernel was alive; something in userspace
stopped painting while the kernel kept petting the dog — *if* the Pi was the thing
that froze at all, which hypothesis 2 questions.

- **Confirms it:** `livi-freeze-watch` firing with `renderer-frozen` or
  `compositor-wedged`, plus its forensics dump.
- **Instrument:** this is what `livi-freeze-watch` was built for, and it now
  recovers it — restart first, reboot only if that fails. Cores land in
  `~/LIVI/cores` instead of vanishing with tmpfs.

### 6. Connector fretting from vibration

**Effectively killed.** Byron reports no correlation with rough road. Strain-
relieving the plugs remains worth doing as hygiene, but it is no longer a
candidate explanation.

### 7. Dongle firmware

Ranked last. Of the 67 dongle disconnects on record, **65 were artefacts of the
app not running** — with nothing driving it the dongle re-enumerates on a fixed
~13 s cycle, and every burst began about a second after `APP LOST telemetry port
4000`. **Zero dongle drops have been recorded while the app was healthy.** Do not
read that disconnect count as a fault rate.

---

## Reference measurement: the official Pi 5 27 W PSU (2026-08-09, garage)

Byron swapped the bike converter for the genuine Raspberry Pi 5 supply to give the
instrumentation a known-good baseline. The result was the opposite of what was
expected and is the most useful power number collected so far.

The PD contract is real, which the bike converter's never was:

```
usbpd_power_data_objects  5V/5A  9V/3A  12V/2.25A  15V/1.8A   (27 W)
max_current               5000 mA        (was: unnegotiated, firmware-assumed)
```

So the measurement path is validated — the firmware *can* see and report a
genuine contract, and reported none for the bike converter. But the rail itself,
compared load-matched (`load1 ≤ 0.9`) at the same SoC temperature (55.6 vs
55.7 °C), engine off in both cases:

| Supply | n | min | max | mean | sd |
|---|---|---|---|---|---|
| Official 27 W PD PSU | 375 | 4.800 V | 5.033 V | **4.980 V** | 0.030 |
| Bike 5 V/5 A converter | 658 | 4.898 V | 5.069 V | **5.048 V** | 0.025 |

**The bike converter holds the rail ~68 mV higher and slightly steadier than the
official supply.** `throttled` stayed `0x0` and `uv_now` never set on either.

Three things follow:

1. **Steady-state supply capacity was never the problem.** Both sit ~350–400 mV
   above the 4.63 V trip with the app running. Any explanation of the trip
   failures has to be *transient* — heat derating, crank sag, connector chatter,
   EMI — not "the converter is too small."
2. **The bigger USB-C supply Byron ordered will not raise the resting rail.** Its
   value is headroom during transients and, if the present module is derating,
   tolerance of under-seat heat. Worth having; just don't expect these numbers to
   move in the garage.
3. **~4.98–5.05 V at the PMIC is simply where this Pi sits** under this load. It
   is not evidence of loss in anyone's cable. Treat 5.1 V as an expectation only
   at the supply's own terminals, never at `EXT5V_V`.

One transient worth recording, caught while sampling the PMIC directly: a
`VDD_CORE_A` burst to **4.30 A** pulled `EXT5V_V` momentarily to 4.94 V. That is
the shape of the thing that matters — a 100 ms core burst costs ~60 mV even on a
good supply and a cold cable, and it is invisible to a 1 Hz sampler. `uv_ever` is
the only column that can catch its worse cousin.

## What is now instrumented

| Question | Where the answer will be |
|---|---|
| Did the rail sag? | `health.csv` → `ext5v`, `throttled`, `uv_now`, **`uv_ever`** (sticky) |
| Was the SoC hot? | `health.csv` → `soc_c` |
| Was the *converter* hot? | **Nothing measures this.** IR gun after a hot ride |
| Which device went, and when? | `health.csv` → `u11`/`u12`/`u31`/`u32`; `events.log` → `USB-GONE`/`USB-BACK` |
| Was it the Pi or the panel that froze? | `health.csv` at the reported minute: Pi healthy throughout ⇒ panel |
| Did the app freeze, and which part? | `events.log` → `FREEZE-*`; per-process CPU columns |
| Did a USB event precede the freeze? | `events.log` — one file, one clock, both event types |
| What did the app say? | `~/LIVI/logs/LIVI-<boot>.log`, one per boot, no longer truncated |
| Did something crash? | `~/LIVI/cores/`, and the journal is now persistent across boots |

## What would move this forward fastest

1. **Point an IR thermometer at the 5 V converter straight after a hot ride.**
   The cheapest test of the leading hypothesis, and the one number nobody has. If
   it is above ~60 °C, that is the answer.
2. **Check the USB-C cable is 5 A rated.** A 5 A supply through a 3 A cable drops
   voltage under exactly the peak loads that matter, and would produce every
   symptom here without the converter being at fault at all.
3. **Ride it and read `events.log` and `health.csv`.** Hypotheses 1–5 are now
   separated by evidence that gets collected automatically. Note the wall-clock
   time of any freeze — that single number settles hypothesis 2.
4. **Move or heatsink the converter** if it runs hot. Getting it out of the engine's
   heat plume is a better fix than anything in software.
5. **Shorter shielded USB runs with ferrites**, away from the plug leads. Cheap,
   and it removes hypothesis 3 from the board.

Deliberately *not* recommended now: turning `usb_max_current_enable` back off. With
a genuine 5 A supply the override is legitimate, and capping USB at 600 mA would
likely starve the panel and the dongle — producing a loud new failure rather than
information about the old one. Revisit only if the converter measures cool and the
rail still sags.
