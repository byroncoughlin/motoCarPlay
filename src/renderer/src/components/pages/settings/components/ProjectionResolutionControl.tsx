import { MenuItem, Select } from '@mui/material'
import type { SettingsCustomPageProps } from '@renderer/routes/types'
import type { Config } from '@shared/types'
import { useLiviStore } from '@store/store'
import { useMemo } from 'react'
import { SettingsItemRow } from './settingsItemRow'

// CarPlay stream resolution presets.
//
// The phone renders its UI at the negotiated stream resolution; a smaller stream
// makes the phone lay its whole UI out for a small display, so buttons/text end up
// much larger. LIVI then scales that frame to fill the visible round centre square.
//
// Every preset renders edge-to-edge on the phone (view area 0); the compositor
// contains the frame to the 586 centre square and LIVI masks the surrounding
// margin. Larger stream = more content / smaller buttons; 300 is the practical
// floor before it gets soft. (The old 800 preset relied on a 107px phone-side
// view area to fake containment; the compositor now does it natively, so 800 —
// which was effectively 586 — is redundant and has been removed.)
type ResolutionPreset = {
  size: number
  inset: number
}

const PRESETS: ResolutionPreset[] = [
  { size: 586, inset: 0 },
  { size: 480, inset: 0 },
  { size: 320, inset: 0 },
  { size: 300, inset: 0 }
]

const DEFAULT_PRESET = PRESETS[0]

const fieldsForPreset = (preset: ResolutionPreset): Partial<Config> => ({
  projectionWidth: preset.size,
  projectionHeight: preset.size,
  projectionViewAreaTop: preset.inset,
  projectionViewAreaBottom: preset.inset,
  projectionViewAreaLeft: preset.inset,
  projectionViewAreaRight: preset.inset
})

// Pick the preset whose stream width is closest to the configured width so the
// dropdown reflects the current config even after manual tweaks.
const effectivePreset = (cfg: Partial<Config> | undefined): ResolutionPreset => {
  const width = typeof cfg?.projectionWidth === 'number' ? cfg.projectionWidth : DEFAULT_PRESET.size
  return PRESETS.reduce((best, p) =>
    Math.abs(p.size - width) < Math.abs(best.size - width) ? p : best
  )
}

const label = (preset: ResolutionPreset): string => `${preset.size}×${preset.size}`

// A single toggle for the CarPlay stream resolution. Writes the linked
// width/height/view-area fields together; the projection session needs a restart
// to renegotiate, which the standard "Restart" affordance handles because these
// paths are in requiresRestartParams.
export function ProjectionResolutionControl({
  state,
  requestRestart
}: SettingsCustomPageProps<Config, unknown>) {
  const cfg = state as Partial<Config>
  const saveSettings = useLiviStore((s) => s.saveSettings)
  const current = useMemo(() => effectivePreset(cfg), [cfg])

  const onSelect = (nextSize: number) => {
    if (nextSize === current.size) return
    const next = PRESETS.find((p) => p.size === nextSize)
    if (!next) return
    void saveSettings(fieldsForPreset(next))
    requestRestart?.()
  }

  return (
    <SettingsItemRow label="CarPlay Resolution">
      <Select
        size="small"
        value={current.size}
        onChange={(e) => onSelect(Number(e.target.value))}
        sx={{
          minWidth: 210,
          height: 44,
          borderRadius: '12px',
          fontSize: '15px',
          '& .MuiSelect-icon': { color: 'text.secondary' }
        }}
      >
        {PRESETS.map((p) => (
          <MenuItem key={p.size} value={p.size}>
            {label(p)}
          </MenuItem>
        ))}
      </Select>
    </SettingsItemRow>
  )
}
