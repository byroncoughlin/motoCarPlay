#!/usr/bin/env python3
"""Offline checks for livi-health-recorder's log rotation.

The recorder is the one service that must survive a whole trip, so the failure
that matters here is not a wrong reading — it is running out of room, or losing
the tail of the file at the moment something interesting happened. These checks
drive the real rotation code against a temp directory: the cascade, the header
after a roll, and — the bug this file was written for — that rotation happens
while the loop is running and not only at startup.

Nothing here touches the machine or the real log directory.
"""
import importlib.machinery
import importlib.util
import os
import shutil
import tempfile

loader = importlib.machinery.SourceFileLoader('hr', 'pi/health/livi-health-recorder')
spec = importlib.util.spec_from_loader('hr', loader)
hr = importlib.util.module_from_spec(spec)
loader.exec_module(hr)

fails = []


def check(name, condition):
    if not condition:
        fails.append(name)
    print('%-4s %s' % ('ok' if condition else 'FAIL', name))


TMP = tempfile.mkdtemp(prefix='livi-hr-test-')
hr.LOG_DIR = TMP
hr.CSV = os.path.join(TMP, 'health.csv')
hr.EVENTS = os.path.join(TMP, 'events.log')


def write_csv(size):
    with open(hr.CSV, 'w') as handle:
        handle.write('x' * size)


def names():
    return sorted(n for n in os.listdir(TMP) if n.startswith('health.csv'))


# --- rotate_if_needed leaves a small file alone -----------------------------
hr.ROTATE_BYTES = 1000
write_csv(100)
hr.rotate_if_needed()
check('under threshold: no rotation', names() == ['health.csv'])
check('under threshold: file untouched', os.path.getsize(hr.CSV) == 100)

# --- at threshold it rolls to .1 --------------------------------------------
write_csv(1000)
hr.rotate_if_needed()
check('at threshold: rolled to .1', names() == ['health.csv.1'])
check('at threshold: .1 holds the old bytes', os.path.getsize(hr.CSV + '.1') == 1000)
check('at threshold: live file is gone, not truncated in place',
      not os.path.exists(hr.CSV))

# --- the cascade shifts every generation and drops the oldest ---------------
shutil.rmtree(TMP)
os.makedirs(TMP)
for index in range(1, hr.KEEP + 1):
    with open('%s.%d' % (hr.CSV, index), 'w') as handle:
        handle.write('gen%d' % index)
write_csv(1000)
hr.rotate_if_needed()
check('cascade: KEEP generations survive',
      names() == ['health.csv.%d' % i for i in range(1, hr.KEEP + 1)])
check('cascade: newest generation is the file that just rolled',
      open(hr.CSV + '.1').read() == 'x' * 1000)
check('cascade: gen1 shifted to gen2', open(hr.CSV + '.2').read() == 'gen1')
check('cascade: oldest generation was dropped, not kept',
      not os.path.exists('%s.%d' % (hr.CSV, hr.KEEP + 1)))

# --- rotation happens mid-run, not only at startup --------------------------
# The regression this guards: rotate_if_needed() used to be called once before
# the loop, so a machine that stayed up for days wrote one file that grew
# without limit and never exercised KEEP at all. Run the real main loop with a
# tiny threshold and a fast tick, and require that it rolls on its own.
shutil.rmtree(TMP)
os.makedirs(TMP)
# Sized so the run rolls a few times but stays inside KEEP, which is what makes
# sample conservation exactly checkable below: nothing should have been dropped
# by the cascade, so every row written must still be on disk.
hr.ROTATE_BYTES = 20000
hr.INTERVAL = 0.001
hr.FSYNC_EVERY = 0.0          # consider rotation on every tick
hr.CLK_TCK = 100

# Stub out everything that reads the machine. The values do not matter; the
# only thing under test is that rows keep being written and the file rolls.
hr.ext5v = lambda: 5.05
hr.throttled = lambda: 0
hr.soc_c = lambda: 55.0
hr.mem_available_mb = lambda: 6000
hr.port_open = lambda port, host='127.0.0.1': 1
hr.find_pids = lambda: {}
hr.cpu_jiffies = lambda pid: 0
hr.read = lambda path: '0.5 0.4 0.3' if path == '/proc/loadavg' else ''
hr.boot_id = lambda: 'testboot'
hr.load_state = lambda: {}
hr.save_state = lambda state: None

TICKS = {'n': 0}
real_sleep = hr.time.sleep


def counting_sleep(seconds):
    TICKS['n'] += 1
    if TICKS['n'] >= 1000:
        raise KeyboardInterrupt      # the loop's own clean-exit path
    real_sleep(0)


hr.time.sleep = counting_sleep
try:
    hr.main()
finally:
    hr.time.sleep = real_sleep

rolled = [n for n in names() if n != 'health.csv']
check('mid-run: the loop rotated without a restart', len(rolled) >= 1)
check('mid-run: a live file exists after the roll', os.path.exists(hr.CSV))
check('mid-run: rolled generation is at least ROTATE_BYTES',
      all(os.path.getsize(os.path.join(TMP, n)) >= hr.ROTATE_BYTES for n in rolled))

# The header is the reason a bare `os.replace` is not enough — a rolled file
# leaves an empty live file behind, and a CSV whose first line is data is not
# loadable by anything.
first_line = open(hr.CSV).readline().strip()
check('mid-run: the new file starts with the column header',
      first_line == ','.join(hr.COLUMNS))
check('mid-run: rolled generation also starts with a header',
      open(os.path.join(TMP, rolled[0])).readline().strip() == ','.join(hr.COLUMNS))

# No sample may be lost across the roll. Every line after each header must be a
# full row, and the files together must hold every tick the loop wrote — the run
# is sized to stay inside KEEP, so nothing may go missing for any reason.
total = 0
for name in ['health.csv'] + rolled:
    lines = [l for l in open(os.path.join(TMP, name)).read().splitlines() if l]
    check('%s: every row has %d fields' % (name, len(hr.COLUMNS)),
          all(len(l.split(',')) == len(hr.COLUMNS) for l in lines))
    total += len(lines) - 1        # minus the header
check('mid-run: no samples lost across the roll (%d rows, %d ticks)'
      % (total, TICKS['n']), total == TICKS['n'])
check('mid-run: it really did roll more than once', len(rolled) >= 2)

# --- KEEP is honoured over repeated rolls in one run ------------------------
check('mid-run: never more than KEEP generations on disk', len(rolled) <= hr.KEEP)

shutil.rmtree(TMP, ignore_errors=True)

print()
if fails:
    print('%d FAILED:' % len(fails))
    for name in fails:
        print('  - ' + name)
    raise SystemExit(1)
print('all checks passed')
