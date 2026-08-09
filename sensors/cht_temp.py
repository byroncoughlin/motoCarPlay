#!/usr/bin/env python3
"""
cht_temp.py — MAX31856 cylinder head temperature reader
Left cylinder:  SPI bus 0, CE0 (Pi Pin 24, GPIO8)
Right cylinder: SPI bus 0, CE1 (Pi Pin 26, GPIO7)

Hardware (per board, Adafruit Universal Thermocouple Amplifier MAX31856):
  VIN → 5V  (Pin 2 left, Pin 4 right)  — board regulates to 3.3V
  GND → any GND (Pin 9 left, Pin 25 right)
  SCK → Pi Pin 23 (GPIO11, SPI CLK)   [shared between both boards]
  SDO → Pi Pin 21 (GPIO9,  SPI MISO)  [shared]
  SDI → Pi Pin 19 (GPIO10, SPI MOSI)  [shared]
  CS  → Pin 24 (CE0) for left, Pin 26 (CE1) for right  [separate]
  DRDY / FLT unconnected.

Thermocouple wiring: yellow → T+, red → T-  (ANSI K-type: yellow is positive).

Unlike the old MAX31855, the MAX31856 has writable config registers. They
reset to defaults on power loss, so every read cycle checks CR0 and rewrites
the config if needed (auto-convert mode, K-type, open-circuit detection).

SPI mode 1, 250kHz.

--- Cold-boot wedge on the RIGHT board (instrumented 2026-08-08) -------------
Symptom: after the bike has been fully powered off for a while, the right
board comes up unresponsive. It recovers only when BOTH its VIN and GND wires
are pulled at the SAME time and replugged. Pulling either one alone does
nothing; moving VIN to 3V3 and changing the GND pin didn't help either.

Why one wire is never enough: the Adafruit breakout level-shifts every logic
pin against VIN, so SCK/SDI/SDO/CS — all driven or pulled to 3.3V by the Pi —
back-feed the VIN node through the shifters' clamp diodes. The MAX31856's
power-on-reset threshold is only 2.7-2.85V (datasheet Electrical
Characteristics), and that back-feed parks the rail above it. The chip stays
powered and never re-POSTs. Pulling both wires isolates the board so its caps
can actually drain below V_POR.

So this driver:
  * classifies a failed read as 'dead board' vs 'probe fault' — an open
    thermocouple must NEVER trigger recovery,
  * dumps the raw register block to a persistent fault log whenever a board
    goes dead (the journal on this Pi is volatile — one boot only, so a
    reboot destroys the evidence),
  * runs an escalating SPI-only recovery ladder, and
  * has a real power_cycle() rung ready for when the right board's VIN moves
    off Pin 4 onto a GPIO (set POWER_GPIO below). The board draws ~2mA
    (MAX31856 is 1.2mA typ / 2mA max, plus the breakout's LDO and shifter
    quiescent), well inside a Pi 5 GPIO's 8mA default drive.

--- In-flight register corruption (root-caused 2026-08-08) -------------------
Different fault, same day. After a ride: both cylinders dropped out
intermittently, the right one permanently. The right board was NOT dead — it
was reading 123.4C the whole time, matching the left. Its registers 0x02-0x09
had been zeroed, which is exactly the writable range; the read-only registers
above them were untouched. That is the signature of a spurious BURST WRITE, not
of a bad read: the MAX31856's command byte uses bit 7 to select write, so a
single corrupted address byte turns this driver's own register dump (0x00
followed by sixteen zero bytes) into a write of zeros across the whole config
block. With CJHF and LTHFT at zero the chip then alarms on every valid reading.

Faults cluster only with the engine running, on shared SCK/SDI/SDO lines, with
the boards cool (cold junction 35-40C) and no Pi undervoltage. That points at
ignition EMI from the points-and-coil airhead. The real fix is at the wiring —
shorter/shielded leads routed away from the plug leads. What this driver can do
is make the corruption survivable, which it now does: every poll verifies the
full writable block and rewrites it if wrong, so the worst case is one missing
sample instead of a dead gauge.

Pi setup: 'dtparam=spi=on' in /boot/firmware/config.txt.
Systemd service: ~/.config/systemd/user/cht-temp.service
Read the logs with:  journalctl _SYSTEMD_USER_UNIT=cht-temp.service
(plain `journalctl --user -u` does NOT resolve these over SSH)
"""

