import ArrowBackIosOutlinedIcon from '@mui/icons-material/ArrowBackIosOutlined'
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined'
import ExitToAppOutlinedIcon from '@mui/icons-material/ExitToAppOutlined'
import MonitorHeartOutlinedIcon from '@mui/icons-material/MonitorHeartOutlined'
import PowerSettingsNewOutlinedIcon from '@mui/icons-material/PowerSettingsNewOutlined'
import RestartAltOutlinedIcon from '@mui/icons-material/RestartAltOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { ReactElement, ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { ROUTES } from '../../constants'
import { SettingsLayoutProps } from './types'

type ConfirmAction = 'desktop' | 'reboot'

const formatClock12 = (date: Date): string => {
  const hours = date.getHours() % 12 || 12
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

const useSettingsClock = (): string => {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  return formatClock12(now)
}

const blurActiveElement = () => {
  const el = document.activeElement as HTMLElement | null
  if (el && el !== document.body) el.blur?.()
}

type HeaderActionProps = {
  label: string
  ariaLabel: string
  icon: ReactElement
  tone?: 'normal' | 'danger' | 'success'
  onClick: () => void
}

function HeaderActionButton({
  label,
  ariaLabel,
  icon,
  tone = 'normal',
  onClick
}: HeaderActionProps) {
  const palette =
    tone === 'danger'
      ? { color: '#ff8585', border: 'rgba(255,133,133,0.32)', bg: 'rgba(255,85,85,0.1)' }
      : tone === 'success'
        ? { color: '#7ee787', border: 'rgba(126,231,135,0.28)', bg: 'rgba(126,231,135,0.09)' }
        : { color: '#d8dee9', border: 'rgba(255,255,255,0.14)', bg: 'rgba(255,255,255,0.055)' }

  return (
    <Box
      component="button"
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      sx={{
        appearance: 'none',
        border: `1px solid ${palette.border}`,
        borderRadius: '8px',
        background: palette.bg,
        color: palette.color,
        minWidth: 0,
        width: '100%',
        height: '68px',
        p: 0,
        display: 'grid',
        placeItems: 'center',
        gridTemplateRows: '32px 18px',
        gap: '3px',
        cursor: 'pointer',
        userSelect: 'none',
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
        '& svg': { fontSize: 31 },
        '&:active': {
          transform: 'translateY(1px)',
          borderColor: palette.color,
          background: `color-mix(in srgb, ${palette.color} 17%, transparent)`
        },
        '&:focus-visible': {
          outline: `2px solid ${palette.color}`,
          outlineOffset: 2
        }
      }}
    >
      {icon}
      <Box
        component="span"
        sx={{
          fontSize: '11px',
          lineHeight: 1,
          fontWeight: 900,
          letterSpacing: 0,
          textTransform: 'uppercase',
          whiteSpace: 'nowrap'
        }}
      >
        {label}
      </Box>
    </Box>
  )
}

function ConfirmOverlay({
  action,
  onCancel,
  onConfirm
}: {
  action: ConfirmAction
  onCancel: () => void
  onConfirm: () => void
}) {
  const copy =
    action === 'desktop'
      ? {
          title: 'Exit to desktop?',
          body: 'This closes LIVI and leaves the dashboard.',
          confirm: 'Exit',
          color: '#ff8585'
        }
      : {
          title: 'Reboot Pi?',
          body: 'The display will go dark while the Pi restarts.',
          confirm: 'Reboot',
          color: '#ffca28'
        }

  return (
    <Box
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
      sx={{
        position: 'absolute',
        inset: 0,
        zIndex: 30,
        background: 'rgba(0,0,0,0.9)',
        display: 'grid',
        placeItems: 'center',
        p: '24px'
      }}
    >
      <Box
        sx={{
          width: 'min(390px, 100%)',
          borderRadius: '8px',
          border: '1px solid rgba(255,255,255,0.14)',
          background: '#101316',
          p: '24px',
          boxShadow: '0 18px 50px rgba(0,0,0,0.55)',
          textAlign: 'center'
        }}
      >
        <Typography sx={{ fontSize: 28, fontWeight: 900, lineHeight: 1.05 }}>
          {copy.title}
        </Typography>
        <Typography sx={{ mt: 1, color: 'rgba(255,255,255,0.62)', fontSize: 15, lineHeight: 1.25 }}>
          {copy.body}
        </Typography>

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', mt: '24px' }}>
          <Button
            variant="outlined"
            onClick={onCancel}
            sx={{ minHeight: 54, borderRadius: '8px', fontWeight: 900 }}
          >
            Cancel
          </Button>
          <Button
            variant="outlined"
            onClick={onConfirm}
            sx={{
              minHeight: 54,
              borderRadius: '8px',
              fontWeight: 900,
              color: copy.color,
              borderColor: `${copy.color}80`
            }}
          >
            {copy.confirm}
          </Button>
        </Box>
      </Box>
    </Box>
  )
}

export const SettingsLayout = ({
  children,
  title,
  showRestart,
  onRestart
}: SettingsLayoutProps) => {
  const navigate = useNavigate()
  const location = useLocation()
  const clock = useSettingsClock()
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)

  const isSettingsRoot = location.pathname === ROUTES.SETTINGS
  const showBack = !isSettingsRoot
  const showSectionBar = showBack || showRestart

  const sectionTitle = useMemo(() => {
    if (isSettingsRoot) return 'Settings'
    return title
  }, [isSettingsRoot, title])

  const handleNavigate = () => {
    blurActiveElement()
    requestAnimationFrame(() => navigate(-1))
  }

  const handleCloseSettings = () => navigate(ROUTES.HOME, { replace: true })

  const handleOpenMonitor = () => {
    window.dispatchEvent(new CustomEvent('livi:open-system-monitor'))
  }

  const handleConfirm = () => {
    const action = confirmAction
    setConfirmAction(null)
    if (action === 'desktop') {
      window.app?.quitApp?.().catch(console.error)
      return
    }
    if (action === 'reboot') {
      window.app?.rebootSystem?.().catch(console.error)
    }
  }

  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
        boxSizing: 'border-box',
        p: '12px',
        gap: '10px',
        background: 'linear-gradient(180deg, rgba(14,18,22,0.98), rgba(5,7,10,0.98))',
        color: 'text.primary'
      }}
    >
      <Box
        data-testid="settings-header-actions"
        sx={{
          display: 'grid',
          gridTemplateColumns: '84px 96px minmax(0, 1fr) 86px 72px',
          gap: '7px',
          alignItems: 'center',
          flex: '0 0 auto'
        }}
      >
        <HeaderActionButton
          label="Reboot"
          ariaLabel="Reboot Pi"
          icon={<PowerSettingsNewOutlinedIcon />}
          tone="danger"
          onClick={() => setConfirmAction('reboot')}
        />
        <HeaderActionButton
          label="Desktop"
          ariaLabel="Exit to desktop"
          icon={<ExitToAppOutlinedIcon />}
          onClick={() => setConfirmAction('desktop')}
        />

        <Box
          sx={{
            minWidth: 0,
            height: '68px',
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.045)',
            display: 'grid',
            placeItems: 'center',
            px: '8px'
          }}
        >
          <Typography
            data-testid="settings-clock"
            sx={{
              fontFamily: 'monospace',
              fontSize: '37px',
              lineHeight: 1,
              fontWeight: 900,
              letterSpacing: 0,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap'
            }}
          >
            {clock}
          </Typography>
        </Box>

        <HeaderActionButton
          label="Monitor"
          ariaLabel="Open Pi monitor"
          icon={<MonitorHeartOutlinedIcon />}
          onClick={handleOpenMonitor}
        />
        <IconButton
          onClick={handleCloseSettings}
          aria-label="Close settings"
          className="nav-focus-primary"
          disableRipple
          disableFocusRipple
          disableTouchRipple
          sx={{
            width: '64px',
            height: '68px',
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.14)',
            color: '#f8fafc',
            background: 'rgba(255,255,255,0.055)',
            '& svg': { fontSize: 39 },
            '&:active': { transform: 'translateY(1px)' }
          }}
        >
          <CloseOutlinedIcon />
        </IconButton>
      </Box>

      {showSectionBar && (
        <Box
          data-testid="settings-section-bar"
          sx={{
            display: 'grid',
            gridTemplateColumns: '96px minmax(0, 1fr) 112px',
            alignItems: 'center',
            minHeight: '56px',
            gap: '8px',
            flex: '0 0 auto'
          }}
        >
          {showBack ? (
            <IconButton
              onClick={handleNavigate}
              aria-label="Back"
              className="nav-focus-primary"
              disableRipple
              disableFocusRipple
              disableTouchRipple
              sx={{
                width: '96px',
                height: '56px',
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.12)',
                color: '#d8dee9',
                background: 'rgba(255,255,255,0.045)'
              }}
            >
              <ArrowBackIosOutlinedIcon sx={{ fontSize: 28 }} />
            </IconButton>
          ) : (
            <Box />
          )}

          <Typography
            sx={{
              minWidth: 0,
              textAlign: 'center',
              fontWeight: 900,
              lineHeight: 1.05,
              fontSize: '22px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              letterSpacing: 0
            }}
          >
            {sectionTitle}
          </Typography>

          {showRestart ? (
            <Button
              onClick={onRestart}
              aria-label="Apply"
              variant="outlined"
              startIcon={<RestartAltOutlinedIcon sx={{ fontSize: 19 }} />}
              sx={{
                minWidth: 0,
                height: '56px',
                borderRadius: '8px',
                px: '10px',
                color: '#7ee787',
                borderColor: 'rgba(126,231,135,0.32)',
                fontWeight: 900,
                fontSize: '14px',
                lineHeight: 1
              }}
            >
              Apply
            </Button>
          ) : (
            <Box />
          )}
        </Box>
      )}

      <Box
        sx={{
          flex: '1 1 auto',
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          scrollbarGutter: 'stable',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y',
          pr: '2px',
          pb: '10px',
          // Apple-style: a single vertical column of grouped sections. The
          // grouping cards + section headers are rendered by SettingsPage.
          '& .settings-content-stack': {
            display: 'flex',
            flexDirection: 'column',
            gap: isSettingsRoot ? '22px' : '0px',
            minHeight: isSettingsRoot ? 0 : '100%'
          }
        }}
      >
        <Stack className="settings-content-stack" spacing={0}>
          {children as ReactNode}
        </Stack>
      </Box>

      {confirmAction && (
        <ConfirmOverlay
          action={confirmAction}
          onCancel={() => setConfirmAction(null)}
          onConfirm={handleConfirm}
        />
      )}
    </Box>
  )
}
