#!/bin/bash
# One-shot LIVI health checklist (see CLAUDE.md §12). Kept as a file because
# quoting this through nested ssh single-quotes reliably mangles the greps.
LOG=/home/byron/LIVI/LIVI.log
echo "boot:      $(uptime -s)"
echo -n "port4000:  "; ss -ltn | grep -q ':4000' && echo UP || echo DOWN
echo -n "port9222:  "; ss -ltn | grep -q ':9222' && echo OPEN--BAD || echo closed
pid=$(pgrep -f LIVI.AppImage | head -1)
echo -n "debugflag: "; tr '\0' ' ' < /proc/$pid/cmdline 2>/dev/null | grep -q remote-debugging && echo YES--BAD || echo no
echo "gst:       $(grep -aoE 'GStreamer [0-9.]+|native addon load failed' "$LOG" | tail -1)"
echo "codecs:    $(grep -a 'GStreamer codecs' "$LOG" | tail -1 | cut -c1-120)"
echo "firstframe:$(grep -a FirstFrame "$LOG" | tail -1)"
echo "crashes:   $(grep -acE 'Segmentation|Bus error|uncaughtException|ENOENT' "$LOG")"
echo "cores:     $(ls /tmp/core.* 2>/dev/null | wc -l)"
echo "sensors:   $(systemctl --user is-active gps.service imu.service cht-temp.service ambient-temp.service | tr '\n' ' ')"
echo "recorder:  $(systemctl is-active livi-health-recorder)"
echo "journal:   $(journalctl --list-boots --no-pager | tail -n +2 | wc -l) boots retained, $(journalctl --disk-usage | grep -oE '[0-9.]+[MG] ' | head -1)"
echo "throttled: $(vcgencmd get_throttled)  ext5v=$(vcgencmd pmic_read_adc EXT5V_V | grep -oE '[0-9.]+V$')"
