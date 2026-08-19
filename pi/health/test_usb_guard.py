#!/usr/bin/env python3
"""Offline checks for livi-usb-guard.

This program issues USB resets on a moving motorcycle, so its policy needs to
be provable without hardware. Everything that touches the machine is stubbed;
what is exercised here is the decision-making: when it waits, when it acts,
when it refuses, and when it stops.
"""
import importlib.machinery
import importlib.util
import sys

loader = importlib.machinery.SourceFileLoader('guard', 'pi/health/livi-usb-guard')
spec = importlib.util.spec_from_loader('guard', loader)
guard = importlib.util.module_from_spec(spec)
loader.exec_module(guard)

fails = []
log = []
guard.note = log.append
guard.DISABLE_FLAG = '/nonexistent/livi-usb-guard.disabled'

STATE = {'present': set(), 'byid': set()}
guard.present = lambda port: port in STATE['present']
guard.glob = type('g', (), {'glob': staticmethod(lambda pattern: ['x'] if pattern in STATE['byid'] else [])})

actions = []
guard.usb_reset = lambda port: (actions.append(('usbreset', port)), (True, 'ok'))[1]
guard.reauthorize = lambda port: (actions.append(('reauth', port)), (True, 'ok'))[1]
guard.rebind_controller = lambda bus: (actions.append(('rebind', bus)), (True, 'ok'))[1]

UP = 10_000.0   # well past BOOT_GRACE


def check(name, got, want):
    if got != want:
        fails.append(name)
        print(f'  FAIL {name}: got {got!r}, want {want!r}')
    else:
        print(f'  ok   {name}')


def fresh(port, label, bus, grace):
    actions.clear()
    log.clear()
    return guard.Guard(port, label, bus, grace)


print('grace period:')
STATE['present'] = set()
g = fresh('3-1', 'imu', 3, 10.0)
g.poll(1000.0, UP)
check('first missing poll only records', actions, [])
check('and logs USB-DOWN', log[0].startswith('USB-DOWN imu'), True)
g.poll(1005.0, UP)
check('still inside grace: no action', actions, [])
g.poll(1011.0, UP)
check('past grace: acts', len(actions), 1)

print('boot gate:')
g = fresh('3-1', 'imu', 3, 10.0)
g.poll(1000.0, 5.0)
g.poll(1100.0, 30.0)      # long past the device grace, but uptime < BOOT_GRACE
check('young boot suppresses action', actions, [])

print('bus 3 ladder, device absent:')
STATE['present'] = set()
g = fresh('3-1', 'imu', 3, 10.0)
now = 1000.0
g.poll(now, UP)
for _ in range(5):
    now += guard.COOLDOWN + 1
    g.poll(now, UP)
# Absent device: usbreset and reauthorize are impossible, only the rebind is.
check('absent bus-3 device goes straight to rebind', actions, [('rebind', 3)])
check('ladder then reports exhausted',
      any('USB-EXHAUSTED' in line for line in log), True)

print('bus 3 ladder, enumerated but no tty:')
STATE['present'] = {'3-2'}
STATE['byid'] = set()               # sysfs says yes, /dev/serial says no
g = fresh('3-2', 'gps', 3, 10.0)
now = 1000.0
g.poll(now, UP)
for _ in range(4):
    now += guard.COOLDOWN + 1
    g.poll(now, UP)
check('full ladder in order', actions,
      [('usbreset', '3-2'), ('reauth', '3-2'), ('rebind', 3)])

print('bus 1 refuses to rebind:')
STATE['present'] = set()
g = fresh('1-2', 'touch', 1, 10.0)
now = 1000.0
g.poll(now, UP)
for _ in range(4):
    now += guard.COOLDOWN + 1
    g.poll(now, UP)
check('no action taken on a vanished bus-1 device', actions, [])
check('and it says why, once',
      sum('USB-NEEDS-REBOOT' in line for line in log), 1)

