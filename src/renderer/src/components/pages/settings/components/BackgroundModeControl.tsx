import { Box, MenuItem, Select, Stack, Typography } from '@mui/material'
import type { SettingsCustomPageProps } from '@renderer/routes/types'
import type { Config } from '@shared/types'
import { useLiviStore } from '@store/store'
import { useEffect, useMemo, useState } from 'react'
import { AMBIENT_FILL_SWATCHES } from './SettingsFieldControl'
import { SettingsItemRow } from './settingsItemRow'
import { settingsRowValueSx } from './settingsStyle'

type BgMode = 'solid' | 'average' | 'blur' | 'extend'

const DEFAULT_FILL = AMBIENT_FILL_SWATCHES[0]

/** Derive the single effective background mode from the linked fields. */
function effectiveMode(cfg: Partial<Config> | undefined): BgMode {
  // Extend wins: CarPlay paints its own wallpaper to the edge, so the other
  // background fills are irrelevant while it is on.
  if (cfg?.projectionSafeAreaDrawOutside) return 'extend'
  if (cfg?.backdropEnabled) return cfg.backdropMode === 'blur' ? 'blur' : 'average'
  // Solid is the default when no live-video backdrop is active (ambient fill or nothing).
  return 'solid'
}

/** The field combination that expresses a given mode. Modes are mutually
 *  exclusive: exactly one of the four is active, so every branch sets every
 *  linked field explicitly (including projectionSafeAreaDrawOutside).
 *  roundedCornerMaskEnabled stays true in EVERY mode: switching backgrounds
 *  must never silently turn the rounded corners off. Where rounding does not
 *  apply (extend has no window boundary; blur rounds natively in the gst
 *  pipeline) the render layer skips it — the setting itself is not touched. */
function fieldsForMode(mode: BgMode, fillColor: string): Partial<Config> {
  switch (mode) {
    case 'solid':
      return {
        projectionSafeAreaDrawOutside: false,
        backdropEnabled: false,
        ambientFillEnabled: true,
        ambientFillColor: fillColor,
        roundedCornerMaskEnabled: true
      }
    case 'average':
      return {
        projectionSafeAreaDrawOutside: false,
        backdropEnabled: true,
        backdropMode: 'color',
        ambientFillEnabled: false,
        roundedCornerMaskEnabled: true
      }
    case 'blur':
      return {
        projectionSafeAreaDrawOutside: false,
        backdropEnabled: true,
        backdropMode: 'blur',
        ambientFillEnabled: false,
        roundedCornerMaskEnabled: true
      }
    case 'extend':
      // CarPlay draws its wallpaper across the whole round display; no fill or
      // backdrop is needed.
      return {
        projectionSafeAreaDrawOutside: true,
        backdropEnabled: false,
        ambientFillEnabled: false,
        roundedCornerMaskEnabled: true
      }
  }
}

/** Whether moving between two modes touches the live native-video path or the
 *  CarPlay handshake insets (either needs a clean restart / phone reconnect). */
function needsRestart(from: BgMode, to: BgMode): boolean {
  if (from === to) return false
  const usesNative = (m: BgMode) => m === 'average' || m === 'blur'
  // Extend changes the view/safe-area insets sent during the CarPlay handshake,
  // so entering or leaving it must reconnect the phone.
  const touchesHandshake = (m: BgMode) => m === 'extend'
  return usesNative(from) || usesNative(to) || touchesHandshake(from) || touchesHandshake(to)
}

const OPTIONS: Array<{ value: BgMode; label: string }> = [
  { value: 'solid', label: 'Solid Color' },
  { value: 'average', label: 'Average Frame Color' },
  { value: 'blur', label: 'Frame Capture with Blur' },
  { value: 'extend', label: 'Extend CarPlay Background' }
]

function RestartDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <Box
      role="dialog"
      aria-modal="true"
      aria-label="Restart LIVI for background change"
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
          Restart LIVI?
        </Typography>
        <Typography sx={{ mt: 1, color: 'rgba(255,255,255,0.68)', fontSize: 15, lineHeight: 1.25 }}>
          Changing the background needs a clean restart to swap the video path.
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
            Save & Restart
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

