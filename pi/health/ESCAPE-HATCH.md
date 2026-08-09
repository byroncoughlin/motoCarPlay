# Manual escape hatch — options, not yet built

**Nothing in this document is implemented.** It is a proposal for the one gap the
three resilience services cannot close by themselves, written so the decision can
be made in one sitting. Wiring anything to the bike is Byron's call.

## The gap

When the dash froze on the trip, there was no way to recover it from the saddle.
The touchscreen is one of the USB devices that drops, so tapping is out; SSH needs
a laptop. The only working recovery was killing bike power, which means stopping,
and on the second day it sometimes had to be done again within a minute.

`livi-freeze-watch` closes part of this automatically. What it cannot do is give
the rider a deliberate action, and it has a blind spot (a hung panel — see
`FAILURE-HYPOTHESES.md` § 2) where it will correctly do nothing while the screen
in front of the rider is dead.

## What actually needs recovering

The options below are only meaningful against the failure modes, so here they are
first. `F` is the one that matters most, because `FAILURE-HYPOTHESES.md` now ranks
it first.

| | Failure mode | Covered today by |
|---|---|---|
| A | App / renderer wedged, Pi and panel fine | `livi-freeze-watch` (restart) |
| B | Compositor wedged | `livi-freeze-watch` (reboot) |
| C | Kernel hang | BCM2835 hardware watchdog, 60 s |
| D | **Panel controller hung, Pi fine** | **nothing** |
| E | A USB device gone from the bus | `livi-usb-guard`, except bus 1 |
| F | **Supply browning out / converter heat-derated** | **nothing** |

A software escape hatch can reach A, B and E. Only cutting power reaches D and F,
because in both cases the thing that needs resetting is downstream of the Pi's
software — the panel's own controller in D, the converter itself in F.

## Option 1 — `dtoverlay=gpio-shutdown`, button to a free GPIO

One line in `config.txt`, one drop-in for logind, no daemon, no code to maintain.
The kernel's `gpio-keys` driver emits `KEY_POWER` on the falling edge; logind acts
on it. Setting `HandlePowerKey=reboot` turns the button into a clean reboot.

```
# /boot/firmware/config.txt
dtoverlay=gpio-shutdown,gpio_pin=16,active_low=1,gpio_pull=up
# /etc/systemd/logind.conf.d/50-livi-button.conf
[Login]
HandlePowerKey=reboot
```

GPIO 16 is free and idle (`pinctrl` shows 12, 13, 16–27 all unclaimed; 13 is
already spoken for by the pending CHT power-gate work, so 16 is the clean pick).
Button wires between the GPIO and any ground pin. Nothing else changes.

- **Reaches:** A, B, E — a reboot re-enumerates USB and relaunches everything.
- **Misses:** D and F. A reboot does not reliably drop USB VBUS, so a hung panel
  stays hung, and it does nothing at all for a hot converter.
- **Weakness:** logind is userspace. A freeze bad enough to wedge logind eats the
  button too. In practice the observed freezes left the kernel healthy, so this
  would probably have worked — but "probably" is doing real work in that sentence.
- **Cost:** ~£2 and twenty minutes.

## Option 2 — same button, graded presses, small daemon

Wire the button the same way but with `dtoverlay=gpio-key` (arbitrary keycode, no
logind involvement) and read it from a daemon alongside the other three:

| Press | Action |
|---|---|
| short, < 1 s | restart the app only, via the `Type=forking` path `livi-freeze-watch` already uses and has proven live |
| hold 3 s | clean reboot |
| hold 10 s | `reboot -f` |

The short press is the reason to prefer this over option 1: the app restarts in
about 45 s to first frame, a reboot costs 90 s plus, and a restart is enough for
mode A, which is the most likely software failure. The escalation ladder is the
same shape as the ones in the other three services, and the relaunch code already
exists and is tested.

- **Reaches:** A, B, E, with the cheapest action tried first.
- **Misses:** D and F, same as option 1.
- **Weakness:** one more daemon, and it can be starved by the same wedge that took
  the app. Mitigate with `Nice=-5` and no dependency on the Wayland session.
- **Cost:** the same £2, plus a day of writing and testing it to the standard of
  the other three (offline tests that prove it never fires when it should not).

## Option 3 — handlebar switch in the 12 V feed to the converter

A momentary switch that interrupts the bike's 12 V into the 5 V module. Hold two
seconds, release, everything comes back from cold.

This is the only option that reaches **every** failure mode, including the two
ranked most likely. It power-cycles the converter, the Pi, the panel and all four
USB devices in one action — precisely the recovery Byron was already performing by
unplugging, but reachable without stopping and without taking a glove off.

- **Reaches:** A, B, C, D, E, F. All of them.
- **Weakness:** it is an unclean power cut every time. The filesystem should be
  mounted with journalling intact (it is, ext4) and the app tolerates it — this is
  already how every ride ends — but repeated abuse is not free. It also removes any
  chance of capturing forensics from the freeze, since the recorder dies with
  everything else. Prefer pressing it *after* noting the wall-clock time.
- **Cost:** a switch, a relay or an appropriately rated switch for the current, and
  an hour of wiring. No software at all.

## Option 4 — extend the Pi 5 on-board power button

The Pi 5 has a power button that both halts and powers back on, and the halt state
does drop the downstream rails, so this would reach D as well. **Needs physical
verification before it can be recommended:** unlike the Pi 4's `RUN`/`GLOBAL_EN`
pads, I have not confirmed the Pi 5 brings the power button out to a header rather
than only to the on-board tactile switch. If it does not, this means soldering to
the switch pads, which is a poor trade against option 3.

Deferred pending a look at the actual board.

## Recommendation

**Option 3 plus option 2, in that order of priority.**

Option 3 first, because it is the only thing that recovers the two most likely
faults, it needs no software, and it is a strictly better version of the recovery
Byron is already doing by hand. Get that on the handlebar before the next long
ride.

Option 2 second, as the everyday tool: a short press that restarts the app in 45 s
handles the common software wedge without a full cold boot, and it keeps the flight
recorder alive so the next failure still produces evidence. The hard cut then stays
what it should be — the thing you reach for when the soft one does not work.

Option 1 only if the appetite for another daemon is zero. It is genuinely fine, it
just cannot offer the cheap action.

Nothing here should be built before the next ride produces `health.csv` data,
except option 3 — that one is worth having regardless of what the logs say, because
it is the answer to every hypothesis simultaneously.
