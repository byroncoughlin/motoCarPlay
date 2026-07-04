import { Button, Stack, Typography } from '@mui/material'
import type { SettingsCustomPageProps } from '@renderer/routes/types'
import type { Config } from '@shared/types'
import { useLiviStore } from '@store/store'
import { useState } from 'react'
import { SettingsItemRow } from './settingsItemRow'
import { settingsActionButtonSx, settingsRowValueSx } from './settingsStyle'

const finiteNumber = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

const formatDegrees = (value: unknown): string => {
  const n = finiteNumber(value) ?? 0
  return n.toFixed(1)
}

const readTiltSnapshot = async (
  reverseTilt: boolean,
  reversePitch: boolean
): Promise<{ leanOffset: number; pitchOffset: number }> => {
  const snapshot = await window.projection?.ipc?.getTelemetrySnapshot?.()
  const msg = snapshot && typeof snapshot === 'object' ? (snapshot as Record<string, unknown>) : {}

  // The projection overlay displays `signedLean - leanOffset`, where signedLean
  // is negated when reverse-tilt/pitch is on. The IPC snapshot carries the raw
  // (un-reversed) angle, so we must apply the same sign here; otherwise SET
  // LEVEL stores the wrong-signed offset and the readout jumps to ~2× instead
  // of zeroing.
  const rawLean = finiteNumber(msg.leanDeg) ?? 0
  const rawPitch = finiteNumber(msg.pitchDeg) ?? 0
  return {
    leanOffset: reverseTilt ? -rawLean : rawLean,
    pitchOffset: reversePitch ? -rawPitch : rawPitch
  }
}

export function TiltCalibrationControl({ state }: SettingsCustomPageProps<Config, unknown>) {
  const saveSettings = useLiviStore((s) => s.saveSettings)
  const [busy, setBusy] = useState(false)

  const leanOffset = finiteNumber(state?.leanOffset) ?? 0
  const pitchOffset = finiteNumber(state?.pitchOffset) ?? 0
  const reverseTilt = state?.reverseTilt ?? false
  const reversePitch = state?.reversePitch ?? false

  const setLevel = async () => {
    if (busy) return
    setBusy(true)
    try {
      await saveSettings(await readTiltSnapshot(reverseTilt, reversePitch))
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
        spacing={1}
        useFlexGap
        sx={{
          alignItems: 'center',
          flexWrap: 'nowrap',
          flex: '0 0 auto',
          justifyContent: 'flex-end',
          minWidth: 0
        }}
      >
        <Typography sx={{ ...settingsRowValueSx, mr: 0.5 }}>
          L {formatDegrees(leanOffset)}
          {'\u00b0'} P {formatDegrees(pitchOffset)}
          {'\u00b0'}
        </Typography>
        <Button
          variant="outlined"
          disabled={busy}
          onClick={setLevel}
          sx={settingsActionButtonSx}
        >
          SET LEVEL
        </Button>
        <Button
          variant="outlined"
          color="warning"
          disabled={busy}
          onClick={reset}
          sx={settingsActionButtonSx}
        >
          RESET
        </Button>
      </Stack>
    </SettingsItemRow>
  )
}