export function BackgroundModeControl({ state }: SettingsCustomPageProps<Config, unknown>) {
  const cfg = state as Partial<Config>
  const saveSettings = useLiviStore((s) => s.saveSettings)

  const savedMode = useMemo(() => effectiveMode(cfg), [cfg])
  const savedFill =
    typeof cfg?.ambientFillColor === 'string' && cfg.ambientFillColor.trim() !== ''
      ? cfg.ambientFillColor
      : DEFAULT_FILL

  // Draft mode the user has picked in the dropdown but not yet committed.
  const [draftMode, setDraftMode] = useState<BgMode>(savedMode)
  const [pendingRestart, setPendingRestart] = useState<Partial<Config> | null>(null)

  // Keep the draft in sync if the saved mode changes underneath us (e.g. a
  // reset or another window). Selecting "Solid" doesn't change savedMode, so
  // the pick-a-color-first draft state survives this.
  useEffect(() => {
    setDraftMode(savedMode)
  }, [savedMode])

  const shownMode = draftMode

  const commit = (patch: Partial<Config>, restart: boolean) => {
    if (restart) {
      setPendingRestart(patch)
    } else {
      void saveSettings(patch)
    }
  }

  const onSelectMode = (mode: BgMode) => {
    setDraftMode(mode)
    if (mode === 'solid') {
      // Let the user pick a color first; commit happens when a swatch is chosen.
      // If Solid is already the saved mode, nothing to restart — just reflect it.
      return
    }
    // Average / Blur have no extra input — commit immediately (restart if the
    // effective mode actually changed).
    commit(fieldsForMode(mode, savedFill), needsRestart(savedMode, mode))
  }

  const onPickColor = (color: string) => {
    // Solid mode: apply the chosen color; restart only if we're switching INTO
    // solid from a native-video mode (color change alone never needs restart).
    const restart = needsRestart(savedMode, 'solid')
    commit(fieldsForMode('solid', color), restart)
  }

  return (
    <>
      <SettingsItemRow label="Background">
        <Select
          size="small"
          value={shownMode}
          onChange={(e) => onSelectMode(e.target.value as BgMode)}
          sx={{
            minWidth: 210,
            height: 44,
            borderRadius: '12px',
            fontSize: '15px',
            '& .MuiSelect-icon': { color: 'text.secondary' }
          }}
        >
          {OPTIONS.map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </Select>
      </SettingsItemRow>

      {/* Color row is ALWAYS rendered so the list never jumps when switching
          modes. Swatches are interactive only in Solid mode; otherwise the row
          shows where the colour comes from. */}
      <SettingsItemRow label="Color">
        {shownMode === 'solid' ? (
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'nowrap', alignItems: 'center' }}>
            {AMBIENT_FILL_SWATCHES.map((swatch) => {
              const isSelected =
                savedMode === 'solid' && savedFill.toLowerCase() === swatch.toLowerCase()
              return (
                <button
                  key={swatch}
                  type="button"
                  aria-label={`Background color ${swatch}`}
                  aria-pressed={isSelected}
                  onClick={() => onPickColor(swatch)}
                  style={{
                    width: 36,
                    height: 36,
                    padding: 0,
                    borderRadius: 10,
                    border: `2px solid ${
                      isSelected ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.22)'
                    }`,
                    backgroundColor: swatch,
                    boxShadow: isSelected
                      ? '0 0 0 2px rgba(0,0,0,0.8), 0 0 0 3px rgba(255,255,255,0.36)'
                      : 'none',
                    cursor: 'pointer'
                  }}
                />
              )
            })}
          </Stack>
        ) : (
          <Typography sx={settingsRowValueSx}>
            {shownMode === 'extend' ? 'CarPlay wallpaper' : 'Auto from video'}
          </Typography>
        )}
      </SettingsItemRow>

      {pendingRestart && (
        <RestartDialog
          onCancel={() => {
            setPendingRestart(null)
            setDraftMode(savedMode)
          }}
          onConfirm={() => {
            const patch = pendingRestart
            setPendingRestart(null)
            void (async () => {
              await saveSettings(patch)
              try {
                await window.app?.restartApp?.()
              } catch (e) {
                console.warn('[background] restart failed (ignored)', e)
              }
            })()
          }}
        />
      )}
    </>
  )
}