import os
import subprocess
import time
from datetime import datetime

import socketio
import spidev

INTERVAL   = 2      # seconds between readings
SERVER_URL = 'http://localhost:4000'

CR0_VALUE = 0x90    # CMODE=1 (auto conversion), OCFAULT=01 (open-circuit detect)
CR1_VALUE = 0x03    # K-type thermocouple

BOARDS = {0: 'left', 1: 'right'}

# The chip's ENTIRE writable range is 0x00-0x09; 0x0A-0x0F are read-only. This
# driver owns every one of those ten bytes and rewrites the block whenever it
# reads back wrong, so a stray write can never leave a board permanently
# mis-configured (see _write_config).
CONFIG_BLOCK = (
    (0x00, CR0_VALUE),   # CR0
    (0x01, CR1_VALUE),   # CR1
    (0x02, 0xFF),        # MASK   — report every fault in SR
    (0x03, 0x7F),        # CJHF   — cold-junction high alarm, +127C (i.e. never)
    (0x04, 0xC0),        # CJLF   — cold-junction low alarm, -64C  (i.e. never)
    (0x05, 0x7F),        # LTHFTH ┐ thermocouple high alarm, +2047C
    (0x06, 0xFF),        # LTHFTL ┘
    (0x07, 0x80),        # LTLFTH ┐ thermocouple low alarm, -2048C
    (0x08, 0x00),        # LTLFTL ┘
    (0x09, 0x00),        # CJTO   — no cold-junction offset
)
CONFIG_VALUES = [value for _, value in CONFIG_BLOCK]

# SR bits that actually invalidate a reading. The other four — TCLOW, TCHIGH,
# CJLOW, CJHIGH (0x2C) — are alarms against the user-programmable thresholds in
# 0x03-0x08; the conversion is still good when they trip. Treating any nonzero
# SR as a fault is what blanked the right cylinder for eleven minutes on
# 2026-08-08: its thresholds had been zeroed, so a perfectly good 123C reading
# raised TCHIGH+CJHIGH (SR=0x28) and this driver threw it away.
SR_OPEN, SR_OVUV, SR_TCRANGE, SR_CJRANGE = 0x01, 0x02, 0x40, 0x80
SR_FATAL = SR_OPEN | SR_OVUV | SR_TCRANGE | SR_CJRANGE

REG_NAMES = ('CR0', 'CR1', 'MASK', 'CJHF', 'CJLF', 'LTHFTH', 'LTHFTL',
             'LTLFTH', 'LTLFTL', 'CJTO', 'CJTH', 'CJTL',
             'LTCBH', 'LTCBM', 'LTCBL', 'SR')

# GPIO number carrying each board's VIN, once it moves off the 5V header pin.
# None = hard-wired to 5V, so power_cycle() is unavailable for that board.
POWER_GPIO = {0: None, 1: None}

# Consecutive dead reads before the ladder starts. Two spare reads absorb the
# ordinary transient without power-cycling a board that was only glitching.
DEAD_READS_BEFORE_RECOVERY = 3
OFFLINE_RETRY_SECONDS      = 60.0

# Escalating SPI-only un-wedge attempts, tried in order. 'flush' clocks a long
# read inside one CS window to resync a chip whose internal bit counter has
# slipped. Each rung then rewrites the full config block.
#
# There used to be a 'SPI mode 3' rung here, on the theory that it would catch
# a chip stuck on the wrong clock edge. Removed 2026-08-08: the MAX31856 is a
# mode-1 part, and clocking it on the wrong edge misframes the command byte —
# whose bit 7 selects WRITE. That rung could therefore forge the exact spurious
# write it was supposed to be recovering from. Never talk the wrong SPI mode to
# this chip. Slower is the only safe direction to escalate.
RECOVERY_STEPS = (
    ('restore config block',   dict(speed=250000, mode=1, flush=False)),
    ('100kHz + bus flush',     dict(speed=100000, mode=1, flush=True)),
    ('50kHz + bus flush',      dict(speed=50000,  mode=1, flush=True)),
)

FAULT_LOG     = os.path.expanduser('~/sensors/logs/cht-faults.log')
FAULT_LOG_MAX = 256 * 1024

sio = socketio.Client(reconnection=True, reconnection_attempts=0)


