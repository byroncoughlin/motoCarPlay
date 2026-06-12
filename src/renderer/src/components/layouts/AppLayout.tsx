import WifiIcon from '@mui/icons-material/Wifi'
import WifiOffIcon from '@mui/icons-material/WifiOff'
import Box from '@mui/material/Box'
import { useTheme } from '@mui/material/styles'
import Typography from '@mui/material/Typography'
import { useLiviStore } from '@store/store'
import { FC, PropsWithChildren, useCallback } from 'react'
import { useLocation } from 'react-router'
import { ROUTES, UI } from '../../constants'
import { useAutoHideNav } from '../../hooks/useAutoHideNav'
import { useBlinkingTime } from '../../hooks/useBlinkingTime'
import { useNetworkStatus } from '../../hooks/useNetworkStatus'
import { getWindowRole } from '../../utils/windowRole'
import { Nav } from '../navigation'
import { useTabsConfig } from '../navigation/useTabsConfig'
import { AppLayoutProps } from './types'

export const AppLayout: FC<PropsWithChildren<AppLayoutProps>> = ({
  children,
  navRef,
  mainRef,
  receivingVideo
}) => {
  const { pathname } = useLocation()
  const settings = useLiviStore((s) => s.settings)
  const time = useBlinkingTime()
  const network = useNetworkStatus()
  const theme = useTheme()

  // Time + Wi-Fi widget only on the Main window
  const isVisibleTimeAndWifi =
    getWindowRole() === 'main' && window.innerHeight > UI.MIN_HEIGHT_SHOW_TIME_WIFI

  const inAutoHideNavPage = pathname === ROUTES.CLUSTER || pathname === ROUTES.TELEMETRY

  const { hidden: clusterNavHidden } = useAutoHideNav(inAutoHideNavPage, navRef.current)

  const tabs = useTabsConfig(receivingVideo)
  const singleTab = tabs.length <= 1

  const hideNavHome = pathname === ROUTES.HOME
  const hideNav = hideNavHome || (inAutoHideNavPage && clusterNavHidden)
  const renderNav = !singleTab && !hideNavHome
  const isMainWindow = getWindowRole() === 'main'
  const inHostUiPage = pathname !== ROUTES.HOME && pathname !== ROUTES.CLUSTER
  const useRoundHostShell = isMainWindow && inHostUiPage

  // Steering wheel position
  const isRhd = Number(settings?.hand ?? 0) === 1
  const layoutDirection: 'row' | 'row-reverse' = isRhd ? 'row-reverse' : 'row'

  const onUserActivity = useCallback(() => {
    window.app?.notifyUserActivity?.()
  }, [])

  const body = (
    <>
      {renderNav && (
        <div
          ref={navRef}
          id="nav-root"
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            borderRight: isRhd ? undefined : '1px solid #444',
            borderLeft: isRhd ? '1px solid #444' : undefined,
            flex: '0 0 auto',
            position: 'relative',
            zIndex: 1200,
            opacity: hideNav ? 0 : 1,
            transform: hideNav
              ? isRhd
                ? 'translateX(10px)'
                : 'translateX(-10px)'
              : 'translateX(0)',
            transition: 'opacity 220ms ease, transform 220ms ease',
            pointerEvents: hideNav ? 'none' : 'auto'
          }}
        >
          {isVisibleTimeAndWifi && (
            <div
              style={{
                paddingTop: '1rem',
                background: theme.palette.background.paper
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', flexDirection: 'column' }}>
                <Typography style={{ fontSize: '1.5rem' }}>{time}</Typography>

                <div>
                  {network.type === 'wifi' ? (
                    <WifiIcon fontSize="small" style={{ fontSize: '1rem' }} />
                  ) : !network.online ? (
                    <WifiOffIcon fontSize="small" style={{ fontSize: '1rem', opacity: 0.7 }} />
                  ) : null}
                </div>
              </Box>
            </div>
          )}

          {/* Nav should fill remaining height */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            <Nav receivingVideo={receivingVideo} settings={settings} />
          </div>
        </div>
      )}

      {/* CONTENT COLUMN */}
      <div
        ref={mainRef}
        id="content-root"
        data-nav-hidden={hideNav || singleTab ? '1' : '0'}
        style={{
          flex: 1,
          minWidth: 0,
          height: '100%',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        {children}
      </div>
    </>
  )

  return (
    <div
      id="main"
      className="App"
      onPointerDownCapture={onUserActivity}
      style={{
        height: '100dvh',
        touchAction: 'none',
        display: useRoundHostShell ? 'grid' : 'flex',
        gridTemplateColumns: useRoundHostShell ? '1fr' : undefined,
        gridTemplateRows: useRoundHostShell ? '1fr' : undefined,
        placeItems: useRoundHostShell ? 'center' : undefined,
        flexDirection: useRoundHostShell ? undefined : layoutDirection
      }}
    >
      {useRoundHostShell ? (
        <div
          id="round-host-shell"
          style={{
            width: 'min(591px, calc(100vw - 16px))',
            height: 'min(536px, calc(100dvh - 16px))',
            display: 'flex',
            flexDirection: layoutDirection,
            position: 'relative',
            overflow: 'hidden'
          }}
        >
          {body}
        </div>
      ) : (
        body
      )}
    </div>
  )
}
