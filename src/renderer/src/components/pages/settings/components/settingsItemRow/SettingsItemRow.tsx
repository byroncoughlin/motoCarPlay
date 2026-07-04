import { Typography } from '@mui/material'
import { ReactNode } from 'react'
import { StackItem } from '../stackItem'
import { settingsRowLabelSx } from '../settingsStyle'

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
