import { Button } from '@mui/material'
import type { SettingsCustomPageProps } from '@renderer/routes/types'
import type { Config } from '@shared/types'
import { useEffect, useRef, useState } from 'react'
import { SettingsItemRow } from './settingsItemRow'
import { settingsActionButtonSx } from './settingsStyle'

// Single stable button slot; only the label/colour changes (no reflow).
// Arm → confirm has NO expiry: an armed button stays armed until it is tapped
// again or the page unmounts (a silently-expiring arm made a second tap re-arm
// instead of confirm, which looked identical to success). After the clear runs
// the button reports the true on-disk outcome from the main process — deleted
// count, or failure if files survived — so silence can't masquerade as success.
type Phase = 'idle' | 'armed' | 'clearing' | 'cleared' | 'failed'

const RESULT_SHOWN_MS = 4000

export function ClearDiagnosticsControl(_props: SettingsCustomPageProps<Config, unknown>) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [deleted, setDeleted] = useState(0)
  const revert = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (revert.current) clearTimeout(revert.current)
    },
    []
  )

  const showResult = (next: 'cleared' | 'failed'): void => {
    setPhase(next)
    revert.current = setTimeout(() => setPhase('idle'), RESULT_SHOWN_MS)
  }

  const onClick = (): void => {
    if (phase === 'clearing') return
    if (phase !== 'armed') {
      if (revert.current) clearTimeout(revert.current)
      setPhase('armed')
      return
    }
    setPhase('clearing')
    Promise.resolve(window.projection?.ipc?.clearDiagnostics?.())
      .then((result) => {
        if (result?.ok) {
          setDeleted(result.deleted)
          showResult('cleared')
        } else {
          showResult('failed')
        }
      })
      .catch(() => showResult('failed'))
  }

  const label =
    phase === 'armed'
      ? 'Tap to Confirm'
      : phase === 'clearing'
        ? 'Clearing'
        : phase === 'cleared'
          ? deleted === 0
            ? 'No Files Found'
            : `Deleted ${deleted} File${deleted === 1 ? '' : 's'}`
          : phase === 'failed'
            ? 'Clear Failed'
            : 'Clear Data'

  return (
    <SettingsItemRow label="Diagnostic Data">
      <Button
        variant="outlined"
        color={phase === 'cleared' ? 'success' : 'error'}
        disabled={phase === 'clearing'}
        onClick={onClick}
        sx={{ ...settingsActionButtonSx, minWidth: 150 }}
      >
        {label}
      </Button>
    </SettingsItemRow>
  )
}
