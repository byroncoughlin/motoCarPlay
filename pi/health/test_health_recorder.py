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
# Small enough that the handful of lines this run produces actually rolls it.
hr.EVENTS_ROTATE_BYTES = 200
# Point the janitor at throwaway directories. Without this the test would sweep
# the real ~/LIVI/cores and ~/LIVI/logs on whatever machine it runs on, which is
# an unacceptable thing for a test to do.
JUNK = tempfile.mkdtemp(prefix='livi-junk-test-')
hr.CORES_DIR = os.path.join(JUNK, 'cores')
hr.BOOT_LOGS_DIR = os.path.join(JUNK, 'logs')

# Stub out everything that reads the machine. The values do not matter; the
# only thing under test is that rows keep being written and the file rolls.
hr.ext5v = lambda: 5.05
hr.throttled = lambda: 0
hr.soc_c = lambda: 55.0
hr.mem_available_mb = lambda: 6000
hr.port_open = lambda port, host='127.0.0.1': 1
hr.find_pids = lambda: {}
hr.cpu_jiffies = lambda pid: 0
REAL_READ = hr.read          # the loop stub below is blunt; some checks need the real one
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

# --- hdmi_connected parses hot-plug-detect, and never throws ----------------
HDMI = tempfile.mkdtemp(prefix='livi-hdmi-test-')
old_hdmi_path, stub_read = hr.HDMI_STATUS, hr.read
hr.read = REAL_READ          # this one must actually touch the filesystem
hr.HDMI_STATUS = os.path.join(HDMI, 'status')
for text, expected, label in (('connected\n', 1, 'connected -> 1'),
                              ('disconnected\n', 0, 'disconnected -> 0'),
                              ('unknown\n', 0, 'unknown is not connected'),
                              ('', '', 'empty file -> blank, not a guess')):
    with open(hr.HDMI_STATUS, 'w') as handle:
        handle.write(text)
    check('hdmi: %s' % label, hr.hdmi_connected() == expected)
os.unlink(hr.HDMI_STATUS)
check('hdmi: a missing connector reads blank rather than raising',
      hr.hdmi_connected() == '')
hr.HDMI_STATUS, hr.read = old_hdmi_path, stub_read
shutil.rmtree(HDMI, ignore_errors=True)

# --- a schema change rolls rather than interleaving -------------------------
# health.csv is opened in append mode across restarts, so adding a column would
# otherwise mix old-width and new-width rows in one file — unparseable, and
# only discovered while trying to analyse the incident the file exists for.
check('first_line reads the header without slurping the file',
      hr.first_line(hr.CSV) == ','.join(hr.COLUMNS))
check('first_line survives a missing file', hr.first_line(hr.CSV + '.nope') == '')

SCHEMA = tempfile.mkdtemp(prefix='livi-schema-test-')
old_csv, old_events = hr.CSV, hr.EVENTS
old_events_rotate = hr.EVENTS_ROTATE_BYTES
hr.EVENTS_ROTATE_BYTES = 1 << 20    # keep events rotation out of this section
hr.CSV = os.path.join(SCHEMA, 'health.csv')
hr.EVENTS = os.path.join(SCHEMA, 'events.log')
with open(hr.CSV, 'w') as handle:
    handle.write('ts,mono,ext5v\n2026-01-01T00:00:00,1.0,5.05\n')
TICKS['n'] = 0


def two_ticks(seconds):
    TICKS['n'] += 1
    if TICKS['n'] >= 2:
        raise KeyboardInterrupt
    real_sleep(0)


hr.time.sleep = two_ticks
try:
    hr.main()
finally:
    hr.time.sleep = real_sleep

check('schema: the narrower old file was rolled aside',
      os.path.exists(hr.CSV + '.1'))
check('schema: the rolled file kept its own header intact',
      hr.first_line(hr.CSV + '.1') == 'ts,mono,ext5v')
check('schema: the live file starts on the new header',
      hr.first_line(hr.CSV) == ','.join(hr.COLUMNS))
rows = [l for l in open(hr.CSV).read().splitlines() if l][1:]
check('schema: no old-width row leaked into the new file',
      all(len(r.split(',')) == len(hr.COLUMNS) for r in rows))
check('schema: the roll is recorded, not silent',
      'SCHEMA columns changed' in open(hr.EVENTS).read())

# An unchanged header must not roll anything — otherwise every restart would
# throw away a generation of history.
before = sorted(os.listdir(SCHEMA))
TICKS['n'] = 0
hr.time.sleep = two_ticks
try:
    hr.main()
