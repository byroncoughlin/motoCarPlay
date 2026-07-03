import { Button, Stack } from '@mui/material'
import type { SettingsCustomPageProps } from '@renderer/routes/types'
import type { Config } from '@shared/types'
import { useState } from 'react'
import { SettingsItemRow } from './settingsItemRow'

export function ClearDiagnosticsControl(_props: SettingsCustomPageProps<Config, unknown>) {
  const [confirm, setConfirm] = useState(false)

  const clear = () => {
    void window.projection?.ipc?.clearDiagnostics?.().catch(() => {})
    setConfirm(false)
  }

  return (
    <SettingsItemRow label="Diagnostic Data">
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
              onClick={clear}
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
            CLEAR DATA
          </Button>
        )}
      </Stack>
    </SettingsItemRow>
  )
}