# --------------------------------------------------------------------------
# logging
# --------------------------------------------------------------------------

def log(message):
    print(f'[cht] {message}', flush=True)


def fault_log(message, regs=None):
    """Console + a small persistent file, because the journal here is volatile
    and a cold-boot fault is exactly the kind of evidence a reboot erases."""
    line = f'{datetime.now().isoformat(timespec="seconds")} {message}'
    if regs:
        line += ' | ' + ' '.join(f'{n}={v:02X}' for n, v in zip(REG_NAMES, regs))
    log(line)
    try:
        os.makedirs(os.path.dirname(FAULT_LOG), exist_ok=True)
        if os.path.exists(FAULT_LOG) and os.path.getsize(FAULT_LOG) > FAULT_LOG_MAX:
            os.replace(FAULT_LOG, FAULT_LOG + '.1')
        with open(FAULT_LOG, 'a') as fh:
            fh.write(line + '\n')
    except OSError as err:
        log(f'fault log write failed: {err}')


# --------------------------------------------------------------------------
# SPI
# --------------------------------------------------------------------------

def _open(device, speed=250000, mode=1):
    spi = spidev.SpiDev()
    spi.open(0, device)
    spi.max_speed_hz = speed
    spi.mode = mode
    return spi


def _dump(spi):
    """The whole 16-byte register block, CR0..SR, in one transaction."""
    return spi.xfer2([0x00] + [0] * 16)[1:]


def _write_config(spi):
    """Restore the ENTIRE writable block 0x00-0x09 in one burst write.

    It used to write only CR0 and CR1. That was the bug that made 2026-08-08's
    fault permanent: something zeroed 0x02-0x09 on the right board mid-ride, and
    with the alarm thresholds at 0 the chip flagged every good reading. The
    driver could see the damage on every poll and had no way to repair it.
    The MAX31856 auto-increments the address during a burst write, so the whole
    block costs one transaction — there is no reason to write less than all of it.
    """
    spi.xfer2([0x80, *CONFIG_VALUES])


def _cold_junction_c(regs):
    """Cold-junction °C. CJTH:CJTL is 14-bit signed in bits 15:2, 1/64 °C/LSB."""
    raw = (regs[10] << 8) | regs[11]
    if raw & 0x8000:
        raw -= 0x10000
    return (raw >> 2) / 64.0


def _chip_alive(regs):
    """True when a real chip is answering, judged ONLY on read-only registers.

    This used to fingerprint MASK/CJHF/CJLF against their power-on values. Those
    are writable, so the single event that corrupts them — a stray write — also
    made a perfectly healthy board look dead. Beyond useless: it turned the one
    fault the ladder could have repaired into a permanent offline.

    So the test now rests entirely on 0x0A-0x0F, which no write can reach:
      * the reserved low bits of CJTL and LTCBL always read 0 on a real part,
      * the cold junction sits in a physically possible range, and
      * it is not exactly 0x0000, which is what a dead or floating bus returns.
    A board reading exactly 0.0000 °C at the cold junction would be a false
    negative; it is 1/64 °C wide and self-clears on the next poll.
    """
    if not regs or len(regs) != 16:
        return False
    if len(set(regs)) == 1:                   # all-0xFF float, all-0x00 dead bus
        return False
    if regs[11] & 0x03 or regs[14] & 0x07:    # reserved bits must read zero
        return False
    if not (regs[10] or regs[11]):            # cold junction of exactly zero
        return False
    return -40.0 <= _cold_junction_c(regs) <= 125.0


def _decode(regs):
    """Thermocouple °C from a live register block, or None on a probe fault."""
    if regs[15] & SR_FATAL:           # open circuit, over/under volt, out of range
        return None
    if not (-40.0 <= _cold_junction_c(regs) <= 125.0):
        return None
    tc_raw = (regs[12] << 16) | (regs[13] << 8) | regs[14]
    if tc_raw & 0x800000:
        tc_raw -= 0x1000000
    tc_c = (tc_raw >> 5) * 0.0078125
    if not (-50.0 <= tc_c <= 1100.0):  # outside any real K-type CHT range
        return None
    return round(tc_c, 2)


