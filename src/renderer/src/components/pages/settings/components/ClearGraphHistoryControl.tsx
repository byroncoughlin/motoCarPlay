import { Button } from '@mui/material'
import { MOTO_CLEAR_GRAPH_HISTORY_EVENT } from '@renderer/components/pages/projection/motoGraphEvents'
import type { SettingsCustomPageProps } from '@renderer/routes/types'
import type { Config } from '@shared/types'
import { useEffect, useRef, useState } from 'react'
import { SettingsItemRow } from './settingsItemRow'
import { settingsActionButtonSx } from './settingsStyle'

export function ClearGraphHistoryControl(_props: SettingsCustomPageProps<Config, unknown>) {
  // Single stable button slot: first tap arms, second tap clears. No layout
  // reflow (the button keeps its size; only the label/colour changes).
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
    window.dispatchEvent(new CustomEvent(MOTO_CLEAR_GRAPH_HISTORY_EVENT))
  }

  return (
    <SettingsItemRow label="Graph History">
      <Button
        variant="outlined"
        color="error"
        onClick={onClick}
        sx={{ ...settingsActionButtonSx, minWidth: 150 }}
      >
        {armed ? 'TAP TO CONFIRM' : 'CLEAR LOG'}
      </Button>
    </SettingsItemRow>
  )
}