# A bus-1 device still on the bus may be reset — neither action cuts VBUS.
# The dongle reaches that state via a burst of endpoint errors in the app log.
STATE['present'] = {'1-1'}
guard.DONGLE_WATCH.hits = [999.0] * guard.DONGLE_THRESHOLD
guard.DONGLE_WATCH.poll = lambda now: guard.DONGLE_THRESHOLD   # errors keep coming
g = fresh('1-1', 'dongle', 1, 25.0)
now = 1000.0
g.poll(now, UP)
for _ in range(3):
    now += guard.COOLDOWN + 1
    g.poll(now, UP)
check('present bus-1 device gets device-scoped actions only', actions,
      [('usbreset', '1-1'), ('reauth', '1-1')])
check('never a controller rebind on bus 1',
      [a for a in actions if a[0] == 'rebind'], [])
check('the reset clears the stale error count', guard.DONGLE_WATCH.hits, [])

# Below the threshold the dongle is left alone, however noisy the log is.
guard.DONGLE_WATCH.poll = lambda now: guard.DONGLE_THRESHOLD - 1
g = fresh('1-1', 'dongle', 1, 25.0)
g.poll(1000.0, UP)
g.poll(1100.0, UP)
check('a few endpoint errors are not a fault', actions, [])
guard.DONGLE_WATCH.hits = []
guard.DONGLE_WATCH.poll = lambda now: 0

print('a brief reappearance does not close the episode:')
STATE['present'] = {'3-2'}
STATE['byid'] = set()
g = fresh('3-2', 'gps', 3, 10.0)
g.poll(1000.0, UP)
g.poll(1011.0, UP)                                  # rung 1: usbreset
STATE['byid'] = {'/dev/serial/by-id/usb-Silicon_Labs_CP2102N*'}
g.poll(1013.0, UP)                                  # back, briefly
check('episode stays open during confirmation', g.bad_since, 1000.0)
STATE['byid'] = set()                               # and gone again
g.poll(1015.0, UP)
g.poll(1011.0 + guard.COOLDOWN + 1, UP)
check('the flap escalates instead of repeating', actions[-1], ('reauth', '3-2'))
STATE['byid'] = {'/dev/serial/by-id/usb-Silicon_Labs_CP2102N*'}
now = 1011.0 + guard.COOLDOWN + 2
g.poll(now, UP)
g.poll(now + guard.HEALTHY_CONFIRM + 1, UP)
check('sustained health closes it', (g.bad_since, g.rung), (None, 0))

print('rate limiting:')
STATE['present'] = {'3-2'}
STATE['byid'] = set()
g = fresh('3-2', 'gps', 3, 10.0)
g.poll(1000.0, UP)
g.poll(1011.0, UP)
check('one action', len(actions), 1)
g.poll(1012.0, UP)
g.poll(1050.0, UP)
check('cooldown blocks the next rung', len(actions), 1)
g.poll(1011.0 + guard.COOLDOWN + 1, UP)
check('cooldown expiry allows it', len(actions), 2)

# Hourly cap: a device that keeps flapping must not be reset forever.
g = fresh('3-2', 'gps', 3, 10.0)
g.bad_since = 0.0
now = 1000.0
for _ in range(10):
    g.rung = 0                     # pretend the ladder keeps being retryable
    now += guard.COOLDOWN + 1
    g.poll(now, UP)
check('hourly cap holds', len(actions), guard.MAX_PER_HOUR)

print('recovery:')
STATE['present'] = {'3-1'}
STATE['byid'] = {'/dev/serial/by-id/usb-1a86_USB_Serial*'}
g = fresh('3-1', 'imu', 3, 10.0)
g.bad_since = 900.0
g.rung = 2
g.poll(1000.0, UP)
check('one good poll is not yet recovery', (g.bad_since, g.rung), (900.0, 2))
g.poll(1000.0 + guard.HEALTHY_CONFIRM + 1, UP)
check('sustained health clears the episode', (g.bad_since, g.rung), (None, 0))
check('and logs the recovery', log[0].startswith('USB-RECOVERED imu'), True)

print('disabled flag:')
import os
guard.DISABLE_FLAG = __file__          # any path that exists
STATE['present'] = set()
g = fresh('3-1', 'imu', 3, 10.0)
g.poll(1000.0, UP)
g.poll(1020.0, UP)
check('disable flag suppresses all action', actions, [])
check('but detection still logs', any('USB-DOWN' in line for line in log), True)

