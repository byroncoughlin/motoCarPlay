import ArrowBackIosOutlinedIcon from '@mui/icons-material/ArrowBackIosOutlined'
import RestartAltOutlinedIcon from '@mui/icons-material/RestartAltOutlined'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import { useTheme } from '@mui/material/styles'
import Typography from '@mui/material/Typography'
import { useLayoutEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { SettingsLayoutProps } from './types'

type Vp = { w: number; h: number }

const clampPx = (min: number, pref: number, max: number) => Math.max(min, Math.min(pref, max))

export const SettingsLayout = ({
  children,
  title,
  showRestart,
  onRestart
}: SettingsLayoutProps) => {
  const navigate = useNavigate()
  const theme = useTheme()
  const location = useLocation()

  //const handleNavigate = () => navigate(-1)
  const handleNavigate = () => {
    const el = document.activeElement as HTMLElement | null
    if (el && el !== document.body) el.blur?.()
    requestAnimationFrame(() => navigate(-1))
  }

  const showBack = location.pathname !== '/settings'

  const [vp, setVp] = useState<Vp>(() => {
    const vv = window.visualViewport
    return {
      w: Math.round(vv?.width ?? window.innerWidth),
      h: Math.round(vv?.height ?? window.innerHeight)
    }
  })

  useLayoutEffect(() => {
    const vv = window.visualViewport

    const update = () => {
      setVp({
        w: Math.round(vv?.width ?? window.innerWidth),
        h: Math.round(vv?.height ?? window.innerHeight)
      })
    }

    update()
    window.addEventListener('resize', update)
    vv?.addEventListener('resize', update)

    return () => {
      window.removeEventListener('resize', update)
      vv?.removeEventListener('resize', update)
    }
  }, [])

  const px = useMemo(() => {
    const vw = vp.w / 100
    const vh = vp.h / 100
    const roundSafe = Math.abs(vp.w - vp.h) <= 80 && vp.w <= 900 && vp.h <= 900

    const pl = roundSafe ? 8 : clampPx(12, 1.5 * vw, 28)
    const pr = roundSafe ? 8 : clampPx(12, 3.5 * vw, 28)
    const pt = roundSafe ? 0 : clampPx(8, 2.2 * vh, 18)
    const pb = roundSafe ? 0 : clampPx(10, 2.2 * vh, 18)

    const headerH = roundSafe ? clampPx(34, 4.8 * vh, 40) : clampPx(32, 5.5 * vh, 44)
    const slotLeftW = roundSafe ? clampPx(34, 5 * vw, 44) : clampPx(36, 6 * vw, 56)
    const slotRightW = roundSafe ? clampPx(44, 7 * vw, 76) : clampPx(36, 8 * vw, 100)
    const iconPx = roundSafe ? clampPx(18, 2.8 * vh, 22) : clampPx(18, 3.2 * vh, 28)
    const titlePx = roundSafe ? clampPx(18, 2.8 * vh, 23) : clampPx(16, 3.6 * vh, 34)
    const applyPx = roundSafe ? clampPx(12, 1.6 * vh, 14) : clampPx(13, 1.8 * vh, 16)
    const frameW = roundSafe ? clampPx(420, 62.5 * vw, 500) : undefined
    const frameH = roundSafe ? clampPx(430, 65 * vh, 520) : undefined

    return {
      roundSafe,
      frameW,
      frameH,
      pl,
      pr,
      pt,
      pb,
      headerH,
      slotLeftW,
      slotRightW,
      iconPx,
      titlePx,
      applyPx
    }
  }, [vp.h, vp.w])

  return (
    <Box
      sx={{
        position: 'absolute',
        ...(px.roundSafe
          ? {
              top: '50%',
              left: '50%',
              width: `${px.frameW}px`,
              height: `${px.frameH}px`,
              maxWidth: 'calc(100% - 16px)',
              maxHeight: 'calc(100% - 16px)',
              transform: 'translate(-50%, -50%)'
            }
          : { inset: 0 }),
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
        boxSizing: 'border-box',
        pl: `${px.pl}px`,
        pr: `${px.pr}px`,
        pt: `${px.pt}px`,
        pb: `${px.pb}px`,
        gap: px.roundSafe ? '6px' : '0.75rem'
      }}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: `${px.slotLeftW}px 1fr ${px.slotRightW}px`,
          alignItems: 'center',
          height: `${px.headerH}px`,
          px: '0.5rem',
          boxSizing: 'border-box',
          flex: '0 0 auto'
        }}
      >
        <Box
          sx={{
            width: `${px.slotLeftW}px`,
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start'
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
                width: `${px.slotLeftW}px`,
                height: '100%',
                p: 0,
                m: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <ArrowBackIosOutlinedIcon sx={{ fontSize: `${px.iconPx}px` }} />
            </IconButton>
          ) : (
            <Box sx={{ width: `${px.slotLeftW}px`, height: '100%' }} />
          )}
        </Box>

        <Box
          sx={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 0
          }}
        >
          <Typography
            sx={{
              textAlign: 'center',
              fontWeight: 800,
              lineHeight: 1.05,
              fontSize: `${px.titlePx}px`,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '100%'
            }}
          >
            {title}
          </Typography>
        </Box>

        <Box
          sx={{
            width: `${px.slotRightW}px`,
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end'
          }}
        >
          {showRestart ? (
            <IconButton
              onClick={onRestart}
              aria-label="Apply"
              sx={{
                width: `${px.slotRightW}px`,
                height: '100%',
                p: 0,
                m: 0,
                color: theme.palette.primary.main,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  whiteSpace: 'nowrap',
                  fontSize: `${px.applyPx}px`,
                  gap: '0.5rem'
                }}
              >
                <span>Apply</span>
                <RestartAltOutlinedIcon sx={{ fontSize: `${px.iconPx}px` }} />
              </Box>
            </IconButton>
          ) : (
            <Box sx={{ width: `${px.slotRightW}px`, height: '100%' }} />
          )}
        </Box>
      </Box>

      <Box
        sx={{
          flex: '1 1 auto',
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          scrollbarGutter: 'stable',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y',
          pb: px.roundSafe ? '10px' : 0
        }}
      >
        <Stack
          spacing={0}
          sx={{
            minHeight: '100%',
            padding: px.roundSafe ? '0 0 0 2px' : '0 0 0 0.5rem'
          }}
        >
          {children}
        </Stack>
      </Box>
    </Box>
  )
}
