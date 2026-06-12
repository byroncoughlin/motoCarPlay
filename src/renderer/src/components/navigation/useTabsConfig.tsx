// Icons
import CropPortraitOutlinedIcon from '@mui/icons-material/CropPortraitOutlined'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import { useTheme } from '@mui/material/styles'
import { useEffect, useState } from 'react'
import { ROUTES, UI } from '../../constants'
import { useStatusStore } from '../../store/store'
import { getWindowRole } from '../../utils/windowRole'
import { TransportSwitchIcon } from './TransportSwitchIcon'
import { TabConfig } from './types'
import { useTransportState } from './useTransportState'

export const useTabsConfig: (receivingVideo: boolean) => TabConfig[] = (receivingVideo) => {
  const theme = useTheme()
  const role = getWindowRole()
  const isStreaming = useStatusStore((s) => s.isStreaming)
  const isAaActive = useStatusStore((s) => s.isAaActive)
  const isDongleConnected = useStatusStore((s) => s.isDongleConnected || s.isAaActive)
  const transport = useTransportState()
  const isXSIcons = typeof window !== 'undefined' && window.innerHeight <= UI.XS_ICON_MAX_HEIGHT
  const iconFontSize = isXSIcons ? 24 : 32
  const rawShowSwitch = role === 'main' && transport.switchPending
  const showSwitch = useDelayedHide(rawShowSwitch, 300)

  // Secondary windows only show tabs that are routed to that role
  if (role !== 'main') {
    return []
  }

  return [
    {
      label: 'Projection',
      path: ROUTES.HOME,
      icon: (() => {
        const usbConnected = isDongleConnected
        const phoneActive = isStreaming || isAaActive
        const baseColor = usbConnected ? theme.palette.text.primary : theme.palette.text.disabled
        const activeColor = 'var(--ui-highlight)'

        if (!usbConnected) {
          return <CropPortraitOutlinedIcon sx={{ color: baseColor, fontSize: iconFontSize }} />
        }

        return (
          <CropPortraitOutlinedIcon
            sx={{
              fontSize: iconFontSize,
              color: phoneActive ? activeColor : baseColor,
              '&, &.MuiSvgIcon-root': {
                color: `${phoneActive ? activeColor : baseColor} !important`
              },
              opacity: !phoneActive ? 'var(--ui-breathe-opacity, 1)' : 1
            }}
          />
        )
      })()
    },
    ...(showSwitch
      ? [
          {
            label: 'Switch transport',
            path: ROUTES.TRANSPORT_SWITCH,
            icon: (
              <TransportSwitchIcon
                active={transport.targetTransport ?? transport.active}
                wiredPhoneActive={
                  transport.targetMode
                    ? transport.targetMode === 'wired'
                    : transport.wiredPhoneActive
                }
                fontSize={iconFontSize}
              />
            )
          }
        ]
      : []),
    {
      label: 'Settings',
      path: ROUTES.SETTINGS,
      icon: <SettingsOutlinedIcon sx={{ fontSize: iconFontSize }} />
    }
  ]
}

function useDelayedHide(value: boolean, delayMs: number): boolean {
  const [held, setHeld] = useState(value)
  useEffect(() => {
    if (value) {
      setHeld(true)
      return
    }
    const t = setTimeout(() => setHeld(false), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return held
}