def read_board(device):
    """Returns (state, temp_c, regs).

    state is one of:
      'ok'    — chip answering, config good, reading usable
      'probe' — chip answering but the thermocouple side is faulted. NOT a
                board problem, so it must never escalate to a power cycle.
      'dead'  — chip absent, unpowered, or wedged. This is what the ladder is
                for.
    """
    try:
        spi = _open(device)
        try:
            regs = _dump(spi)
            if not _chip_alive(regs):
                return 'dead', None, regs
            if regs[0:10] != CONFIG_VALUES:
                # A fresh chip only ever differs in CR0/CR1 (they POR to 0x00
                # and 0x03). Anything past 0x01 means somebody else wrote to
                # this chip — log it, because that is the ride-killing fault
                # and the journal on this Pi does not survive a reboot.
                if regs[2:10] != CONFIG_VALUES[2:]:
                    fault_log(f'{BOARDS[device]}: config block corrupted, restoring', regs)
                _write_config(spi)
                time.sleep(0.25)      # let the first auto conversion complete
                regs = _dump(spi)
                if regs[0:10] != CONFIG_VALUES:
                    # Talking, but won't hold config — treat as wedged.
                    return 'dead', None, regs
            temp = _decode(regs)
            return ('ok' if temp is not None else 'probe'), temp, regs
        finally:
            spi.close()
    except (IOError, OSError):
        return 'dead', None, None


def try_revive(device, speed, mode, flush):
    """One SPI-only un-wedge attempt. True if the chip answers afterwards."""
    try:
        spi = _open(device, speed, mode)
        try:
            if flush:
                # Reads only — never a blind write to an address we don't own.
                spi.xfer2([0x00] + [0] * 32)
                time.sleep(0.05)
            _write_config(spi)
            time.sleep(0.25)
            return _chip_alive(_dump(spi))
        finally:
            spi.close()
    except (IOError, OSError):
        return False


# --------------------------------------------------------------------------
# power control (inert until POWER_GPIO is populated)
# --------------------------------------------------------------------------

def _pinctrl(*args):
    try:
        subprocess.run(['pinctrl', *args], check=False, capture_output=True, timeout=5)
    except (OSError, subprocess.SubprocessError) as err:
        log(f'pinctrl {" ".join(args)} failed: {err}')


def _power_pulse(pins, off_seconds=1.5):
    """Drop and restore VIN on the given GPIOs, with the SPI bus parked high-Z.

    Tri-stating first is not optional. The SPI lines back-feed VIN through the
    breakout's level shifters, so with them still driven: (a) the rail never
    falls below the MAX31856's 2.7V power-on-reset threshold, so the chip stays
    wedged — the same reason pulling one wire by hand never worked — and (b) the
    GPIO holding VIN low has to sink that back-feed from four driven pins, which
    can exceed what a pin should carry.

    This blacks out the other board's bus for ~2s as well. Harmless: it
    re-checks its config on every read.
    """
    _pinctrl('set', '7,8,9,10,11', 'ip', 'pn')   # SPI + both CS to high-Z
    for pin in pins:
        _pinctrl('set', str(pin), 'op', 'dl')    # VIN low, actively draining the rail
    time.sleep(off_seconds)
    for pin in pins:
        _pinctrl('set', str(pin), 'op', 'dh')    # VIN back up
    time.sleep(0.3)
    _pinctrl('set', '9,10,11', 'a0')             # SPI0 back to its alt function
    _pinctrl('set', '7,8', 'op', 'dh')           # CS lines idle high
    time.sleep(0.3)


def power_cycle(device):
    """A true cold restart of one board. Needs its VIN on a GPIO."""
    pin = POWER_GPIO.get(device)
    if pin is None:
        return False
    fault_log(f'{BOARDS[device]}: power cycling on GPIO{pin}')
    _power_pulse([pin])
    return True


def power_on_at_start():
    """Deterministic power-up for any board whose VIN we own.

    The cold-boot wedge happens when the board powers up alongside the Pi,
    through the whole system's inrush. Holding it off and enabling it here —
    after boot, with SPI already stable — reproduces in software the hot replug
    that has always fixed it by hand.

    Note the board is NOT fully off before this runs: with VIN on a GPIO that
    is still an input, the SPI back-feed floats the rail up against the pin's
    internal pull-down. That is exactly the half-powered limbo we are trying to
    clear, so the pulse below drives VIN hard low first rather than assuming
    a boot-time low is good enough.
    """
    pins = [pin for pin in POWER_GPIO.values() if pin is not None]
    if not pins:
        return
    log(f'powering up boards on GPIO {", ".join(str(p) for p in pins)}')
    _power_pulse(pins, off_seconds=1.0)


