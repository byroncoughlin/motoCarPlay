import { Button, Stack, Typography } from '@mui/material'
import type { SettingsCustomPageProps } from '@renderer/routes/types'
import type { Config } from '@shared/types'
import { useLiviStore } from '@store/store'
import { useState } from 'react'
import { SettingsItemRow } from './settingsItemRow'

const finiteNumber = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

const formatDegrees = (value: unknown): string => {
  const n = finiteNumber(value) ?? 0
  return n.toFixed(1)
}

const readTiltSnapshot = async (): Promise<{ leanOffset: number; pitchOffset: number }> => {
  const snapshot = await window.projection?.ipc?.getTelemetrySnapshot?.()
  const msg = snapshot && typeof snapshot === 'object' ? (snapshot as Record<string, unknown>) : {}

  return {
    leanOffset: finiteNumber(msg.leanDeg) ?? 0,
    pitchOffset: finiteNumber(msg.pitchDeg) ?? 0
  }
}

export function TiltCalibrationControl({ state }: SettingsCustomPageProps<Config, unknown>) {
  const saveSettings = useLiviStore((s) => s.saveSettings)
  const [busy, setBusy] = useState(false)

  const leanOffset = finiteNumber(state?.leanOffset) ?? 0
  const pitchOffset = finiteNumber(state?.pitchOffset) ?? 0

  const setLevel = async () => {
    if (busy) return
    setBusy(true)
    try {
      await saveSettings(await readTiltSnapshot())
    } catch (err) {
      console.warn('[MotoDisplay] tilt calibration failed', err)
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    if (busy) return
    setBusy(true)
    try {
      await saveSettings({ leanOffset: 0, pitchOffset: 0 })
    } catch (err) {
      console.warn('[MotoDisplay] tilt reset failed', err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsItemRow label="Tilt Calibration">
      <Stack
        direction="row"
        spacing={0.75}
        useFlexGap
        sx={{
          alignItems: 'center',
          flexWrap: 'wrap',
          flex: '0 0 auto',
          justifyContent: 'flex-end',
          minWidth: 0,
          py: 0.5
        }}
      >
        <Button
          size="small"
          variant="outlined"
          disabled={busy}
          onClick={setLevel}
          sx={{
            minWidth: 0,
            px: 1,
            py: 0.35,
            fontSize: 'clamp(0.62rem, 1.4svh, 0.78rem)',
            lineHeight: 1.1,
            whiteSpace: 'nowrap'
          }}
        >
          SET LEVEL
        </Button>
        <Button
          size="small"
          variant="outlined"
          color="warning"
          disabled={busy}
          onClick={reset}
          sx={{
            minWidth: 0,
            px: 1,
            py: 0.35,
            fontSize: 'clamp(0.62rem, 1.4svh, 0.78rem)',
            lineHeight: 1.1,
            whiteSpace: 'nowrap'
          }}
        >
          RESET
        </Button>
        <Typography
          sx={{
            color: 'text.secondary',
            fontSize: 'clamp(0.62rem, 1.35svh, 0.76rem)',
            lineHeight: 1.1,
            whiteSpace: 'nowrap'
          }}
        >
          L {formatDegrees(leanOffset)}
          {'\u00b0'} P {formatDegrees(pitchOffset)}
          {'\u00b0'}
        </Typography>
      </Stack>
    </SettingsItemRow>
  )
}
