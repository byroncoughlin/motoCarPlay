import { Button } from '@mui/material'
import { MOTO_CLEAR_GRAPH_HISTORY_EVENT } from '@renderer/components/pages/projection/motoGraphEvents'
import type { SettingsCustomPageProps } from '@renderer/routes/types'
import type { Config } from '@shared/types'
import { useEffect, useRef, useState } from 'react'
import { SettingsItemRow } from './settingsItemRow'
import { settingsActionButtonSx } from './settingsStyle'

// Single stable button slot; only the label/colour changes (no reflow).
// Same contract as ClearDiagnosticsControl: the arm never expires (a silent
// expiry made the confirm tap re-arm instead, indistinguishable from success),
// and a completed clear says so before reverting to idle.
type Phase = 'idle' | 'armed' | 'cleared'

const RESULT_SHOWN_MS = 4000

export function ClearGraphHistoryControl(_props: SettingsCustomPageProps<Config, unknown>) {
  const [phase, setPhase] = useState<Phase>('idle')
  const revert = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (revert.current) clearTimeout(revert.current)
    },
    []
  )

  const onClick = (): void => {
    if (phase !== 'armed') {
      if (revert.current) clearTimeout(revert.current)
      setPhase('armed')
      return
    }
    window.dispatchEvent(new CustomEvent(MOTO_CLEAR_GRAPH_HISTORY_EVENT))
    setPhase('cleared')
    revert.current = setTimeout(() => setPhase('idle'), RESULT_SHOWN_MS)
  }

  const label = phase === 'armed' ? 'Tap to Confirm' : phase === 'cleared' ? 'Cleared' : 'Clear Log'

  return (
    <SettingsItemRow label="Graph History">
      <Button
        variant="outlined"
        color={phase === 'cleared' ? 'success' : 'error'}
        onClick={onClick}
        sx={{ ...settingsActionButtonSx, minWidth: 150 }}
      >
        {label}
      </Button>
    </SettingsItemRow>
  )
}