finally:
    hr.time.sleep = real_sleep
check('schema: a matching header does not roll on restart',
      sorted(os.listdir(SCHEMA)) == before)
check('schema: the restart appended instead of re-headering',
      open(hr.CSV).read().count(','.join(hr.COLUMNS)) == 1)

shutil.rmtree(SCHEMA, ignore_errors=True)
hr.CSV, hr.EVENTS = old_csv, old_events
hr.EVENTS_ROTATE_BYTES = old_events_rotate

# --- events.log is bounded too ----------------------------------------------
# It had no cap at all. It grows far slower than the CSV, but the loudest case
# is the unattended one: with the app down the dongle re-enumerates every ~13 s
# and every cycle writes a line, so "parked in the garage for a week" was the
# scenario with no ceiling.
events_rolled = sorted(n for n in os.listdir(TMP) if n.startswith('events.log.'))
check('events.log rolled during the run', len(events_rolled) >= 1)
check('events.log: a live file exists after the roll', os.path.exists(hr.EVENTS))
check('events.log: never more than EVENTS_KEEP generations',
      len(events_rolled) <= hr.EVENTS_KEEP)
check('events.log: the roll is announced in the file it describes',
      'ROTATE events.log' in open(os.path.join(TMP, events_rolled[0])).read())
check('events.log: the new file says where it came from',
      'continued from .1' in open(hr.EVENTS).read())

# --- prune_dir keeps the newest and respects both budgets -------------------
PRUNE = tempfile.mkdtemp(prefix='livi-prune-test-')


def make(name, size, mtime):
    path = os.path.join(PRUNE, name)
    with open(path, 'wb') as handle:
        handle.write(b'x' * size)
    os.utime(path, (mtime, mtime))


for index in range(6):
    make('core.livi.%d' % index, 100, 1000 + index)   # index 5 is newest
removed = hr.prune_dir(PRUNE, 3)
left = sorted(os.listdir(PRUNE))
check('prune: count budget leaves exactly keep_files',
      left == ['core.livi.3', 'core.livi.4', 'core.livi.5'])
check('prune: the newest survives', 'core.livi.5' in left)
check('prune: it deleted the oldest, not the newest', sorted(removed) ==
      ['core.livi.0', 'core.livi.1', 'core.livi.2'])
check('prune: a second sweep is a no-op', hr.prune_dir(PRUNE, 3) == [])

# Size budget: three 100-byte files with a 150-byte cap keeps the newest two
# (100 <= 150, 200 > 150 -> the second one goes as well). The rule is that
# total must stay inside the budget, newest first.
shutil.rmtree(PRUNE); os.makedirs(PRUNE)
for index in range(3):
    make('core.%d' % index, 100, 2000 + index)
hr.prune_dir(PRUNE, 10, keep_bytes=150)
check('prune: size budget drops older files', sorted(os.listdir(PRUNE)) == ['core.2'])

# A single core bigger than the whole budget is still kept. Deleting the only
# piece of evidence from the crash we are trying to explain would be the worst
# possible reading of "stay inside the budget".
shutil.rmtree(PRUNE); os.makedirs(PRUNE)
make('core.huge', 4000, 3000)
hr.prune_dir(PRUNE, 10, keep_bytes=150)
check('prune: never deletes the only file, even if it alone busts the budget',
      os.listdir(PRUNE) == ['core.huge'])

# The pattern filter is what stops the boot-log sweep eating cores, or
# anything else that happens to share a directory.
shutil.rmtree(PRUNE); os.makedirs(PRUNE)
for index in range(4):
    make('LIVI-2026080%d.log' % index, 10, 4000 + index)
make('keep-me.txt', 10, 4100)
hr.prune_dir(PRUNE, 1, pattern='LIVI-')
check('prune: pattern confines the sweep',
      sorted(os.listdir(PRUNE)) == ['LIVI-20260803.log', 'keep-me.txt'])

# Housekeeping must never be the thing that kills the recorder.
check('prune: a missing directory is survivable',
      hr.prune_dir(os.path.join(PRUNE, 'nope'), 3) == [])

shutil.rmtree(PRUNE, ignore_errors=True)
shutil.rmtree(JUNK, ignore_errors=True)
shutil.rmtree(TMP, ignore_errors=True)

print()
if fails:
    print('%d FAILED:' % len(fails))
    for name in fails:
        print('  - ' + name)
    raise SystemExit(1)
print('all checks passed')
