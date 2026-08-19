import { Box, MenuItem, Select, Typography } from '@mui/material'
import type { SettingsCustomPageProps } from '@renderer/routes/types'
import type { Config } from '@shared/types'
import { useLiviStore } from '@store/store'
import { useState } from 'react'
import { SettingsItemRow } from './settingsItemRow'

// Options are named by what actually drives Apple's layout: the CONTENT
// square (safe area) CarPlay draws its UI into — not the stream size. The
// glass square is fixed (586px of the 800px panel, 73.25%), so the stream is
// derived backwards: stream ≈ safe ÷ 0.7325, nudged so that both the stream
// size and the insets are even (SendViewArea floors odd top/left insets via
// toEven, and H.264 wants even dimensions — 736 and 656 are even multiples of
// 16, so macroblocks align exactly). stream − 2·inset === safe, exactly.
// Upscaled back to the glass, the content square lands within ±1px of the
// native 586 (587.0 at 540, 585.4 at 480), under the masks' 1px bleed.
type ResolutionOption = { safe: number; stream: number; inset: number }

const OPTIONS: ResolutionOption[] = [
  { safe: 586, stream: 800, inset: 107 },
  { safe: 540, stream: 736, inset: 98 },
  { safe: 480, stream: 656, inset: 88 }
]

// The coherent group a resolution change must write together. FPS, DPI and the
// (all-zero) safe-area insets are deliberately untouched: safe area is additive
// to the view area, and the DPI config field is not part of the CarPlay
// handshake in this driver (it only feeds Android Auto).
export function resolutionPatch(safe: number): Partial<Config> {
  const option = OPTIONS.find((o) => o.safe === safe)
  if (!option) return {}
  return {
    projectionWidth: option.stream,
    projectionHeight: option.stream,
    projectionViewAreaTop: option.inset,
    projectionViewAreaBottom: option.inset,
    projectionViewAreaLeft: option.inset,
    projectionViewAreaRight: option.inset
  }
}

function ConfirmDialog({
  size,
  onCancel,
  onConfirm
}: {
  size: number
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Box
      role="dialog"
      aria-modal="true"
      aria-label="Change CarPlay resolution"
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 5000,
        display: 'grid',
        placeItems: 'center',
        p: '24px',
        background: 'rgba(0,0,0,0.9)'
      }}
    >
      <Box
        sx={{
          width: 'min(390px, 100%)',
          borderRadius: '8px',
          border: '1px solid rgba(255,255,255,0.14)',
          background: '#101316',
          p: '24px',
          textAlign: 'center',
          boxShadow: '0 18px 50px rgba(0,0,0,0.55)'
        }}
      >
        <Typography sx={{ fontSize: 28, fontWeight: 900, lineHeight: 1.05 }}>
          {`Switch to ${size} × ${size}?`}
        </Typography>
        <Typography sx={{ mt: 1, color: 'rgba(255,255,255,0.68)', fontSize: 15, lineHeight: 1.25 }}>
          Apple redraws its UI into a {size}px square, upscaled to the same area of the screen. The
          phone reconnects to apply it.
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', mt: '24px' }}>
          <Box
            component="button"
            onClick={onCancel}
            sx={{
              minHeight: 54,
              borderRadius: '8px',
              fontWeight: 900,
              cursor: 'pointer',
              color: '#fff',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.3)'
            }}
          >
            Cancel
          </Box>
          <Box
            component="button"
            onClick={onConfirm}
            sx={{
              minHeight: 54,
              borderRadius: '8px',
              fontWeight: 900,
              cursor: 'pointer',
              color: '#ffca28',
              background: 'transparent',
              border: '1px solid rgba(255,202,40,0.5)'
            }}
          >
            Save &amp; Reconnect
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

export function ProjectionResolutionControl({ state }: SettingsCustomPageProps<Config, unknown>) {
  const cfg = state as Partial<Config>
  const saveSettings = useLiviStore((s) => s.saveSettings)
  const [pendingSize, setPendingSize] = useState<number | null>(null)

  const width = cfg?.projectionWidth ?? 800
  const height = cfg?.projectionHeight ?? 800
  const current = OPTIONS.find(
    (o) =>
      o.stream === width &&
      o.stream === height &&
      (cfg?.projectionViewAreaTop ?? 107) === o.inset &&
      (cfg?.projectionViewAreaLeft ?? 107) === o.inset
  )
  // A hand-edited config shows its actual content square and stays
  // selectable-away-from.
  const selectValue = current ? String(current.safe) : 'custom'
  const customSafeW = Math.max(
    0,
    width - (cfg?.projectionViewAreaLeft ?? 0) - (cfg?.projectionViewAreaRight ?? 0)
  )
  const customSafeH = Math.max(
    0,
    height - (cfg?.projectionViewAreaTop ?? 0) - (cfg?.projectionViewAreaBottom ?? 0)
  )

  const onSelect = (raw: string) => {
    const safe = Number(raw)
    if (!OPTIONS.some((o) => o.safe === safe)) return
    if (current?.safe === safe) return
    setPendingSize(safe)
  }

  return (
    <>
      <SettingsItemRow label="CarPlay Resolution">
        <Select
          size="small"
          value={selectValue}
          onChange={(e) => onSelect(String(e.target.value))}
          sx={{
            minWidth: 210,
            height: 52,
            borderRadius: '12px',
            fontSize: '16px',
            '& .MuiSelect-icon': { color: 'text.secondary' }
          }}
        >
          {!current && (
            <MenuItem value="custom" disabled>
              {`Custom (${customSafeW} × ${customSafeH})`}
            </MenuItem>
          )}
          {OPTIONS.map((o) => (
            <MenuItem key={o.safe} value={String(o.safe)}>
              {o.safe === 586 ? '586 × 586 (native)' : `${o.safe} × ${o.safe}`}
            </MenuItem>
          ))}
        </Select>
      </SettingsItemRow>

      {pendingSize != null && (
        <ConfirmDialog
          size={pendingSize}
          onCancel={() => setPendingSize(null)}
          onConfirm={() => {
            const size = pendingSize
            setPendingSize(null)
            void (async () => {
              await saveSettings(resolutionPatch(size))
              try {
                // Projection restart, not app restart: the gst plane already
                // recreates itself on the geometry change, and restartSession
                // re-opens the dongle so the phone renegotiates at the new size.
                await window.projection?.ipc?.restart?.()
              } catch (e) {
                console.warn('[resolution] projection restart failed (ignored)', e)
              }
            })()
          }}
        />
      )}
    </>
  )
}
