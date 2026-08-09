#!/usr/bin/env python3
"""Offline checks for livi-freeze-watch.

This program can reboot a motorcycle's dashboard while it is being ridden, so
the interesting question is not whether it detects a freeze — it is whether it
ever acts when it should not. Everything that touches the machine is stubbed.
What is exercised is the judgement: what it waits for, what it tries first,
what it refuses to do twice, and what it leaves alone.
"""
import importlib.machinery
import importlib.util
import sys

loader = importlib.machinery.SourceFileLoader('fw', 'pi/health/livi-freeze-watch')
spec = importlib.util.spec_from_loader('fw', loader)
fw = importlib.util.module_from_spec(spec)
loader.exec_module(fw)

fails = []
log = []
actions = []

fw.note = log.append
fw.DISABLE_FLAG = '/nonexistent/livi-freeze-watch.disabled'
fw.forensics = lambda tag, samples, verdict: actions.append(('forensics', tag))
fw.restart_app = lambda: (actions.append(('restart', None)), True)[1]
fw.do_reboot = lambda why: actions.append(('reboot', why.split(' ')[0]))

# A fake machine. Tests mutate WORLD; the module reads it through these stubs.
WORLD = {
    'pids': {'main': 100, 'rend': 101, 'gpu': 102, 'comp': 103, 'gst': 104},
    'cpu': {'main': 20, 'rend': 65, 'gpu': 10, 'comp': 2, 'gst': 7},
    'frame': 'aaaa',
    'p4000': True,
    'uptime': 10_000.0,
}
TICKS = {'n': 0}
PERSISTED = {'restarts': [], 'reboots': []}

fw.find_pids = lambda: dict(WORLD['pids'])
# jiffies() is asked for a pid; return a monotonically climbing counter so the
# module's own delta arithmetic is what is under test, not the stub's.
fw.jiffies = lambda pid: sum(
    WORLD['cpu'].get(label, 0) for label, p in WORLD['pids'].items() if p == pid
) * TICKS['n']
fw.proc_state = lambda pid: 'S'
fw.frame_hash = lambda: (WORLD['frame'], '') if WORLD['frame'] else (None, 'timeout')
fw.port_open = lambda port=4000, timeout=2.0: WORLD['p4000']
fw.uptime = lambda: WORLD['uptime']
fw.load_state = lambda: {'restarts': list(PERSISTED['restarts']),
                         'reboots': list(PERSISTED['reboots'])}


def _save(data):
    PERSISTED['restarts'] = list(data['restarts'])
    PERSISTED['reboots'] = list(data['reboots'])


fw.save_state = _save


def check(name, got, want):
    if got != want:
        fails.append(name)
        print(f'  FAIL {name}: got {got!r}, want {want!r}')
    else:
        print(f'  ok   {name}')


def fresh(**world):
    actions.clear()
    log.clear()
    TICKS['n'] = 0
    PERSISTED['restarts'] = []
    PERSISTED['reboots'] = []
    WORLD.update({
        'pids': {'main': 100, 'rend': 101, 'gpu': 102, 'comp': 103, 'gst': 104},
        'cpu': {'main': 20, 'rend': 65, 'gpu': 10, 'comp': 2, 'gst': 7},
        'frame': 'aaaa', 'p4000': True, 'uptime': 10_000.0,
    })
    WORLD.update(world)
    return fw.Watch()


def spin(watch, seconds, start=1000.0, changing_frame=True):
    """Advance the fake clock, one poll every fw.POLL seconds."""
    now = start
    end = start + seconds
    while now < end:
        TICKS['n'] += 1
        if changing_frame and WORLD['frame']:
            WORLD['frame'] = 'f%04d' % TICKS['n']
        watch.poll(now)
        now += fw.POLL
    return now


print('healthy system:')
w = fresh()
spin(w, 600)
check('never acts on a healthy dash', actions, [])
check('and stays quiet', log, [])

print('boot grace:')
w = fresh(uptime=60.0, pids={})
spin(w, 600)
check('a young boot is left alone', actions, [])

print('app gone (nothing else on this machine restarts it):')
w = fresh(pids={})
spin(w, 20)
check('below the confirm window: no action', actions, [])
spin(w, 40, start=1020.0)
check('confirmed app-gone dumps then restarts',
      actions, [('forensics', 'app-gone'), ('restart', None)])
check('a restart, never a reboot', [a for a in actions if a[0] == 'reboot'], [])

