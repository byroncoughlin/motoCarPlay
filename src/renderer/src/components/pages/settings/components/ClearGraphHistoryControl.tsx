import { Button, Stack } from '@mui/material'
import { MOTO_CLEAR_GRAPH_HISTORY_EVENT } from '@renderer/components/pages/projection/motoGraphEvents'
import type { SettingsCustomPageProps } from '@renderer/routes/types'
import type { Config } from '@shared/types'
import { useState } from 'react'
import { SettingsItemRow } from './settingsItemRow'

export function ClearGraphHistoryControl(_props: SettingsCustomPageProps<Config, unknown>) {
  const [confirm, setConfirm] = useState(false)

  const dispatchClear = () => {
    window.dispatchEvent(new CustomEvent(MOTO_CLEAR_GRAPH_HISTORY_EVENT))
    setConfirm(false)
  }

  return (
    <SettingsItemRow label="Graph History">
      <Stack
        direction="row"
        spacing={0.75}
        useFlexGap
        sx={{
          alignItems: 'center',
          justifyContent: 'flex-end',
          flexWrap: 'wrap',
          py: 0.5
        }}
      >
        {confirm ? (
          <>
            <Button
              size="small"
              variant="outlined"
              onClick={() => setConfirm(false)}
              sx={{
                minWidth: 0,
                px: 1,
                py: 0.35,
                fontSize: 'clamp(0.62rem, 1.4svh, 0.78rem)',
                lineHeight: 1.1,
                whiteSpace: 'nowrap'
              }}
            >
              CANCEL
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="error"
              onClick={dispatchClear}
              sx={{
                minWidth: 0,
                px: 1,
                py: 0.35,
                fontSize: 'clamp(0.62rem, 1.4svh, 0.78rem)',
                lineHeight: 1.1,
                whiteSpace: 'nowrap'
              }}
            >
              CONFIRM
            </Button>
          </>
        ) : (
          <Button
            size="small"
            variant="outlined"
            color="error"
            onClick={() => setConfirm(true)}
            sx={{
              minWidth: 0,
              px: 1,
              py: 0.35,
              fontSize: 'clamp(0.62rem, 1.4svh, 0.78rem)',
              lineHeight: 1.1,
              whiteSpace: 'nowrap'
            }}
          >
            CLEAR LOG
          </Button>
        )}
      </Stack>
    </SettingsItemRow>
  )
}
