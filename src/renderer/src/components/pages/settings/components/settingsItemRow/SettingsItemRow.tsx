import { Typography } from '@mui/material'
import { ReactNode } from 'react'
import { settingsRowLabelSx } from '../settingsStyle'
import { StackItem } from '../stackItem'

type Props = {
  label: string
  children?: ReactNode
}

export const SettingsItemRow = ({ label, children }: Props) => {
  return (
    <StackItem>
      <Typography sx={settingsRowLabelSx}>{label}</Typography>
      {children}
    </StackItem>
  )
}
