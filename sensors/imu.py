#!/usr/bin/env python3
"""
imu.py — WitMotion WT901C-485 IMU reader (Modbus RTU over USB-RS485)
Reads lean angle, pitch, and G-force and emits to the CarPlay app via
Socket.IO. Third-generation driver: replaces the BNO085 UART-RVC driver
(board killed 2026-07-08, archive imu.py.bak-bno085-rvc) which replaced the
BNO055 (crank wedges/latch-up, archive imu.py.bak-bno055-final).

WHY USB + RS485 (the lessons of two dead chips):
  * The sensor is powered from USB VBUS through the converter cable and
    speaks differential RS485 — completely divorced from Pi GPIO pins,
    3V3 rail glitches, mode-select pins, and every failure path that ate
    the two BNO boards on this bike's electrical system.
  * Modbus is STATELESS: no calibration to lose, no mode to mis-latch, no
    stream to re-establish. A brownout reboots the sensor and the next
    poll simply gets answered. Recovery is inherent, not engineered.

Hardware:
  WT901C-485  A/B/VCC(5V)/GND -> WitMotion USB-RS485 converter (CH340)
  Converter -> Pi USB port. Addressed by stable path:
    /dev/serial/by-id/usb-1a86_USB_Serial-if00-port0
  (GPS owns the CP2102N on another port; by-id keeps them apart no matter
  the enumeration order. USB ports are FULL: dongle, GPS, display, IMU.)
  NOTE: display power+touch also ride USB — never power-cycle USB ports
  automatically; the screen would go dark. Manual last resort only.

Sensor config (persisted in the sensor 2026-07-11): baud 115200,
Modbus address 0x50. If it ever answers only at 9600 (factory reset),
this driver detects that, re-bumps it to 115200, and saves.

Modbus register map (WitMotion, function 0x03, big-endian int16):
  0x34-0x36 AX AY AZ   raw/32768*16 g
  0x37-0x39 GX GY GZ   raw/32768*2000 deg/s
  0x3A-0x3C HX HY HZ   magnetometer (unused here; heading fusion is phase 2)
  0x3D-0x3F Roll Pitch Yaw   raw/32768*180 deg
One 12-register read (0x34..0x3F) per poll = 8 bytes out, 29 back ≈ 3.5 ms
at 115200 — polled every 20 ms (50 Hz), emitted to the dash at 10 Hz.

AXIS MAPPING (set at install from a parked capture, verify like always):
  Gravity model verified 2026-07-11 against live data (<0.4% residual):
  standard aerospace pairing g_body = (-sin p, sin r cos p, cos r cos p)
  with WitMotion Roll/Pitch as (r, p). Accel is RAW (gravity included) —
  subtract analytically; install check: parked G reads 0.00 at any lean.
"""

import math
import struct
import time

import serial
import socketio

INTERVAL   = 0.1            # dash emit cadence (~10 Hz)
POLL_HZ    = 50             # sensor poll rate (each poll = one full read)
SERVER_URL = 'http://localhost:4000'
PORT_PATH  = '/dev/serial/by-id/usb-1a86_USB_Serial-if00-port0'
BAUD       = 115200
FALLBACK_BAUD = 9600        # factory default; auto-heal a reset sensor
MODBUS_ADDR = 0x50

# ── Mounting / axis configuration (tune once at install) ────────────────────
# Calibrated 2026-07-11 against the mounted bike (label up, X arrow to the
# headlight): left-tilt test moved roll 0.90->+16.23 with pitch steady, so
# WitMotion roll+ = LEFT lean on this mounting -> LEAN_SIGN -1 for +right.
# Same tilt put gravity on +Y (ay 0.016->0.277) -> +Y points bike-LEFT ->
# GX_SIGN -1 so +gx = rightward. X points at the headlight -> GY_SIGN +1.
LEAN_FROM   = 'roll'   # bike lean lives on WitMotion roll (X to headlight)
LEAN_SIGN   = -1.0     # +lean must be leaning RIGHT (sensor roll+ = left)
PITCH_SIGN  = 1.0      # +pitch must be nose UP
GX_AXIS     = 'y'      # lateral accel axis (Y = bike left/right)
GY_AXIS     = 'x'      # longitudinal accel axis (X = bike fore/aft)
GX_SIGN     = -1.0     # +gx must be rightward (sensor +Y = bike left)
GY_SIGN     = 1.0      # +gy must be forward acceleration

