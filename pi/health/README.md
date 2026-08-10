# Pi resilience services

Three root services that watch the dashboard on the bike and try to keep it
alive without a rider touching anything. They were written after a two-day trip
during which USB devices dropped — sometimes all four at once — and, separately,
the whole display froze including the clock. The touchscreen is one of the USB
devices, so the rider cannot tap to recover; that is the constraint the whole
design answers to.

Everything here is stdlib Python 3, no dependencies, and runs as root.

| File | Installs to | Job |
|---|---|---|
| `livi-health-recorder` | `/usr/local/bin/` | 1 Hz flight recorder: rail voltage, throttling, SoC temp, load, memory, port 4000, per-USB-port presence, per-process CPU |
| `livi-usb-guard` | `/usr/local/bin/` | Detects a device that has gone missing and climbs a recovery ladder |
| `livi-freeze-watch` | `/usr/local/bin/` | Detects a userspace freeze and restarts the app, then reboots if that fails |
| `*.service` | `/etc/systemd/system/` | Units for the three above |
| `50-livi-persistent.conf` | `/etc/systemd/journald.conf.d/` | Persistent journal — the default is volatile, so a reboot destroyed the evidence for every boot-time fault |
| `60-livi-cores.conf` | `/etc/sysctl.d/` | Core dumps to `~/LIVI/cores` instead of tmpfs, where they died at reboot |
| `run-livi.sh` | `~/LIVI/` | App launcher: per-boot log file, boot header, core limit |
| `pi-health.sh` | anywhere | One-shot health readout for a human |

Output lands in `/var/log/livi-health/`: `health.csv` (the 1 Hz record),
`events.log` (things worth a human's attention), `state.json` /
`freeze-state.json` (what has already been tried, so a reboot cannot reset the
budgets).

## Install

```bash
sudo install -m 755 livi-health-recorder livi-usb-guard livi-freeze-watch /usr/local/bin/
sudo install -m 644 *.service /etc/systemd/system/
sudo install -m 644 -D 50-livi-persistent.conf /etc/systemd/journald.conf.d/50-livi-persistent.conf
sudo install -m 644 60-livi-cores.conf /etc/sysctl.d/
sudo sysctl --system && sudo systemctl restart systemd-journald
sudo systemctl daemon-reload
sudo systemctl enable --now livi-health-recorder livi-usb-guard livi-freeze-watch
```

Each service stands down entirely if its disable flag exists, while still
recording what it saw — `/etc/livi-usb-guard.disabled`,
`/etc/livi-freeze-watch.disabled`. Use those rather than stopping a unit when
you want to observe a fault without anything intervening.

## Tests

```bash
python3 pi/health/test_usb_guard.py        # 30 checks
python3 pi/health/test_freeze_watch.py     # 24 checks
python3 pi/health/test_health_recorder.py  # 21 checks — log rotation
```

Run from the repo root. Both stub every call that touches the machine; what
they exercise is the policy — when each service waits, when it acts, what it
refuses to do twice, and what it leaves alone. These programs can reset USB
devices and reboot a dashboard mid-ride, so the interesting property is not
that they detect a fault, it is that they never act when they should not.

## Policy that is not obvious from the code

**Bus 1 is never rebound.** `xhci-hcd.0` carries the CarPlay dongle (`1-1`) and
the touch panel (`1-2`). The panel takes its *power* over that USB cable, so a
controller rebind blanks the screen. Bus-1 devices get device-scoped actions
only (`usbreset`, re-authorize), and if one vanishes from the bus entirely the
guard logs `USB-NEEDS-REBOOT` and stops. Bus 3 (`xhci-hcd.1`, IMU `3-1` and GPS
`3-2`) carries nothing that powers the display, so the full ladder including a
controller rebind is allowed there. The rebind has been tested live: both
devices re-enumerated, `/dev/serial/by-id` came back, and the sensor drivers
reopened so transparently they logged nothing.

**A kernel hang is already handled and is not what these services are for.**
`/usr/lib/systemd/system.conf.d/40-rpi-enable-watchdog.conf` arms the BCM2835
hardware watchdog with `RuntimeWatchdogSec=1m`; PID 1 holds `/dev/watchdog0`
and pets it. A genuine kernel hang therefore self-resets in 60 s. Byron had to
power-cycle the bike instead, which means the freeze he saw was **userspace** —
that is what `livi-freeze-watch` looks for.

**The freeze oracle is renderer CPU, not the picture.** A parked dash legitimately
holds one identical frame for a long time, so frame staleness alone can never
justify a reboot. The measured idle floor for the renderer process is ≥60
jiffies per 15 s; exactly 0 is impossible on a live system. A freeze is declared
only on the conjunction — 0 renderer CPU *and* an unchanging frame — held for
120 s. Frame staleness on its own is recorded and never acted on.

**`livi-freeze-watch` cannot see a panel-side freeze — a known blind spot.** It
judges liveness from `grim`, which captures what the Pi *composites*, not what
the touch panel *displays*. The panel takes its power over USB, so a sagging rail
can hang its controller while the Pi carries on perfectly: grim keeps returning
fresh changing frames, the watchdog correctly concludes all is well, and the
screen in front of the rider is frozen anyway. Never read "the watchdog took no
action" as "the dash was fine". The discriminator is `health.csv` at the minute
of the reported freeze — if renderer CPU is healthy and frames were changing
throughout, the Pi was alive and the panel was the thing that died. See
`FAILURE-HYPOTHESES.md` § 2.

**Restarts are tried before reboots, and both are budgeted.** Two restarts per
30 min, then one reboot per 30 min, then a hard cap of three reboots per 24 h,
after which it logs `FREEZE-NEEDS-HUMAN` and stops. The budgets live in
`freeze-state.json` so a reboot cannot launder them. A compositor that has
stopped producing frames skips straight to a reboot: the app cannot draw
through a dead compositor, so restarting it would accomplish nothing.

**The relaunch has to be `Type=forking`.** LIVI re-execs itself with
`--ozone-platform=wayland` and the first process exits — a healthy dash has both
a bare `LIVI.AppImage` and an `--ozone-platform=wayland` one, both reparented to
init. Under the default `Type=simple`, systemd sees that exit ~800 ms in, calls
the service finished, and tears down the cgroup, taking the real app with it.
The journal cheerfully reports `Finished with result: success` while the screen
goes dark. Two other traps on the same path: `setsid --fork` changes the session
but *not* the cgroup, so it dies the same way; and `systemd-run --uid=1000`
drops supplementary groups, and byron needs `video`, `render` and `input` to
reach `/dev/dri` — so the cgroup comes from `systemd-run` and the credential
comes from `sudo -u byron` inside it.

**There is still no way for the rider to recover the dash by hand.** The
touchscreen is one of the devices that drops, so tapping is out, and SSH needs a
laptop. `ESCAPE-HATCH.md` proposes the options — a handlebar power cut and a GPIO
button — with a matrix of which failure modes each one actually reaches. **None of
it is implemented**; it is waiting on Byron's decision.

**Nothing else on this machine restarts the app.** CLAUDE.md used to say it
respawns after a kill; it does not. There is no supervising unit, no cron, and
no compositor autostart — the XDG autostart entry runs once at login. Before
`livi-freeze-watch`, a crashed app meant a dead dash until someone rebooted.
