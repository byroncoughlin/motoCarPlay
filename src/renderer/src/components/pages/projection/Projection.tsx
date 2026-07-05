import PowerSettingsNewOutlinedIcon from '@mui/icons-material/PowerSettingsNewOutlined'
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import { useTheme } from '@mui/material'
import type { Config } from '@shared/types'
import { PhoneType } from '@shared/types/Config'
import { AudioCommand, CommandMapping } from '@shared/types/ProjectionEnums'
import { aaContentArea, isClusterDisplayed, motoFillEnabled, motoFillHex } from '@shared/utils'
import { createProjectionWorker } from '@worker/createProjectionWorker'
import type { KeyCommand, ProjectionWorker, UsbEvent, WorkerToUI } from '@worker/types'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useFftPcm } from '../../../hooks/useFftPcm'
import { useLiviStore, useStatusStore } from '../../../store/store'
import { useProjectionMultiTouch } from './hooks/useProjectionTouch'
import { roundDashboardFramePct } from './motoLayout'
import { ProjectionSensorOverlay } from './ProjectionSensorOverlay'
import { ViewAreaMask } from './ViewAreaMask'

const RETRY_DELAY_MS = 3000
const HOST_UI_ROUTE = '/settings'
const DEFAULT_PROJECTION_SIZE = 800

const positiveOrDefault = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback

const nonNegative = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0

const waitingClockLabel = (date: Date): string => {
  const hours = date.getHours() % 12 || 12
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

type WaitingPowerInfo = { text: string; tone: string } | null

// A transient status note surfaced on the waiting pane so the rider knows what
// just happened (e.g. the adapter dropped off USB — usually a power/wiring dip)
// versus the routine "phone left" case, which is silent.
type WaitingStatusNotice = {
  id: number
  tone: string
  title: string
  detail: string
} | null

const STATUS_NOTICE_TTL_MS = 14_000

// Power warnings surface only LIVE problems. The old version also showed the
// `*Occurred` bits from `vcgencmd get_throttled`, but those latch forever
// after any momentary dip (e.g. cranking the engine at boot) — so every ride
// carried a permanent amber "POWER DIP SEEN". Healthy power shows nothing at
// all: no news is good news. A dip observed while the pane is open is
// surfaced separately (and expires) via the pane's recent-dip tracking.
const describeWaitingPower = (power: PowerStatus | null | undefined): WaitingPowerInfo => {
  if (!power) return null
  const volts =
    power.inputVolts != null
      ? `${power.inputVolts.toFixed(2)}V`
      : power.coreVolts != null
        ? `${power.coreVolts.toFixed(2)}V`
        : null
  if (power.underVoltageNow) {
    return { text: `Low power${volts ? ` · ${volts}` : ''}`, tone: '#ff453a' }
  }
  // throttledNow WITHOUT under-voltage is thermal (the Pi crosses its 80°C
  // soft limit under load, e.g. the CPU burst of an app restart) — report it
  // as heat, never as a power problem. Verified on Byron's Pi: rail steady
  // at ~4.97V while get_throttled showed temp-driven throttle bits (0xe0000).
  if (power.throttledNow) {
    return { text: 'Running hot · CPU throttled', tone: '#ff9f0a' }
  }
  return null
}

// USB power budget for the connected devices (dongle etc.). On the Pi 5 the
// firmware only unlocks the full 1.6A USB budget when it trusts a 5A supply;
// otherwise the ports are capped to 600mA which can starve a CarPlay dongle.
// Only problems are reported — a healthy budget stays silent.
export const describeWaitingUsbPower = (
  power: PowerStatus | null | undefined
): WaitingPowerInfo => {
  if (!power) return null
  if (power.underVoltageNow) {
    return { text: 'USB power low', tone: '#ff453a' }
  }
  if (power.usbHighCurrent === false) {
    return { text: 'USB power limited to 600 mA', tone: '#ff9f0a' }
  }
  return null
}

// How long a live power dip keeps its amber "Power dip" note on screen.
const POWER_DIP_NOTE_MS = 10 * 60 * 1000

// Three-dot indicator that fills progressively to signal CarPlay is imminent
// during the ~3s gap between phone-linked and the first video frame.
function ConnectingDots({ tone }: { tone: string }) {
  return (
    <div
      data-testid="projection-waiting-connecting-dots"
      aria-label="Connecting to CarPlay"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: tone,
            display: 'inline-block',
            animation: 'livi-connecting-dot 1.2s ease-in-out infinite',
            animationDelay: `${i * 0.2}s`
          }}
        />
      ))}
      <style>
        {`@keyframes livi-connecting-dot {
            0%, 80%, 100% { opacity: 0.2; transform: scale(0.7); }
            40% { opacity: 1; transform: scale(1); }
          }`}
      </style>
    </div>
  )
}

const hasLinkedPhoneTransport = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false
  const state = value as Record<string, unknown>
  return (
    state.wiredPhoneDetected === true ||
    state.wirelessPhoneDetected === true ||
    state.wiredPhoneActive === true ||
    state.wirelessPhoneActive === true ||
    state.active === 'aa' ||
    state.active === 'cp'
  )
}

const reportsNoLinkedPhoneTransport = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false
  const state = value as Record<string, unknown>
  const hasPhonePresenceReport = [
    state.wiredPhoneDetected,
    state.wirelessPhoneDetected,
    state.wiredPhoneActive,
    state.wirelessPhoneActive
  ].some((v) => typeof v === 'boolean')

  return hasPhonePresenceReport && !hasLinkedPhoneTransport(value)
}

const isProjectionPhoneType = (value: unknown): boolean =>
  value === PhoneType.CarPlay || value === PhoneType.AndroidAuto

interface CarplayProps {
  receivingVideo: boolean
  setReceivingVideo: (v: boolean) => void
  settings: Config
  command: KeyCommand
  commandCounter: number

  navVideoOverlayActive: boolean
  setNavVideoOverlayActive: (v: boolean) => void
}

type WaitingProjectionPaneProps = {
  settings: Config
  show: boolean
  adapterFound: boolean
  phoneLinked: boolean
  videoStarting: boolean
  statusNotice: WaitingStatusNotice
  onOpenSettings: () => void
}