ACC_SCALE   = 16.0 / 32768   # raw -> g
ANG_SCALE   = 180.0 / 32768  # raw -> degrees

MAX_STEP_DEG = 45.0          # max believable lean/pitch change per emit tick

# G smoothing (same philosophy as both previous drivers): average every poll
# inside the tick, then EMA, then deadband so a parked bike reads flat 0.00.
G_SMOOTH_ALPHA = 0.2
G_DEADBAND_G   = 0.05

# Watchdog: Modbus either answers or it doesn't. Silence -> log honestly,
# keep retrying (cheap), reopen the port on I/O errors (USB replug heals).
STALE_SECONDS = 3.0          # no valid reply this long -> declare not-ok
DEAD_LOG_EVERY = 30.0        # remind in the log this often while dead


sio = socketio.Client(reconnection=True, reconnection_attempts=0)

@sio.event
def connect():
    print('[imu] Connected to CarPlay app', flush=True)

@sio.event
def disconnect():
    print('[imu] Disconnected — will reconnect', flush=True)


def crc16(data):
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc


def frame(payload):
    c = crc16(payload)
    return payload + bytes([c & 0xFF, c >> 8])


def read_regs(port, start, n):
    """One Modbus function-0x03 read. Returns tuple of int16s or None."""
    req = frame(bytes([MODBUS_ADDR, 0x03, start >> 8, start & 0xFF,
                       n >> 8, n & 0xFF]))
    port.reset_input_buffer()
    port.write(req)
    expected = 5 + 2 * n
    resp = port.read(expected)
    if len(resp) != expected or resp[0] != MODBUS_ADDR or resp[1] != 0x03:
        return None
    c = crc16(resp[:-2])
    if resp[-2] != (c & 0xFF) or resp[-1] != (c >> 8):
        return None
    return struct.unpack(f'>{n}h', resp[3:3 + 2 * n])


def write_reg(port, reg, val):
    port.write(frame(bytes([MODBUS_ADDR, 0x06, reg >> 8, reg & 0xFF,
                            (val >> 8) & 0xFF, val & 0xFF])))
    time.sleep(0.15)
    port.reset_input_buffer()


def open_sensor():
    """Open at the fast baud; if silent, heal a factory-reset sensor (9600)
    back up to 115200 and persist. Returns an open serial port or raises."""
    port = serial.Serial(PORT_PATH, BAUD, timeout=0.1)
    if read_regs(port, 0x3D, 3) is not None:
        return port
    port.close()
    port = serial.Serial(PORT_PATH, FALLBACK_BAUD, timeout=0.3)
    if read_regs(port, 0x3D, 3) is not None:
        print('[imu] sensor found at 9600 (factory reset?) — re-bumping to '
              '115200 and saving', flush=True)
        write_reg(port, 0x69, 0xB588)   # unlock
        write_reg(port, 0x04, 0x0006)   # baud -> 115200
        port.close()
        time.sleep(0.3)
        port = serial.Serial(PORT_PATH, BAUD, timeout=0.1)
        if read_regs(port, 0x3D, 3) is not None:
            write_reg(port, 0x69, 0xB588)
            write_reg(port, 0x00, 0x0000)  # save
            return port
    port.close()
    raise IOError('sensor not answering at 115200 or 9600')


def gravity_in_body(roll_deg, pitch_deg):
    """Stationary accelerometer reading (g) at this attitude — standard
    aerospace pairing, verified against this sensor 2026-07-11 (<0.4%)."""
    r = math.radians(roll_deg)
    p = math.radians(pitch_deg)
    return (-math.sin(p), math.sin(r) * math.cos(p),
            math.cos(r) * math.cos(p))


def deadband(v, band):
    return 0.0 if abs(v) < band else v


def emit_status(ok=True, extra=None):
    # Same payload shape as both previous drivers; the app needs no change.
    # Modbus has no calibration state: recalibrating is always False, and
    # the dash can never show CALIBRATING again.
    payload = {'recalibrating': False, 'wedged': not ok,
               'sys': None, 'gyro': None, 'accel': None, 'mag': None}
    if extra:
        payload.update(extra)
    try:
        sio.emit('imu-status', payload)
    except Exception:
        pass


