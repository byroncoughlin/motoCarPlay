#!/bin/sh
# Launch wrapper for LIVI.
#
# The autostart entry used to be `LIVI.AppImage > LIVI.log` — a truncating
# redirect, so every boot destroyed the previous boot's log. After the
# 2026-08-08/09 trip (USB dropouts and full display freezes) there was nothing
# left to read: the reboot that recovered the unit also erased the evidence.
#
# This keeps one log per boot under ~/LIVI/logs and symlinks ~/LIVI/LIVI.log at
# the current one, so every existing habit (`grep -a … ~/LIVI/LIVI.log`, the
# health checklist in CLAUDE.md) keeps working unchanged.

set -u

BASE=/home/byron/LIVI
LOG_DIR="$BASE/logs"
KEEP=12                 # boots to retain
BUDGET_KB=204800        # 200 MB total ceiling for the directory

mkdir -p "$LOG_DIR"

# Prune by count, newest first.
ls -1t "$LOG_DIR"/LIVI-*.log 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
    rm -f "$old"
done

# Then prune by total size, oldest first, in case one boot logged pathologically.
while [ "$(du -sk "$LOG_DIR" 2>/dev/null | cut -f1)" -gt "$BUDGET_KB" ]; do
    oldest=$(ls -1tr "$LOG_DIR"/LIVI-*.log 2>/dev/null | head -1)
    [ -n "$oldest" ] || break
    rm -f "$oldest"
done

# The Pi has no battery-backed RTC, so this stamp comes from fake-hwclock until
# NTP lands. It stays monotonic across boots, which is all the ordering needs;
# absolute time inside the log is correct once chrony syncs.
LOG="$LOG_DIR/LIVI-$(date +%Y%m%d-%H%M%S).log"
: >>"$LOG"
ln -sfn "$LOG" "$BASE/LIVI.log"

{
    echo "=== LIVI boot $(date -Is) ==="
    echo "kernel:   $(uname -r)"
    echo "boot_id:  $(cat /proc/sys/kernel/random/boot_id 2>/dev/null)"
    echo "uptime:   $(uptime -s)"
    echo "throttled:$(vcgencmd get_throttled 2>/dev/null)"
} >>"$LOG" 2>&1

ulimit -c unlimited
exec "$BASE/LIVI.AppImage" >>"$LOG" 2>&1
