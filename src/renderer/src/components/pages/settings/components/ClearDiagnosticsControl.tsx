import { Button } from '@mui/material'
import type { SettingsCustomPageProps } from '@renderer/routes/types'
import type { Config } from '@shared/types'
import { useEffect, useRef, useState } from 'react'
import { SettingsItemRow } from './settingsItemRow'
import { settingsActionButtonSx } from './settingsStyle'

export function ClearDiagnosticsControl(_props: SettingsCustomPageProps<Config, unknown>) {
  // Single stable button slot: first tap arms, second tap clears. No reflow.
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const onClick = () => {
    if (!armed) {
      setArmed(true)
      timer.current = setTimeout(() => setArmed(false), 3000)
      return
    }
    if (timer.current) clearTimeout(timer.current)
    setArmed(false)
    void window.projection?.ipc?.clearDiagnostics?.().catch(() => {})
  }

  return (
    <SettingsItemRow label="Diagnostic Data">
      <Button
        variant="outlined"
        color="error"
        onClick={onClick}
        sx={{ ...settingsActionButtonSx, minWidth: 150 }}
      >
        {armed ? 'TAP TO CONFIRM' : 'CLEAR DATA'}
      </Button>
    </SettingsItemRow>
  )
}