def main():
    port = None
    last_ok_mono = None
    dead = False
    dead_last_log = 0.0
    last_lean = None
    last_pitch = None
    gx_f = None
    gy_f = None
    status_counter = 0
    poll_dt = 1.0 / POLL_HZ

    while True:
        try:
            if port is None:
                port = open_sensor()
                last_ok_mono = time.monotonic()
                print(f'[imu] WT901C answering on {PORT_PATH} @ {BAUD}',
                      flush=True)

            if not sio.connected:
                sio.connect(SERVER_URL)

            while True:
                tick_start = time.monotonic()
                acc_samples = []
                latest_angles = None

                # Poll flat-out for one emit interval.
                while time.monotonic() - tick_start < INTERVAL:
                    t0 = time.monotonic()
                    regs = read_regs(port, 0x34, 12)
                    now = time.monotonic()
                    if regs is not None:
                        last_ok_mono = now
                        if dead:
                            dead = False
                            print('[imu] sensor answering again — recovered',
                                  flush=True)
                            emit_status(ok=True, extra={'event': 'recovered'})
                        # regs holds 0x34..0x3F: acc[0:3], gyro[3:6],
                        # mag[6:9], angles[9:12] — angles are the LAST three
                        # (an [8:11] slice here once shipped the magnetometer
                        # Z as "roll": dash read a rock-steady 140° lean).
                        ax, ay, az = (v * ACC_SCALE for v in regs[0:3])
                        roll, pitch, yaw = (v * ANG_SCALE for v in regs[9:12])
                        acc_samples.append((ax, ay, az))
                        latest_angles = (roll, pitch, yaw)
                    elif now - last_ok_mono >= STALE_SECONDS:
                        if not dead or now - dead_last_log >= DEAD_LOG_EVERY:
                            dead = True
                            dead_last_log = now
                            print('[imu] no Modbus reply for '
                                  f'{now - last_ok_mono:.0f}s — sensor dark '
                                  '(USB unplugged? brownout?) — retrying',
                                  flush=True)
                            emit_status(ok=False, extra={'event': 'dead'})
                    remain = poll_dt - (time.monotonic() - t0)
                    if remain > 0:
                        time.sleep(remain)

                if latest_angles is None:
                    continue

                roll, pitch, _yaw = latest_angles
                raw_lean = roll if LEAN_FROM == 'roll' else pitch
                raw_pitch = pitch if LEAN_FROM == 'roll' else roll
                lean = LEAN_SIGN * raw_lean
                bike_pitch = PITCH_SIGN * raw_pitch

                # Reject physically-impossible single-tick jumps.
                if ((last_lean is not None and abs(lean - last_lean) > MAX_STEP_DEG) or
                        (last_pitch is not None and abs(bike_pitch - last_pitch) > MAX_STEP_DEG)):
                    last_lean, last_pitch = lean, bike_pitch
                    continue
                last_lean, last_pitch = lean, bike_pitch

                # Average the tick's accel, strip gravity, smooth, deadband.
                n = len(acc_samples)
                ax = sum(s[0] for s in acc_samples) / n
                ay = sum(s[1] for s in acc_samples) / n
                az = sum(s[2] for s in acc_samples) / n
                gvx, gvy, gvz = gravity_in_body(roll, pitch)
                dyn = {'x': ax - gvx, 'y': ay - gvy, 'z': az - gvz}
                gx_raw = GX_SIGN * dyn[GX_AXIS]
                gy_raw = GY_SIGN * dyn[GY_AXIS]
                gx_f = gx_raw if gx_f is None else gx_f + G_SMOOTH_ALPHA * (gx_raw - gx_f)
                gy_f = gy_raw if gy_f is None else gy_f + G_SMOOTH_ALPHA * (gy_raw - gy_f)

                sio.emit('lean', round(lean, 2))
                sio.emit('pitch', round(bike_pitch, 2))
                sio.emit('gforce', {'x': round(deadband(gx_f, G_DEADBAND_G), 3),
                                    'y': round(deadband(gy_f, G_DEADBAND_G), 3)})

                status_counter += 1
                if status_counter >= 10:
                    status_counter = 0
                    emit_status(ok=True)

        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f'[imu] link error: {e} — reopening in 5s', flush=True)
            try:
                sio.disconnect()
            except Exception:
                pass
            if port is not None:
                try:
                    port.close()
                except Exception:
                    pass
                port = None
            gx_f = gy_f = None
            time.sleep(5)

    if port is not None:
        port.close()


if __name__ == '__main__':
    main()