print('compositor wedged (grim cannot get a frame):')
w = fresh(frame=None)
spin(w, fw.CONFIRM - fw.POLL)
check('not yet confirmed', actions, [])
spin(w, 3 * fw.POLL, start=1000.0 + fw.CONFIRM - fw.POLL)
check('goes straight to reboot; the app cannot draw through a dead compositor',
      actions, [('forensics', 'compositor-wedged'), ('reboot', 'compositor-wedged')])

print('renderer frozen (0 CPU AND a stale picture):')
w = fresh()
WORLD['cpu']['rend'] = 0
spin(w, fw.CONFIRM + 3 * fw.POLL, changing_frame=False)
check('confirmed renderer freeze restarts the app',
      actions, [('forensics', 'renderer-frozen'), ('restart', None)])

print('the two halves of that signal, separately:')
w = fresh()
WORLD['cpu']['rend'] = 0
spin(w, 900)                       # 0 CPU but the frame keeps changing
check('0 CPU with a live picture is not a freeze', actions, [])

w = fresh()
spin(w, 900, changing_frame=False)  # frozen picture, renderer still working
check('a parked bike holding one frame is not a freeze', actions, [])
check('but it is recorded', any('frame-static' in line for line in log), True)

print('main wedged (port 4000 stops answering):')
w = fresh(p4000=False)
spin(w, fw.CONFIRM + 3 * fw.POLL)
check('restarts the app', actions, [('forensics', 'main-wedged'), ('restart', None)])

print('escalation when restarts do not help:')
w = fresh(pids={})
now = spin(w, fw.GONE_CONFIRM + fw.POLL)
for _ in range(fw.MAX_RESTARTS + 2):
    now += fw.RECOVER_WAIT + fw.POLL          # let the recovery window lapse
    now = spin(w, fw.GONE_CONFIRM + fw.POLL, start=now)
restarts = [a for a in actions if a[0] == 'restart']
reboots = [a for a in actions if a[0] == 'reboot']
check('restart budget is spent first', len(restarts), fw.MAX_RESTARTS)
check('then it reboots', len(reboots), 1)

print('reboot loop protection:')
w = fresh(frame=None)
PERSISTED['reboots'] = [fw.time.time() - 60.0]     # one reboot a minute ago
spin(w, fw.CONFIRM + 3 * fw.POLL)
check('a second reboot inside the window is refused',
      [a for a in actions if a[0] == 'reboot'], [])
check('and it says a human is needed',
      any('FREEZE-NEEDS-HUMAN' in line for line in log), True)

w = fresh(frame=None)
PERSISTED['reboots'] = [fw.time.time() - 7200.0] * fw.REBOOT_DAY_MAX
spin(w, fw.CONFIRM + 3 * fw.POLL)
check('the daily cap also holds', [a for a in actions if a[0] == 'reboot'], [])

print('recovery suppresses immediate re-triggering:')
w = fresh(pids={})
now = spin(w, fw.GONE_CONFIRM + fw.POLL)
check('one restart', len([a for a in actions if a[0] == 'restart']), 1)
# Poll right up to the edge of the window the restart was given.
spin(w, w.recovering_until - now - fw.POLL, start=now)
check('no second action while the restart is being given its chance',
      len([a for a in actions if a[0] == 'restart']), 1)
# Past it, still dead, and budget remaining: it escalates rather than waiting.
spin(w, fw.GONE_CONFIRM + 2 * fw.POLL, start=w.recovering_until)
check('once that window lapses it tries again',
      len([a for a in actions if a[0] == 'restart']), 2)

print('faults clear when the machine comes back:')
w = fresh(p4000=False)
spin(w, 30)
check('suspected', any('FREEZE-SUSPECT main-wedged' in line for line in log), True)
WORLD['p4000'] = True
spin(w, 30, start=1030.0)
check('cleared', 'main-wedged' not in w.faults, True)
spin(w, 900, start=1060.0)
check('and no action was ever taken', actions, [])

print('disable flag:')
import os
fw.DISABLE_FLAG = __file__          # a path that exists
w = fresh(frame=None)
spin(w, fw.CONFIRM + 3 * fw.POLL)
check('records forensics', [a for a in actions if a[0] == 'forensics'],
      [('forensics', 'compositor-wedged')])
check('but takes no action', [a for a in actions if a[0] in ('restart', 'reboot')], [])
fw.DISABLE_FLAG = '/nonexistent/livi-freeze-watch.disabled'

print()
if fails:
    print(f'{len(fails)} FAILED')
    sys.exit(1)
print('all checks passed')