# --------------------------------------------------------------------------
# per-board state
# --------------------------------------------------------------------------

class MedianFilter:
    """Sliding median over the last N readings — drops the odd glitched frame.
    None (fault / no board) passes through as a gap, window untouched."""

    def __init__(self, window=3):
        self.window = window
        self.buf    = []

    def update(self, raw):
        if raw is None:
            return None
        self.buf.append(raw)
        if len(self.buf) > self.window:
            self.buf.pop(0)
        ordered = sorted(self.buf)
        return ordered[len(ordered) // 2]


class Board:
    """One thermocouple board plus its recovery ladder."""

    def __init__(self, device):
        self.device     = device
        self.name       = BOARDS[device]
        self.filter     = MedianFilter()
        self.dead_reads = 0      # consecutive 'dead' results
        self.rung       = 0      # position in RECOVERY_STEPS
        self.offline    = False  # ladder exhausted; slow-retry mode
        self.next_retry = 0.0
        self.episode    = False  # this fault episode already logged its dump

    def poll(self):
        now = time.monotonic()
        if self.offline and now < self.next_retry:
            return None

        state, temp, regs = read_board(self.device)

        if state != 'dead':
            if self.episode:
                fault_log(f'{self.name}: back online (state={state})', regs)
            self.dead_reads = 0
            self.rung       = 0
            self.offline    = False
            self.episode    = False
            # temp is None on a probe fault — that passes through as a gap,
            # exactly as an unplugged thermocouple always has.
            return self.filter.update(temp)

        self.dead_reads += 1
        if not self.episode:
            self.episode = True
            fault_log(f'{self.name}: stopped answering', regs)
        if self.dead_reads >= DEAD_READS_BEFORE_RECOVERY:
            self._recover()
        return None

    def _recover(self):
        if self.rung < len(RECOVERY_STEPS):
            label, kwargs = RECOVERY_STEPS[self.rung]
            self.rung += 1
            fault_log(f'{self.name}: recovery {self.rung}/{len(RECOVERY_STEPS)} — {label}')
            if try_revive(self.device, **kwargs):
                # Only a clean read on the normal path counts as recovered, so
                # dead_reads is deliberately left alone here. A rung that says
                # it worked but doesn't stick must not stall the ladder.
                fault_log(f'{self.name}: {label} got an answer — confirming next poll')
            return

        if power_cycle(self.device):
            self.dead_reads = 0
            self.rung       = 0
            return

        if not self.offline:
            reason = ('no GPIO power control wired — VIN is on the 5V header, '
                      'so only an unplug can reset this board')
            fault_log(f'{self.name}: OFFLINE, ladder exhausted ({reason})')
        self.offline    = True
        self.next_retry = time.monotonic() + OFFLINE_RETRY_SECONDS


def startup_probe(boards):
    """First-read snapshot of both boards, straight into the persistent log.

    This is the whole point of the instrumentation: on a cold boot that
    reproduces the wedge, this line records exactly what the right board
    looked like before anything touched it.
    """
    fault_log('service start — initial register dump')
    for board in boards:
        state, temp, regs = read_board(board.device)
        fault_log(f'  {board.name}: state={state} temp={temp}', regs)


# --------------------------------------------------------------------------

@sio.event
def connect():
    log('Connected to CarPlay app')


@sio.event
def disconnect():
    log('Disconnected — will reconnect')


def main():
    power_on_at_start()
    boards = [Board(0), Board(1)]
    startup_probe(boards)

    while True:
        try:
            sio.connect(SERVER_URL)
            while True:
                left  = boards[0].poll()
                right = boards[1].poll()

                sio.emit('cht', {'left': left, 'right': right})
                print(f'[cht] L={left if left is not None else "--"}°C  R={"--" if right is None else right}°C',
                      flush=True)

                time.sleep(INTERVAL)
        except KeyboardInterrupt:
            break
        except Exception as e:
            log(f'Error: {e} — retrying in 5s')
            try:
                sio.disconnect()
            except Exception:
                pass
            time.sleep(5)


if __name__ == '__main__':
    main()