print('dongle log watcher:')
import os as _os
import tempfile
guard.DONGLE_WATCH = guard.DongleLogWatch()   # a real one, on a real temp file
tmpdir = tempfile.mkdtemp()
logfile = _os.path.join(tmpdir, 'LIVI.log')
guard.DONGLE_WATCH.path = logfile
with open(logfile, 'w') as fh:
    fh.write('[Perf] AppStart\n')
check('clean log counts nothing', guard.DONGLE_WATCH.poll(100.0), 0)
with open(logfile, 'a') as fh:
    fh.write('[DongleDriver] Send error Ia [Error: transferOut error: endpoint not found]\n' * 3)
check('counts the new errors', guard.DONGLE_WATCH.poll(101.0), 3)
check('does not recount what it already read', guard.DONGLE_WATCH.poll(102.0), 3)
check('errors age out of the window',
      guard.DONGLE_WATCH.poll(102.0 + guard.DONGLE_WINDOW + 1), 0)
# A new boot repoints the symlink at a fresh, shorter file. Offsets must reset
# or the watcher reads past the end forever and never sees another error.
with open(logfile, 'a') as fh:
    fh.write('x' * 5000)
guard.DONGLE_WATCH.poll(200.0)
with open(logfile, 'w') as fh:
    fh.write('endpoint not found\n')
check('handles the log being replaced under it', guard.DONGLE_WATCH.poll(201.0), 1)
_os.remove(logfile)
_os.rmdir(tmpdir)

print('app status back-channel (the 2026-08-19 adapter-missing wedge):')
import json as _json

status_dir = tempfile.mkdtemp()
status_file = _os.path.join(status_dir, 'statusData.json')
guard.STATUS_FILE = status_file
guard.app_up = lambda: True


def write_status(dongle, active=None, streaming=False):
    with open(status_file, 'w') as fh:
        _json.dump({'version': 1, 'payload': {
            'usb': {'dongleConnected': dongle, 'phoneConnected': False},
            'projection': {'active': active, 'streaming': streaming,
                           'phoneType': None}}}, fh)


check('missing status file is not a wedge', guard.app_reports_no_dongle(), False)
write_status(dongle=False)
check('live app + no dongle + no session = wedge', guard.app_reports_no_dongle(), True)
write_status(dongle=True)
check('app has the dongle: no wedge', guard.app_reports_no_dongle(), False)
write_status(dongle=False, active='cp')
check('a native session idles the dongle legitimately', guard.app_reports_no_dongle(), False)
write_status(dongle=False, streaming=True)
check('streaming means something works: no wedge', guard.app_reports_no_dongle(), False)
with open(status_file, 'w') as fh:
    fh.write('{truncated')
check('corrupt status file is not a wedge', guard.app_reports_no_dongle(), False)
write_status(dongle=False)
guard.app_up = lambda: False
check('dead app is APP LOST, not a dongle fault', guard.app_reports_no_dongle(), False)
guard.app_up = lambda: True

# End to end: dongle enumerated and error-free, but the app says it has no
# dongle — the guard must treat that as unhealthy and reach for usbreset.
guard.DISABLE_FLAG = '/nonexistent/livi-usb-guard.disabled'
guard.DONGLE_WATCH.clear()
STATE['present'] = {'1-1'}
g = fresh('1-1', 'dongle', 1, 25.0)
g.poll(3000.0, UP)
check('wedge opens an episode', g.bad_since, 3000.0)
check('episode names the back-channel', 'app_wedge=True' in log[0], True)
g.poll(3026.0, UP)
check('past grace: device-scoped reset', actions, [('usbreset', '1-1')])
write_status(dongle=True)
g.poll(3030.0, UP)
g.poll(3030.0 + guard.HEALTHY_CONFIRM + 1, UP)
check('app reclaiming the dongle closes the episode', g.bad_since, None)

_os.remove(status_file)
_os.rmdir(status_dir)

print()
if fails:
    print(f'{len(fails)} FAILED')
    sys.exit(1)
print('all checks passed')
