import { Box, MenuItem, Select, Typography } from '@mui/material'
import type { SettingsCustomPageProps } from '@renderer/routes/types'
import type { Config } from '@shared/types'
import { useLiviStore } from '@store/store'
import { useState } from 'react'
import { SettingsItemRow } from './settingsItemRow'

// One-tap CarPlay stream resolutions. The glass is always the same 800×800
// panel — a lower stream is simply upscaled by the video plane, so these exist
// to see how Apple lays out its UI when told the display is smaller.
const RESOLUTIONS = [800, 720, 540, 480] as const

// View-area inset per resolution, keeping Apple's content square at the same
// fraction of the frame as today (107/800 = 13.375%). Values are even because
// SendViewArea floors odd top/left insets (toEven); scaled back to the glass,
// 96/720, 72/540 and 64/480 all land at 106.67px — within a third of a pixel
// of the 800-native square, so the overlay geometry does not move.
const VIEW_INSET: Record<number, number> = { 800: 107, 720: 96, 540: 72, 480: 64 }

// The coherent group a resolution change must write together. FPS, DPI and the
// (all-zero) safe-area insets are deliberately untouched: safe area is additive
// to the view area, and the DPI config field is not part of the CarPlay
// handshake in this driver (it only feeds Android Auto).
export function resolutionPatch(size: number): Partial<Config> {
  const inset = VIEW_INSET[size]
  return {
    projectionWidth: size,
    projectionHeight: size,
    projectionViewAreaTop: inset,
    projectionViewAreaBottom: inset,
    projectionViewAreaLeft: inset,
    projectionViewAreaRight: inset
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
          The phone reconnects at the new resolution. The picture fills the same area of the screen
          either way.
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
  const isKnown = width === height && (RESOLUTIONS as readonly number[]).includes(width)
  // A hand-edited non-square config shows as itself and stays selectable-away-from.
  const selectValue = isKnown ? String(width) : 'custom'

  const onSelect = (raw: string) => {
    const size = Number(raw)
    if (!Number.isFinite(size) || !(RESOLUTIONS as readonly number[]).includes(size)) return
    if (size === width && width === height) return
    setPendingSize(size)
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
          {!isKnown && (
            <MenuItem value="custom" disabled>
              {`Custom (${width} × ${height})`}
            </MenuItem>
          )}
          {RESOLUTIONS.map((r) => (
            <MenuItem key={r} value={String(r)}>
              {r === 800 ? '800 × 800 (native)' : `${r} × ${r}`}
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