function WaitingProjectionPane({
  settings,
  show,
  adapterFound,
  phoneLinked,
  videoStarting,
  statusNotice,
  onOpenSettings
}: WaitingProjectionPaneProps) {
  const [now, setNow] = useState(() => new Date())
  const [power, setPower] = useState<WaitingPowerInfo>(null)
  const [usbPower, setUsbPower] = useState<WaitingPowerInfo>(null)
  // Timestamp of the last LIVE under-voltage/throttle sample seen while this
  // pane was open; drives the expiring amber "Power dip" note.
  const [lastDipTs, setLastDipTs] = useState<number | null>(null)
  const [confirmReboot, setConfirmReboot] = useState(false)
  const [researching, setResearching] = useState(false)
  const researchTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const isJsdom =
      typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('jsdom')
    if (!show || isJsdom) return
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [show])

  useEffect(
    () => () => {
      if (researchTimerRef.current != null) window.clearTimeout(researchTimerRef.current)
    },
    []
  )

  useEffect(() => {
    const isJsdom =
      typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('jsdom')
    if (!show || isJsdom || typeof window.app?.systemStats !== 'function') return
    let alive = true
    const read = async () => {
      try {
        const stats = await window.app.systemStats()
        if (alive) {
          setPower(describeWaitingPower(stats?.power))
          setUsbPower(describeWaitingUsbPower(stats?.power))
          // Only a REAL voltage sag arms the dip note. throttledNow alone is
          // thermal (see describeWaitingPower) and made every background-mode
          // app restart show a phantom "Power dip".
          if (stats?.power?.underVoltageNow) {
            setLastDipTs(Date.now())
          }
        }
      } catch {
        // keep the pane passive on a failed sample
      }
    }
    void read()
    const id = window.setInterval(read, 5000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [show])

  const handleResearch = useCallback(() => {
    if (researching) return
    setResearching(true)
    void (async () => {
      try {
        await window.projection?.usb?.detectDongle?.().catch(() => false)
        await window.projection?.usb?.forceReset?.().catch(() => false)
        await window.projection?.ipc?.restart?.().catch(() => {})
      } finally {
        researchTimerRef.current = window.setTimeout(() => {
          researchTimerRef.current = null
          setResearching(false)
        }, 1500)
      }
    })()
  }, [researching])

  const handleReboot = useCallback(() => {
    window.app?.rebootSystem?.().catch(console.error)
  }, [])

  if (!show) return null

  const displayWidth = positiveOrDefault(settings.projectionWidth, DEFAULT_PROJECTION_SIZE)
  const displayHeight = positiveOrDefault(settings.projectionHeight, DEFAULT_PROJECTION_SIZE)
  const left = Math.min(nonNegative(settings.projectionViewAreaLeft), displayWidth)
  const right = Math.min(nonNegative(settings.projectionViewAreaRight), displayWidth - left)
  const top = Math.min(nonNegative(settings.projectionViewAreaTop), displayHeight)
  const bottom = Math.min(nonNegative(settings.projectionViewAreaBottom), displayHeight - top)
  const frame = roundDashboardFramePct(displayWidth, displayHeight, { top, bottom, left, right })
  const clock = waitingClockLabel(now)
  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  })
  // Light / dark by hard-coded local time of day (day = 07:00–19:00).
  const hour = now.getHours()
  const dark = hour < 7 || hour >= 19
  const theme = dark
    ? {
        bg: '#000000',
        surface: 'rgba(255,255,255,0.06)',
        surfaceBorder: 'rgba(255,255,255,0.10)',
        text: '#f5f5f7',
        textDim: 'rgba(235,235,245,0.6)',
        textFaint: 'rgba(235,235,245,0.35)',
        divider: 'rgba(255,255,255,0.08)'
      }
    : {
        bg: '#f2f2f7',
        surface: 'rgba(0,0,0,0.045)',
        surfaceBorder: 'rgba(0,0,0,0.08)',
        text: '#1c1c1e',
        textDim: 'rgba(60,60,67,0.6)',
        textFaint: 'rgba(60,60,67,0.3)',
        divider: 'rgba(0,0,0,0.08)'
      }
  // Apple system status colors (green / blue / red), same in both themes.
  const status = !adapterFound
    ? {
        tone: '#ff3b30',
        adapterTone: '#ff3b30',
        phoneTone: '#ff3b30',
        adapter: 'Adapter missing',
        phone: 'iPhone search paused',
        phoneActive: false
      }
    : videoStarting || phoneLinked
      ? {
          tone: '#34c759',
          adapterTone: '#34c759',
          phoneTone: '#34c759',
          adapter: 'Adapter found',
          phone: 'iPhone linked',
          phoneActive: true
        }
      : {
          tone: '#0a84ff',
          adapterTone: '#34c759',
          phoneTone: '#0a84ff',
          adapter: 'Adapter found',
          phone: 'Searching for iPhone',
          phoneActive: true
        }
  // One quiet status line instead of two bordered chips — the lock-screen
  // look keeps the clock dominant and states only what matters right now.
  const statusLine = !adapterFound
    ? { text: 'Adapter missing', tone: '#ff453a', active: true }
    : videoStarting || phoneLinked
      ? { text: 'iPhone connected', tone: '#34c759', active: true }
      : { text: 'Searching for iPhone…', tone: theme.textDim, active: false }

  // Expiring note for a dip that happened while this pane was open (live
  // problems render via `power` instead).
  const dipAgeMs = lastDipTs != null ? now.getTime() - lastDipTs : null
  const recentDip = power == null && dipAgeMs != null && dipAgeMs < POWER_DIP_NOTE_MS
  const dipMinutes = dipAgeMs != null ? Math.max(1, Math.round(dipAgeMs / 60000)) : 0

  const roundIconBtn = (primary: boolean): React.CSSProperties => ({
    width: 72,
    height: 72,
    borderRadius: '50%',
    border: primary ? 'none' : `1px solid ${theme.surfaceBorder}`,
    background: primary ? '#0a84ff' : theme.surface,
    color: primary ? '#ffffff' : theme.text,
    display: 'grid',
    placeItems: 'center',
    padding: 0,
    cursor: 'pointer',
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent'
  })

  const iconBtnLabel: React.CSSProperties = {
    marginTop: 8,
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: 0.2,
    color: theme.textDim
  }

  return (
    <div
      data-testid="projection-waiting-pane"
      data-appearance={dark ? 'dark' : 'light'}
      className="moto-overlay"
      style={{
        position: 'absolute',
        left: frame.left,
        top: frame.top,
        width: frame.width,
        height: frame.height,
        backgroundColor: theme.bg,
        border: `1px solid ${theme.surfaceBorder}`,
        borderRadius: 34,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 2,
        color: theme.text
      }}
    >
      <div
        data-testid="projection-waiting-content"
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: '72%',
          maxHeight: '82%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          gap: 0
        }}
      >
        <div
          data-testid="projection-waiting-date"
          style={{
            color: theme.textDim,
            fontSize: 21,
            fontWeight: 500,
            letterSpacing: 0.2,
            marginBottom: 4
          }}
        >
          {dateLabel}
        </div>
        {/* Lock-screen clock: huge and thin (Inter weight 200), the visual
            anchor of the whole pane. */}
        <div
          data-testid="projection-waiting-clock"
          style={{
            color: theme.text,
            fontSize: 168,
            fontWeight: 200,
            lineHeight: 1.0,
            letterSpacing: -5,
            fontVariantNumeric: 'tabular-nums'
          }}
        >
          {clock}
        </div>
        <div style={{ height: 22 }} />
        <div
          data-testid="projection-waiting-status"
          data-tone={statusLine.tone}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            color: statusLine.active ? statusLine.tone : theme.textDim,
            fontSize: 20,
            fontWeight: 500,
            letterSpacing: 0.2
          }}
        >
          {statusLine.active && (
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: statusLine.tone,
                flex: '0 0 auto'
              }}
            />
          )}
          {statusLine.text}
        </div>
        {statusNotice && (
          <div
            role="status"
            data-testid="projection-waiting-status-notice"
            data-tone={statusNotice.tone}
            style={{
              marginTop: 16,
              maxWidth: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              padding: '12px 18px',
              borderRadius: 16,
              border: `1px solid ${statusNotice.tone}44`,
              background: `${statusNotice.tone}1a`,
              animation: 'livi-status-notice-in 220ms ease-out'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: statusNotice.tone,
                fontSize: 17,
                fontWeight: 700,
                letterSpacing: 0.2
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: statusNotice.tone,
                  flex: '0 0 auto'
                }}
              />
              {statusNotice.title}
            </div>
            <div
              style={{
                color: theme.textDim,
                fontSize: 15,
                fontWeight: 500,
                textAlign: 'center',
                lineHeight: 1.35
              }}
            >
              {statusNotice.detail}
            </div>
            <style>
              {`@keyframes livi-status-notice-in {
                  from { opacity: 0; transform: translateY(-6px); }
                  to { opacity: 1; transform: translateY(0); }
                }`}
            </style>
          </div>
        )}
        {/*
          Fixed-height slot so the clock never shifts when "Starting CarPlay"
          appears. The connecting indicator fades in inside a reserved row.
        */}
        <div
          data-testid="projection-waiting-connecting-slot"
          style={{
            height: 56,
            marginTop: 14,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8
          }}
        >
          {(videoStarting || phoneLinked) && (
            <>
              <ConnectingDots tone={status.tone} />
              <div
                style={{
                  color: theme.textDim,
                  fontSize: 16,
                  fontWeight: 600,
                  letterSpacing: 0.2
                }}
              >
                Starting CarPlay…
              </div>
            </>
          )}
        </div>
        {/* Power: silent when healthy. Red for a live problem, amber for a
            dip observed in the last 10 minutes or a capped USB budget. */}
        {power && (
          <div
            data-testid="projection-waiting-power"
            style={{
              marginTop: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: power.tone,
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: 0.2
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: power.tone,
                flex: '0 0 auto'
              }}
            />
            {power.text}
          </div>
        )}
        {recentDip && (
          <div
            data-testid="projection-waiting-power-dip"
            style={{
              marginTop: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: '#ff9f0a',
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: 0.2
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: '#ff9f0a',
                flex: '0 0 auto'
              }}
            />
            {`Power dip ${dipMinutes} min ago`}
          </div>
        )}
        {usbPower && (
          <div
            data-testid="projection-waiting-usb-power"
            data-tone={usbPower.tone}
            style={{
              marginTop: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: usbPower.tone,
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: 0.2
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: usbPower.tone,
                flex: '0 0 auto'
              }}
            />
            {usbPower.text}
          </div>
        )}
        {/* Camera-app style action row: three 72px circular icon buttons
            (~7.8mm gloved taps) with quiet labels. Settings moved here from
            the top-right corner so the clock owns the top of the glass. */}
        <div
          data-testid="projection-waiting-actions"
          style={{
            marginTop: 30,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-start',
            gap: 44,
            pointerEvents: 'auto',
            zIndex: 8
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <button
              type="button"
              aria-label="Re-search for dongle and phone"
              data-testid="projection-waiting-research-button"
              disabled={researching}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                handleResearch()
              }}
              style={{
                ...roundIconBtn(!researching),
                cursor: researching ? 'default' : 'pointer'
              }}
            >
              <RefreshOutlinedIcon
                style={{
                  fontSize: 34,
                  animation: researching ? 'livi-research-spin 1s linear infinite' : undefined
                }}
              />
            </button>
            <div style={iconBtnLabel}>{researching ? 'Searching' : 'Search'}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <button
              type="button"
              aria-label="Reboot Pi"
              data-testid="projection-waiting-reboot-button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                setConfirmReboot(true)
              }}
              style={roundIconBtn(false)}
            >
              <PowerSettingsNewOutlinedIcon style={{ fontSize: 34 }} />
            </button>
            <div style={iconBtnLabel}>Reboot</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <button
              type="button"
              aria-label="Open settings"
              data-testid="projection-waiting-settings-button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                onOpenSettings()
              }}
              style={roundIconBtn(false)}
            >
              <SettingsOutlinedIcon style={{ fontSize: 34 }} />
            </button>
            <div style={iconBtnLabel}>Settings</div>
          </div>
          <style>
            {`@keyframes livi-research-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}
          </style>
        </div>
      </div>
      {confirmReboot && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Reboot Pi?"
          data-testid="projection-waiting-reboot-confirm"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 12,
            background: dark ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.32)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            display: 'grid',
            placeItems: 'center',
            padding: 24,
            pointerEvents: 'auto'
          }}
        >
          <div
            style={{
              width: 'min(420px, 100%)',
              borderRadius: 28,
              border: `1px solid ${theme.surfaceBorder}`,
              background: dark ? '#1c1c1e' : '#ffffff',
              padding: 32,
              textAlign: 'center'
            }}
          >
            <div style={{ fontSize: 38, fontWeight: 700, lineHeight: 1.1, color: theme.text }}>
              Reboot Pi?
            </div>
            <div style={{ marginTop: 10, color: theme.textDim, fontSize: 17, lineHeight: 1.35 }}>
              The display will go dark while the Pi restarts.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 28 }}>
              <button
                type="button"
                onClick={() => {
                  setConfirmReboot(false)
                  handleReboot()
                }}
                style={{
                  height: 76,
                  borderRadius: 20,
                  border: 'none',
                  background: '#ff3b30',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: 22,
                  cursor: 'pointer',
                  touchAction: 'manipulation',
                  WebkitTapHighlightColor: 'transparent'
                }}
              >
                Reboot
              </button>
              <button
                type="button"
                onClick={() => setConfirmReboot(false)}
                style={{
                  height: 76,
                  borderRadius: 20,
                  border: `1px solid ${theme.surfaceBorder}`,
                  background: theme.surface,
                  color: theme.text,
                  fontWeight: 600,
                  fontSize: 22,
                  cursor: 'pointer',
                  touchAction: 'manipulation',
                  WebkitTapHighlightColor: 'transparent'
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Projection

const CarplayComponent: React.FC<CarplayProps> = ({
  receivingVideo,
  setReceivingVideo,
  settings,
  command,
  commandCounter,
  navVideoOverlayActive,
  setNavVideoOverlayActive
}) => {
  const navigate = useNavigate()
  const location = useLocation()
  const pathname = location.pathname

  const pathnameRef = useRef(pathname)
  useEffect(() => {
    pathnameRef.current = pathname
  }, [pathname])

  const theme = useTheme()

  // Zustand store
  const backdropSampleColor = useLiviStore((s) => s.backdropSampleColor)
  const isStreaming = useStatusStore((s) => s.isStreaming)
  const setStreaming = useStatusStore((s) => s.setStreaming)
  const setDongleConnected = useStatusStore((s) => s.setDongleConnected)
  const setAaActive = useStatusStore((s) => s.setAaActive)
  const isDongleConnected = useStatusStore((s) => s.isDongleConnected || s.isAaActive)
  const resetInfo = useLiviStore((s) => s.resetInfo)
  const setDeviceInfo = useLiviStore((s) => s.setDeviceInfo)
  const setAudioInfo = useLiviStore((s) => s.setAudioInfo)
  const setPcmData = useLiviStore((s) => s.setPcmData)
  const setBluetoothPairedList = useLiviStore((s) => s.setBluetoothPairedList)
  const bumpAudioDevicesRevision = useLiviStore((s) => s.bumpAudioDevicesRevision)
  const isAaActiveFlag = useStatusStore((s) => s.isAaActive)
  const negotiatedWidth = useLiviStore((s) => s.negotiatedWidth)
  const negotiatedHeight = useLiviStore((s) => s.negotiatedHeight)
  const wirelessAaEnabled = useLiviStore((s) => Boolean(s.settings?.wirelessAaEnabled))

  const prevPathnameRef = useRef(pathname)
  useEffect(() => {
    const prev = prevPathnameRef.current
    prevPathnameRef.current = pathname
    if (pathname !== '/' || prev === '/') return
    if (!isDongleConnected) return
    window.projection.ipc.sendCommand('home')
    void window.projection.ipc.sendFrame().catch(() => {})
  }, [pathname, isDongleConnected])

  // Tell main when the projection surface is shown/hidden so the native
  // GStreamer video can be shown over the UI or hidden behind it
  useEffect(() => {
    const visible = pathname === '/' || navVideoOverlayActive
    void window.projection.ipc.setVisible(visible).catch(() => {})
    document.documentElement.classList.toggle('show-video', visible && receivingVideo)
  }, [pathname, navVideoOverlayActive, receivingVideo])

  useEffect(() => {
    const mode = isAaActiveFlag ? 'AA' : 'dongle'
    console.log(`[PROJECTION] phone connected (${mode}):`, isDongleConnected)
  }, [isDongleConnected, isAaActiveFlag])

  // Refs
  const mainElem = useRef<HTMLDivElement>(null)
  const videoContainerRef = useRef<HTMLDivElement>(null)
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const usbOpTokenRef = useRef(0)
  const hasStartedRef = useRef(false)
  const [projectionSessionActive, setProjectionSessionActive] = useState(false)
  const [statusNotice, setStatusNotice] = useState<WaitingStatusNotice>(null)
  const statusNoticeTimerRef = useRef<number | null>(null)
  const statusNoticeIdRef = useRef(0)
  const [donglePhoneLinked, setDonglePhoneLinkedState] = useState(false)
  const [transportPhoneLinked, setTransportPhoneLinkedState] = useState(false)
  const donglePhoneLinkedRef = useRef(false)
  const transportPhoneLinkedRef = useRef(false)
  const lastNonCarplayPathRef = useRef<string | null>(null)
  const lastNonClusterPathRef = useRef<string | null>(null)
  const autoSwitchedRef = useRef(false)
  const pendingVideoFocusRef = useRef(false)

  const autoSwitchOnStreamRef = useRef(Boolean(settings.autoSwitchOnStream))
  const autoSwitchOnGuidanceRef = useRef(Boolean(settings.autoSwitchOnGuidance))
  const autoSwitchOnPhoneCallRef = useRef(Boolean(settings.autoSwitchOnPhoneCall))
  // Mirrored into refs so the long-lived IPC onEvent handler reads the
  // current values without being torn down/resubscribed on every change
  // (events arriving in the unsubscribe window would be lost).
  const wirelessAaEnabledRef = useRef(wirelessAaEnabled)
  const isStreamingRef = useRef(isStreaming)

  const setDonglePhoneLinked = useCallback((linked: boolean) => {
    if (donglePhoneLinkedRef.current === linked) return
    donglePhoneLinkedRef.current = linked
    setDonglePhoneLinkedState(linked)
  }, [])

  const setTransportPhoneLinked = useCallback((linked: boolean) => {
    if (transportPhoneLinkedRef.current === linked) return
    transportPhoneLinkedRef.current = linked
    setTransportPhoneLinkedState(linked)
  }, [])

  const clearStatusNotice = useCallback(() => {
    if (statusNoticeTimerRef.current != null) {
      window.clearTimeout(statusNoticeTimerRef.current)
      statusNoticeTimerRef.current = null
    }
    setStatusNotice(null)
  }, [])

  const pushStatusNotice = useCallback(
    (notice: { tone: string; title: string; detail: string }) => {
      if (statusNoticeTimerRef.current != null) {
        window.clearTimeout(statusNoticeTimerRef.current)
        statusNoticeTimerRef.current = null
      }
      const id = ++statusNoticeIdRef.current
      setStatusNotice({ id, ...notice })
      const isJsdom =
        typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('jsdom')
      if (isJsdom) return
      statusNoticeTimerRef.current = window.setTimeout(() => {
        statusNoticeTimerRef.current = null
        setStatusNotice((current) => (current && current.id === id ? null : current))
      }, STATUS_NOTICE_TTL_MS)
    },
    []
  )

  const applyTransportPhoneState = useCallback(
    (state: unknown) => {
      const linked = hasLinkedPhoneTransport(state)
      setTransportPhoneLinked(linked)
      if (reportsNoLinkedPhoneTransport(state)) setDonglePhoneLinked(false)
    },
    [setDonglePhoneLinked, setTransportPhoneLinked]
  )

  const refreshTransportPhoneState = useCallback(() => {
    void window.projection.ipc
      .getTransportState?.()
      .then(applyTransportPhoneState)
      .catch(() => {})
  }, [applyTransportPhoneState])

  useEffect(() => {
    autoSwitchOnStreamRef.current = Boolean(settings.autoSwitchOnStream)
  }, [settings.autoSwitchOnStream])

  useEffect(() => {
    autoSwitchOnGuidanceRef.current = Boolean(settings.autoSwitchOnGuidance)
  }, [settings.autoSwitchOnGuidance])

  useEffect(() => {
    autoSwitchOnPhoneCallRef.current = Boolean(settings.autoSwitchOnPhoneCall)
  }, [settings.autoSwitchOnPhoneCall])

  useEffect(() => {
    wirelessAaEnabledRef.current = wirelessAaEnabled
  }, [wirelessAaEnabled])

  useEffect(() => {
    isStreamingRef.current = isStreaming
  }, [isStreaming])

  // Attention-driven UI switching (call / voiceAssistant / nav)
  type AttentionKind = 'call' | 'voiceAssistant'
  type AttentionPayload = { kind: AttentionKind; active: boolean; phase?: string }

  const attentionBackPathRef = useRef<string | null>(null)
  const attentionSwitchedByRef = useRef<AttentionKind | null>(null)
  const voiceAssistantReleaseTimerRef = useRef<number | null>(null)

  const clearVoiceAssistantReleaseTimer = useCallback(() => {
    if (voiceAssistantReleaseTimerRef.current != null) {
      window.clearTimeout(voiceAssistantReleaseTimerRef.current)
      voiceAssistantReleaseTimerRef.current = null
    }
  }, [])

  // Keep track of the last host UI route (anything except "/")
  useEffect(() => {
    if (pathname === '/') return
    if (!attentionSwitchedByRef.current) return

    attentionSwitchedByRef.current = null
    clearVoiceAssistantReleaseTimer()
  }, [pathname, clearVoiceAssistantReleaseTimer])

  useEffect(() => {
    // When NAV video overlay is shown on top of the host UI (not on "/")
    if (!navVideoOverlayActive || pathname === '/') return

    const dismiss = () => {
      setNavVideoOverlayActive(false)
    }

    // Any touch/click/pen should immediately dismiss
    window.addEventListener('pointerdown', dismiss, { capture: true, passive: true })

    return () => {
      window.removeEventListener('pointerdown', dismiss, {
        capture: true
      } as AddEventListenerOptions)
    }
  }, [navVideoOverlayActive, pathname, setNavVideoOverlayActive])

  // Channels
  const audioChannel = useMemo(() => new MessageChannel(), [])

  // Projection worker setup
  const carplayWorker = useMemo<ProjectionWorker>(() => {
    const w = createProjectionWorker()

    w.onerror = (e) => {
      console.error('Worker error:', e)
    }

    w.postMessage(
      {
        type: 'initialise',
        payload: {
          audioPort: audioChannel.port1
        }
      },
      [audioChannel.port1]
    )
    return w
  }, [audioChannel])

  // Forward audio chunks to FFT (shared with the secondary windows via useFftPcm)
  useFftPcm(0)

  // Audio + touch hooks

  const clearRetryTimeout = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }
  }, [])

  // Reads pathnameRef (not location.pathname) so its identity — and that of
  // the IPC onEvent subscription depending on it — survives route changes.
  const gotoHostUI = useCallback(() => {
    if (pathnameRef.current !== HOST_UI_ROUTE) {
      navigate(HOST_UI_ROUTE, { replace: true })
    }
  }, [navigate])

  useEffect(() => {
    let disposed = false
    window.projection.ipc
      .getTransportState?.()
      .then((state) => {
        if (!disposed) applyTransportPhoneState(state)
      })
      .catch(() => {})

    return () => {
      disposed = true
    }
  }, [applyTransportPhoneState])

  const applyAttention = useCallback(
    (p: AttentionPayload) => {
      const inProjection = pathnameRef.current === '/'

      if (p.kind !== 'call' && p.kind !== 'voiceAssistant') return

      // ACTIVE: switch to projection
      if (p.active) {
        if (p.kind === 'voiceAssistant') clearVoiceAssistantReleaseTimer()

        // Already on projection -> nothing to do
        if (inProjection) {
          attentionSwitchedByRef.current = null
          return
        }

        // Not on projection -> we will switch now, so arm return
        attentionBackPathRef.current = pathnameRef.current
        attentionSwitchedByRef.current = p.kind

        navigate('/', { replace: true })
        return
      }

      // INACTIVE: only return if we previously switched because of this kind
      if (attentionSwitchedByRef.current !== p.kind) return

      const back = attentionBackPathRef.current

      const doReturn = () => {
        attentionSwitchedByRef.current = null
        if (back && back !== '/' && pathnameRef.current === '/') {
          navigate(back, { replace: true })
        }
      }

      // Voice assistant: debounce return to avoid flicker
      if (p.kind === 'voiceAssistant') {
        clearVoiceAssistantReleaseTimer()
        voiceAssistantReleaseTimerRef.current = window.setTimeout(() => {
          voiceAssistantReleaseTimerRef.current = null

          if (attentionSwitchedByRef.current !== 'voiceAssistant') return

          doReturn()
        }, 120)

        return
      }

      // Call: return immediately
      doReturn()
    },
    [navigate, clearVoiceAssistantReleaseTimer]
  )

  // Projection worker messages
  useEffect(() => {
    if (!carplayWorker) return
    const handler = (ev: MessageEvent<WorkerToUI>) => {
      const msg = ev.data
      switch (msg.type) {
        case 'requestBuffer': {
          clearRetryTimeout()
          break
        }

        case 'audio': {
          clearRetryTimeout()
          break
        }

        case 'audioInfo':
          setAudioInfo((msg as Extract<WorkerToUI, { type: 'audioInfo' }>).payload)
          break

        case 'pcmData':
          setPcmData(new Float32Array((msg as Extract<WorkerToUI, { type: 'pcmData' }>).payload))
          break

        case 'command': {
          const val = (msg as Extract<WorkerToUI, { type: 'command' }>).message?.value
          if (val === CommandMapping.requestHostUI) gotoHostUI()
          break
        }

        case 'failure':
          hasStartedRef.current = false
          if (!retryTimeoutRef.current) {
            retryTimeoutRef.current = setTimeout(() => window.location.reload(), RETRY_DELAY_MS)
          }
          break
      }
    }

    carplayWorker.addEventListener('message', handler)
    return () => carplayWorker.removeEventListener('message', handler)
  }, [carplayWorker, clearRetryTimeout, gotoHostUI, setAudioInfo, setPcmData])

  // USB events
  useEffect(() => {
    let disposed = false

    const onUsbConnect = async () => {
      const token = ++usbOpTokenRef.current
      if (!hasStartedRef.current) {
        resetInfo()

        let info:
          | { device: false; vendorId: null; productId: null; usbFwVersion: string }
          | { device: true; vendorId: number; productId: number; usbFwVersion: string }
          | null = null

        try {
          info = await window.projection.usb.getDeviceInfo()
        } catch (e) {
          console.warn('[PROJECTION] usb.getDeviceInfo() failed', e)
        }

        if (disposed || token !== usbOpTokenRef.current) return

        if (info?.device) {
          setDeviceInfo({
            vendorId: info.vendorId,
            productId: info.productId,
            usbFwVersion: info.usbFwVersion ?? ''
          })
        }

        setDongleConnected(true)
        hasStartedRef.current = true
        clearStatusNotice()
      }
    }

    const onUsbDisconnect = async () => {
      usbOpTokenRef.current += 1
      clearRetryTimeout()
      setReceivingVideo(false)
      setStreaming(false)
      setDongleConnected(false)
      setDonglePhoneLinked(false)
      hasStartedRef.current = false
      resetInfo()

      // The adapter itself dropped off USB. This is NOT a normal "phone left"
      // (that arrives over the projection channel as 'unplugged'); it usually
      // means the box lost power/connection. Surface a transient notice, and if
      // a power dip is visible, call that out specifically.
      let detail = 'Adapter dropped off USB. Check the dongle cable/connection.'
      let tone = '#ef5350'
      try {
        const stats = await window.app?.systemStats?.()
        const power = stats?.power
        if (power?.underVoltageNow || power?.underVoltageOccurred) {
          detail = 'Low input power detected when the adapter dropped — check 12V/USB power.'
          tone = '#ff7043'
        } else if (power?.throttledNow || power?.throttledOccurred) {
          detail = 'Power throttling seen when the adapter dropped — check 12V/USB power.'
          tone = '#ff7043'
        }
      } catch {
        // keep the generic message if the power sample is unavailable
      }
      pushStatusNotice({ tone, title: 'Adapter disconnected', detail })

      await window.projection.ipc.stop()
    }
    const usbHandler = (_evt: unknown, ...args: unknown[]) => {
      const data = args[0] as UsbEvent | undefined
      if (!data) return
      if (data.type === 'plugged') onUsbConnect()
      else if (data.type === 'unplugged') onUsbDisconnect()
    }

    const unsubscribe = window.projection.usb.listenForEvents(usbHandler)

    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [
    setReceivingVideo,
    setDongleConnected,
    setStreaming,
    clearRetryTimeout,
    resetInfo,
    setDeviceInfo,
    setDonglePhoneLinked,
    clearStatusNotice,
    pushStatusNotice
  ])

  // Settings/events from main
  useEffect(() => {
    const mergeBoxInfo = (prev: unknown, next: unknown): unknown => {
      if (next == null) return prev
      if (typeof next === 'string') {
        const s = next.trim()
        if (!s) return prev
        try {
          next = JSON.parse(s)
        } catch {
          return prev
        }
      }
      if (typeof prev === 'string') {
        const s = prev.trim()
        if (s) {
          try {
            prev = JSON.parse(s)
          } catch {
            prev = null
          }
        } else {
          prev = null
        }
      }
      const isRecord = (v: unknown): v is Record<string, unknown> =>
        typeof v === 'object' && v !== null

      if (isRecord(prev) && isRecord(next)) {
        return { ...prev, ...next }
      }
      return next
    }

    const handler = (_evt: unknown, data: unknown) => {
      const pathnameNow = pathnameRef.current

      const d = (data ?? {}) as Record<string, unknown>
      const t = typeof d.type === 'string' ? d.type : undefined

      switch (t) {
        case 'transportState': {
          applyTransportPhoneState(d.payload)
          break
        }

        case 'bluetoothPairedList': {
          const raw =
            typeof d.payload === 'string'
              ? d.payload
              : typeof (d.payload as { data?: unknown } | undefined)?.data === 'string'
                ? ((d.payload as { data?: string }).data as string)
                : typeof d.data === 'string'
                  ? (d.data as string)
                  : ''

          setBluetoothPairedList(raw)
          break
        }
        case 'audioDevicesChanged': {
          bumpAudioDevicesRevision()
          break
        }
        case 'resolution': {
          const payload = d.payload as { width?: number; height?: number } | undefined
          if (payload && typeof payload.width === 'number' && typeof payload.height === 'number') {
            useLiviStore.setState({
              negotiatedWidth: payload.width,
              negotiatedHeight: payload.height
            })

            setReceivingVideo(true)
            setStreaming(true)

            if (pendingVideoFocusRef.current) {
              pendingVideoFocusRef.current = false
              if (pathnameNow !== '/') {
                navigate('/', { replace: true })
              }
            }
          }
          break
        }

        case 'streaming': {
          if (d.active === true) {
            setReceivingVideo(true)
            setStreaming(true)
          }
          break
        }

        case 'projectionInactive': {
          setProjectionSessionActive(false)
          setStreaming(false)
          setReceivingVideo(false)
          pendingVideoFocusRef.current = false
          setNavVideoOverlayActive(false)
          break
        }

        case 'dongleInfo': {
          const p = d.payload as { dongleFwVersion?: string; boxInfo?: unknown } | undefined
          if (!p) break
          useLiviStore.setState((s) => ({
            dongleFwVersion: p.dongleFwVersion ?? s.dongleFwVersion,
            boxInfo: mergeBoxInfo(s.boxInfo, p.boxInfo)
          }))
          break
        }

        case 'audio': {
          const cmd = (d as { payload?: { command?: number } }).payload?.command
          if (typeof cmd !== 'number') break

          setProjectionSessionActive(true)

          if (cmd === AudioCommand.AudioPhonecallStart) {
            if (autoSwitchOnPhoneCallRef.current) {
              applyAttention({ kind: 'call', active: true, phase: 'active' })
            }
          } else if (cmd === AudioCommand.AudioPhonecallStop) {
            applyAttention({ kind: 'call', active: false, phase: 'ended' })
          } else if (cmd === AudioCommand.AudioAttentionRinging) {
            if (autoSwitchOnPhoneCallRef.current) {
              applyAttention({ kind: 'call', active: true, phase: 'ringing' })
            }
          } else if (cmd === AudioCommand.AudioVoiceAssistantStart) {
            applyAttention({ kind: 'voiceAssistant', active: true })
          } else if (cmd === AudioCommand.AudioVoiceAssistantStop) {
            applyAttention({ kind: 'voiceAssistant', active: false })
          }
          break
        }

        case 'audioInfo': {
          setProjectionSessionActive(true)
          const p = d.payload as
            | {
                codec?: string
                sampleRate?: number
                channels?: number
                bitDepth?: number
              }
            | undefined

          if (!p) break

          setAudioInfo({
            codec: p.codec ?? '',
            sampleRate: p.sampleRate ?? 0,
            channels: p.channels ?? 0,
            bitDepth: p.bitDepth ?? 0
          })

          break
        }

        case 'command': {
          const value = (d as { message?: { value?: number } }).message?.value
          if (typeof value !== 'number') break

          if (
            value === CommandMapping.requestVideoFocus ||
            value === CommandMapping.requestClusterFocus ||
            value === CommandMapping.requestHostUI
          ) {
            setProjectionSessionActive(true)
          }

          if (value === CommandMapping.requestHostUI) {
            gotoHostUI()
            break
          }

          const clusterEnabled = isClusterDisplayed(settings)
          const autoSwitchOnStream = autoSwitchOnStreamRef.current
          const autoSwitchOnGuidance = autoSwitchOnGuidanceRef.current

          if (value === CommandMapping.requestClusterFocus) {
            if (!autoSwitchOnGuidance) break

            if (clusterEnabled) {
              if (pathnameNow === '/' || pathnameNow === '/cluster') break

              lastNonClusterPathRef.current = pathnameNow
              navigate('/cluster', { replace: true })
              break
            }

            if (pathnameNow !== '/') {
              setNavVideoOverlayActive(true)
            }
            break
          }

          if (value === CommandMapping.releaseClusterFocus) {
            if (!autoSwitchOnGuidance) break
            if (clusterEnabled) {
              const back = lastNonClusterPathRef.current
              if (back && back !== '/cluster' && back !== '/') {
                lastNonClusterPathRef.current = null
                navigate(back, { replace: true })
              }
              break
            }

            setNavVideoOverlayActive(false)
            break
          }

          if (value === CommandMapping.requestVideoFocus) {
            if (!autoSwitchOnStream) break
            if (attentionSwitchedByRef.current) break

            if (pathnameNow !== '/' && pathnameNow !== '/cluster') {
              lastNonCarplayPathRef.current = pathnameNow
              autoSwitchedRef.current = true
            }

            if (!isStreamingRef.current) {
              pendingVideoFocusRef.current = true
              break
            }

            if (pathnameNow !== '/') {
              navigate('/', { replace: true })
            }
            break
          }

          if (value === CommandMapping.releaseVideoFocus) {
            if (!autoSwitchOnStream) {
              pendingVideoFocusRef.current = false
              autoSwitchedRef.current = false
              lastNonCarplayPathRef.current = null
              break
            }

            const backFromCluster = lastNonClusterPathRef.current

            if (
              clusterEnabled &&
              pathnameNow === '/cluster' &&
              backFromCluster &&
              backFromCluster !== '/cluster' &&
              backFromCluster !== '/'
            ) {
              lastNonClusterPathRef.current = null
              navigate(backFromCluster, { replace: true })
              break
            }

            if (attentionSwitchedByRef.current) {
              autoSwitchedRef.current = false
              lastNonCarplayPathRef.current = null
              break
            }

            if (autoSwitchedRef.current && lastNonCarplayPathRef.current) {
              navigate(lastNonCarplayPathRef.current, { replace: true })
            }
            autoSwitchedRef.current = false
            lastNonCarplayPathRef.current = null
            break
          }
          break
        }

        case 'plugged': {
          const phoneType = (d as { phoneType?: number }).phoneType
          const useAa =
            phoneType !== undefined
              ? phoneType === PhoneType.AndroidAuto
              : wirelessAaEnabledRef.current
          if (isProjectionPhoneType(phoneType)) setDonglePhoneLinked(true)
          if (useAa) {
            setProjectionSessionActive(true)
            setAaActive(true)
          } else {
            setDongleConnected(true)
          }
          break
        }

        case 'projectionActive': {
          setProjectionSessionActive(true)
          refreshTransportPhoneState()
          break
        }

        case 'unplugged': {
          setProjectionSessionActive(false)
          setDonglePhoneLinked(false)
          setStreaming(false)
          setAaActive(false)
          setDongleConnected(false)
          setReceivingVideo(false)
          pendingVideoFocusRef.current = false
          setNavVideoOverlayActive(false)
          break
        }

        case 'failure': {
          setProjectionSessionActive(false)
          setDonglePhoneLinked(false)
          setStreaming(false)
          setAaActive(false)
          setDongleConnected(false)
          setReceivingVideo(false)
          pendingVideoFocusRef.current = false
          setNavVideoOverlayActive(false)
          break
        }
      }
    }

    const unsubscribe = window.projection.ipc.onEvent(handler)
    return unsubscribe
  }, [
    gotoHostUI,
    setReceivingVideo,
    navigate,
    setStreaming,
    setDongleConnected,
    setNavVideoOverlayActive,
    applyAttention,
    setAudioInfo,
    setBluetoothPairedList,
    bumpAudioDevicesRevision,
    applyTransportPhoneState,
    refreshTransportPhoneState,
    settings.dashboards
  ])

  // Resize observer => inform render worker
  useEffect(() => {
    if (!carplayWorker || !mainElem.current) return
    const obs = new ResizeObserver(() => carplayWorker.postMessage({ type: 'frame' }))
    obs.observe(mainElem.current)
    return () => obs.disconnect()
  }, [carplayWorker])

  // Key commands. Fire only when the counter actually advances
  const lastSentCommandCounterRef = useRef(0)
  useEffect(() => {
    if (!commandCounter) return
    if (commandCounter === lastSentCommandCounterRef.current) return
    lastSentCommandCounterRef.current = commandCounter
    window.projection.ipc.sendCommand(command)
  }, [command, commandCounter])

  // Cleanup
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
        retryTimeoutRef.current = null
      }

      if (statusNoticeTimerRef.current != null) {
        window.clearTimeout(statusNoticeTimerRef.current)
        statusNoticeTimerRef.current = null
      }

      carplayWorker.terminate()
    }
  }, [carplayWorker])

  // Force-hide video when not streaming
  useEffect(() => {
    if (!isStreaming) setReceivingVideo(false)
  }, [isStreaming, setReceivingVideo])

  // Clear any lingering disconnect notice once video is back.
  useEffect(() => {
    if (isStreaming) clearStatusNotice()
  }, [isStreaming, clearStatusNotice])

  /* ------------------------------- UI binding ------------------------------ */

  const inProjection = pathname === '/'
  const showProjectionOverlay = inProjection || navVideoOverlayActive
  const videoVisible = receivingVideo
  const phoneLinked = donglePhoneLinked || transportPhoneLinked
  const showWaitingProjectionPane = !videoVisible
  const waitingVideoStarting = isStreaming || (projectionSessionActive && phoneLinked)

  const resolvedNegotiatedWidth = negotiatedWidth ?? 0
  const resolvedNegotiatedHeight = negotiatedHeight ?? 0

  // The phone renders a user-chosen AR inside the transport tier
  const aaContent =
    resolvedNegotiatedWidth > 0 &&
    resolvedNegotiatedHeight > 0 &&
    settings.projectionWidth > 0 &&
    settings.projectionHeight > 0
      ? aaContentArea(
          { width: resolvedNegotiatedWidth, height: resolvedNegotiatedHeight },
          { width: settings.projectionWidth, height: settings.projectionHeight }
        )
      : null

  const visibleWidth = aaContent?.contentWidth ?? resolvedNegotiatedWidth
  const visibleHeight = aaContent?.contentHeight ?? resolvedNegotiatedHeight
  const blurBackdropActive = settings.backdropEnabled === true && settings.backdropMode === 'blur'
  const fillEnabled = motoFillEnabled(settings)
  const maskColor =
    settings.backdropEnabled === true && !blurBackdropActive
      ? (backdropSampleColor ?? motoFillHex(settings))
      : motoFillHex(settings)
  const roundedCornerMask = settings.roundedCornerMaskEnabled === true && !blurBackdropActive
  // "Extend background" mode: CarPlay paints its wallpaper into the whole display
  // (view area = full stream, drawOutside on). The margin is live phone video, so
  // the passepartout bars must NOT cover it — only the sensor overlay sits on top.
  const extendBackground = settings.projectionSafeAreaDrawOutside === true
  // Stable identity so the memoized ViewAreaMask doesn't rebuild on every
  // backdrop color sample (frame rate in "average" mode).
  const viewAreaInsets = useMemo(
    () => ({
      top: settings.projectionViewAreaTop ?? 0,
      bottom: settings.projectionViewAreaBottom ?? 0,
      left: settings.projectionViewAreaLeft ?? 0,
      right: settings.projectionViewAreaRight ?? 0
    }),
    [
      settings.projectionViewAreaTop,
      settings.projectionViewAreaBottom,
      settings.projectionViewAreaLeft,
      settings.projectionViewAreaRight
    ]
  )

  const touchHandlers = useProjectionMultiTouch(
    videoContainerRef,
    resolvedNegotiatedWidth > 0 && resolvedNegotiatedHeight > 0
      ? {
          streamWidth: resolvedNegotiatedWidth,
          streamHeight: resolvedNegotiatedHeight,
          cropLeft: Math.max(0, (resolvedNegotiatedWidth - visibleWidth) / 2),
          cropTop: Math.max(0, (resolvedNegotiatedHeight - visibleHeight) / 2),
          visibleWidth,
          visibleHeight
        }
      : undefined
  )

  return (
    <div
      id="projection-root"
      ref={mainElem}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        touchAction: 'none',
        visibility: showProjectionOverlay ? 'visible' : 'hidden',
        opacity: showProjectionOverlay ? 1 : 0,
        transition: 'opacity 120ms ease',
        pointerEvents: inProjection ? 'auto' : 'none',
        zIndex: showProjectionOverlay ? 999 : -1
      }}
    >
      {pathname === '/' && (
        <WaitingProjectionPane
          settings={settings}
          show={showWaitingProjectionPane}
          adapterFound={isDongleConnected}
          phoneLinked={phoneLinked}
          videoStarting={waitingVideoStarting}
          statusNotice={statusNotice}
          onOpenSettings={gotoHostUI}
        />
      )}

      <div
        id="videoContainer"
        ref={videoContainerRef}
        {...touchHandlers}
        style={{
          height: '100%',
          width: '100%',
          padding: 0,
          margin: 0,
          display: 'block',
          touchAction: 'none',
          backgroundColor: receivingVideo ? 'transparent' : theme.palette.background.default,
          visibility: receivingVideo ? 'visible' : 'hidden',
          zIndex: receivingVideo ? 1 : -1,
          position: 'relative',
          overflow: 'hidden'
        }}
      />

      <ViewAreaMask
        visible={showProjectionOverlay && (receivingVideo || fillEnabled)}
        displayWidth={settings.projectionWidth}
        displayHeight={settings.projectionHeight}
        insets={viewAreaInsets}
        color={maskColor}
        cornerMask={roundedCornerMask && !extendBackground}
        barsVisible={!blurBackdropActive && !extendBackground}
      />

      <ProjectionSensorOverlay />
    </div>
  )
}

export const Projection = React.memo(CarplayComponent)
