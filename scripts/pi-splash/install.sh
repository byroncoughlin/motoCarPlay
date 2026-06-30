#!/usr/bin/env bash
# Install the LIVI Plymouth boot splash on Raspberry Pi OS.
# Run as root (or via sudo) on the Pi
set -euo pipefail

THEME_NAME="livi"
THEME_DIR="/usr/share/plymouth/themes/${THEME_NAME}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGO_SRC="${SCRIPT_DIR}/livi-splash.png"

CONFIG_TXT=""
CMDLINE_TXT=""

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo $0" >&2
  exit 1
fi

# Optional logo: if a PNG exists it is installed, but the splash no longer
# depends on it -- the theme draws three large pulsing dots programmatically
# so the user always gets a minimal "powered on / loading" indicator.
HAVE_LOGO=0
if [[ -f "${LOGO_SRC}" ]]; then
  HAVE_LOGO=1
fi

CONFIG_TXT="/boot/firmware/config.txt"
CMDLINE_TXT="/boot/firmware/cmdline.txt"
if [[ ! -f "${CONFIG_TXT}" ]] || [[ ! -f "${CMDLINE_TXT}" ]]; then
  echo "Expected ${CONFIG_TXT} and ${CMDLINE_TXT} (Pi OS Trixie)" >&2
  exit 1
fi

echo "[1/5] Installing Plymouth"
apt-get update -qq
apt-get install -y plymouth plymouth-themes

echo "[2/5] Writing theme to ${THEME_DIR}"
install -d -m 0755 "${THEME_DIR}"
if [[ "${HAVE_LOGO}" -eq 1 ]]; then
  install -m 0644 "${LOGO_SRC}" "${THEME_DIR}/logo.png"
fi

cat > "${THEME_DIR}/${THEME_NAME}.plymouth" <<EOF
[Plymouth Theme]
Name=LIVI
Description=LIVI boot splash
ModuleName=script

[script]
ImageDir=${THEME_DIR}
ScriptFile=${THEME_DIR}/${THEME_NAME}.script
EOF

# Plymouth's script language has NO per-pixel drawing API and Image.Text depends
# on a font having the bullet glyph, so we render a real anti-aliased white dot
# PNG with a tiny pure-Python (zlib only, no PIL) generator and load it as an
# image. Guaranteed to render regardless of installed fonts.
echo "      generating dot.png asset"
python3 - "${THEME_DIR}/dot.png" <<'PYEOF'
import sys, zlib, struct, math

size = 90
cx = cy = (size - 1) / 2.0
radius = 40.0
buf = bytearray()
for y in range(size):
    buf.append(0)  # PNG filter type 0 for this scanline
    for x in range(size):
        d = math.hypot(x - cx, y - cy)
        # anti-aliased edge over 1.5px
        a = max(0.0, min(1.0, (radius - d) / 1.5 + 0.5))
        v = 255  # white
        buf += bytes((v, v, v, int(a * 255)))

def chunk(tag, data):
    c = tag + data
    return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)

png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(bytes(buf), 9))
png += chunk(b"IEND", b"")
open(sys.argv[1], "wb").write(png)
print("      wrote", sys.argv[1], len(png), "bytes")
PYEOF

# Minimal splash: solid black background with three large white dots in the
# center. STATIC (no pulse/animation) -- during early boot the panel back-light
# is off, so an animation just looks like dim flicker; a steady, fully-opaque
# image is the clearest possible "powered on / booting" indicator at this stage.
cat > "${THEME_DIR}/${THEME_NAME}.script" <<'EOF'
Window.SetBackgroundTopColor(0, 0, 0);
Window.SetBackgroundBottomColor(0, 0, 0);

dot_image = Image("dot.png");
dot_w = dot_image.GetWidth();
dot_h = dot_image.GetHeight();
dot_gap = dot_w + 24;    # center-to-center spacing

cx = Window.GetWidth() / 2;
cy = Window.GetHeight() / 2;
start_x = cx - dot_gap - dot_w / 2;
top_y = cy - dot_h / 2;

for (i = 0; i < 3; i++) {
  dots[i].sprite = Sprite(dot_image);
  dots[i].sprite.SetX(start_x + dot_gap * i);
  dots[i].sprite.SetY(top_y);
  dots[i].sprite.SetOpacity(1);
}
EOF

echo "[3/5] Activating theme + rebuilding initramfs"
plymouth-set-default-theme "${THEME_NAME}" -R

# disable_fw_kms_setup=1 means KMS comes up late; let plymouth wait for it
install -d -m 0755 /etc/plymouth
cat > /etc/plymouth/plymouthd.conf <<EOF
[Daemon]
Theme=${THEME_NAME}
ShowDelay=0
DeviceTimeout=30
EOF

echo "[4/5] Patching ${CONFIG_TXT}"
# Pi rainbow off (we run plymouth instead)
if ! grep -qE '^\s*disable_splash=1' "${CONFIG_TXT}"; then
  echo "disable_splash=1" >> "${CONFIG_TXT}"
fi
# Firmware mode-set must run early; otherwise plymouth renders into offline HDMI
sed -i 's/^disable_fw_kms_setup=1$/# disable_fw_kms_setup=1     # disabled by pi-splash for early HDMI/' "${CONFIG_TXT}"

echo "[5/5] Patching ${CMDLINE_TXT}"
cp -a "${CMDLINE_TXT}" "${CMDLINE_TXT}.bak.$(date +%s)"
LINE=$(tr -d '\n' < "${CMDLINE_TXT}")

add_flag() {
  local flag="$1"
  case " ${LINE} " in
    *" ${flag} "*) ;;
    *) LINE="${LINE} ${flag}" ;;
  esac
}

add_flag "quiet"
add_flag "splash"
add_flag "plymouth.ignore-serial-consoles"
add_flag "loglevel=0"

# NOTE: we intentionally do NOT pin a video= mode. The 800x800 round panel mode
# is a non-standard (user-defined) timing the kernel rejects ("User-defined mode
# not supported"), which made plymouth render dim/garbled until the compositor
# took over. Letting plymouth use the EDID-preferred mode renders the splash
# cleanly; the LIVI compositor sets the real 800x800 mode afterwards. Strip any
# previously-pinned video= flag.
LINE=$(echo "${LINE}" | sed -E 's/[[:space:]]*video=[^[:space:]]+//g')
add_flag "logo.nologo"
add_flag "vt.global_cursor_default=0"

echo "${LINE}" > "${CMDLINE_TXT}"

echo
echo "Done. Reboot to see the new splash."
