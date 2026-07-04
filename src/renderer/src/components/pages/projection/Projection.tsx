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

const describeWaitingPower = (power: PowerStatus | null | undefined): WaitingPowerInfo => {
  if (!power) return null
  const volts =
    power.inputVolts != null
      ? `${power.inputVolts.toFixed(2)}V`
      : power.coreVolts != null
        ? `${power.coreVolts.toFixed(2)}V`
        : null
  if (power.underVoltageNow) {
    return { text: `LOW POWER${volts ? ` ${volts}` : ''}`, tone: '#ef5350' }
  }
  if (power.throttledNow) {
    return { text: `THROTTLED${volts ? ` ${volts}` : ''}`, tone: '#ef5350' }
  }
  if (power.underVoltageOccurred || power.throttledOccurred) {
    return { text: `POWER DIP SEEN${volts ? ` ${volts}` : ''}`, tone: '#ffca28' }
  }
  return { text: `POWER OK${volts ? ` ${volts}` : ''}`, tone: '#66bb6a' }
}

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
  const [confirmReboot, setConfirmReboot] = useState(false)
  const [researching, setResearching] = useState(false)

  useEffect(() => {
    const isJsdom =
      typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('jsdom')
    if (!show || isJsdom) return
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [show])

  useEffect(() => {
    const isJsdom =
      typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('jsdom')
    if (!show || isJsdom || typeof window.app?.systemStats !== 'function') return
    let alive = true
    const read = async () => {
      try {
        const stats = await window.app.systemStats()
        if (alive) setPower(describeWaitingPower(stats?.power))
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
        window.setTimeout(() => setResearching(false), 1500)
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
  const dateLabel = now
    .toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric'
    })
    .toUpperCase()
  const status = !adapterFound
    ? {
        accentTone: '#ef5350',
        adapterTone: '#ef5350',
        phoneTone: '#ef5350',
        adapter: 'Adapter missing',
        phone: 'iPhone search paused',
        phoneActive: false
      }
    : videoStarting || phoneLinked
      ? {
          accentTone: '#66bb6a',
          adapterTone: '#66bb6a',
          phoneTone: '#66bb6a',
          adapter: 'Adapter found',
          phone: 'iPhone linked',
          phoneActive: true
        }
      : {
          accentTone: '#4fc3f7',
          adapterTone: '#66bb6a',
          phoneTone: '#4fc3f7',
          adapter: 'Adapter found',
          phone: 'Searching for iPhone',
          phoneActive: true
        }
  const pill = (label: string, active: boolean, tone: string, testId: string) => (
    <div
      data-testid={testId}
      data-tone={tone}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        minHeight: 34,
        padding: '0 14px',
        borderRadius: 999,
        border: `1px solid ${active ? `${tone}66` : 'rgba(255,255,255,0.16)'}`,
        background: active ? `${tone}18` : 'rgba(255,255,255,0.06)',
        color: active ? '#f8fafc' : 'rgba(255,255,255,0.62)',
        fontSize: 12,
        fontWeight: 800,
        fontFamily: 'monospace',
        letterSpacing: 1,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap'
      }}
    >
      <span
        data-testid={`${testId}-dot`}
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: active ? tone : 'rgba(255,255,255,0.28)',
          boxShadow: active ? `0 0 12px ${tone}aa` : undefined,
          flex: '0 0 auto'
        }}
      />
      {label}
    </div>
  )

  return (
    <div
      data-testid="projection-waiting-pane"
      style={{
        position: 'absolute',
        left: frame.left,
        top: frame.top,
        width: frame.width,
        height: frame.height,
        backgroundColor: '#02050a',
        border: '1px solid rgba(255,255,255,0.16)',
        borderRadius: 34,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 2,
        color: '#f8fafc',
        fontFamily: 'sans-serif'
      }}
    >
      <button
        type="button"
        aria-label="Open settings"
        data-testid="projection-waiting-settings-button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          onOpenSettings()
        }}
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          width: 54,
          height: 54,
          borderRadius: 12,
          border: '1px solid rgba(255,255,255,0.18)',
          background: 'rgba(255,255,255,0.075)',
          color: '#f8fafc',
          display: 'grid',
          placeItems: 'center',
          padding: 0,
          cursor: 'pointer',
          pointerEvents: 'auto',
          touchAction: 'manipulation',
          WebkitTapHighlightColor: 'transparent',
          zIndex: 8
        }}
      >
        <SettingsOutlinedIcon style={{ fontSize: 31 }} />
      </button>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at 50% 12%, rgba(79,195,247,0.18), transparent 46%), linear-gradient(180deg, #07111f 0%, #02050a 62%, #000 100%)'
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: '9%',
          right: '9%',
          top: '9%',
          bottom: '9%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center'
        }}
      >
        <div
          data-testid="projection-waiting-date"
          style={{
            color: 'rgba(255,255,255,0.58)',
            fontSize: 15,
            fontWeight: 800,
            fontFamily: 'monospace',
            letterSpacing: 3,
            marginBottom: 10
          }}
        >
          {dateLabel}
        </div>
        <div
          data-testid="projection-waiting-clock"
          style={{
            color: '#fff',
            fontSize: 118,
            fontWeight: 900,
            lineHeight: 0.92,
            letterSpacing: 0,
            fontVariantNumeric: 'tabular-nums',
            textShadow: '0 6px 34px rgba(0,0,0,0.72)'
          }}
        >
          {clock}
        </div>
        <div
          style={{
            width: 88,
            height: 4,
            borderRadius: 2,
            background: status.accentTone,
            boxShadow: `0 0 18px ${status.accentTone}99`,
            margin: '24px 0'
          }}
        />
        <div
          data-testid="projection-waiting-status-pills"
          style={{
            display: 'flex',
            justifyContent: 'center',
            flexWrap: 'wrap',
            gap: 10,
            maxWidth: '100%'
          }}
        >
          {pill(
            status.adapter,
            adapterFound,
            status.adapterTone,
            'projection-waiting-adapter-pill'
          )}
          {pill(
            status.phone,
            status.phoneActive,
            status.phoneTone,
            'projection-waiting-phone-pill'
          )}
        </div>
        {statusNotice && (
          <div
            role="status"
            data-testid="projection-waiting-status-notice"
            data-tone={statusNotice.tone}
            style={{
              marginTop: 20,
              maxWidth: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              padding: '10px 16px',
              borderRadius: 12,
              border: `1px solid ${statusNotice.tone}66`,
              background: `${statusNotice.tone}1f`,
              animation: 'livi-status-notice-in 220ms ease-out'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: statusNotice.tone,
                fontSize: 13,
                fontWeight: 900,
                fontFamily: 'monospace',
                letterSpacing: 1.5,
                textTransform: 'uppercase'
              }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  background: statusNotice.tone,
                  boxShadow: `0 0 12px ${statusNotice.tone}aa`,
                  flex: '0 0 auto'
                }}
              />
              {statusNotice.title}
            </div>
            <div
              style={{
                color: 'rgba(255,255,255,0.78)',
                fontSize: 11.5,
                fontWeight: 700,
                fontFamily: 'monospace',
                letterSpacing: 0.5,
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
        {(videoStarting || phoneLinked) && (
          <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <ConnectingDots tone={status.accentTone} />
            <div
              style={{
                color: 'rgba(255,255,255,0.7)',
                fontSize: 12,
                fontWeight: 800,
                fontFamily: 'monospace',
                letterSpacing: 2,
                textTransform: 'uppercase'
              }}
            >
              Starting CarPlay
            </div>
          </div>
        )}
        {power && (
          <div
            data-testid="projection-waiting-power"
            style={{
              marginTop: 18,
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              color: power.tone,
              fontSize: 12,
              fontWeight: 800,
              fontFamily: 'monospace',
              letterSpacing: 1.5
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: power.tone,
                boxShadow: `0 0 10px ${power.tone}aa`
              }}
            />
            {power.text}
          </div>
        )}
      </div>
      <div
        data-testid="projection-waiting-actions"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: '8%',
          display: 'flex',
          justifyContent: 'center',
          gap: 12,
          pointerEvents: 'auto',
          zIndex: 8
        }}
      >
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
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            height: 48,
            padding: '0 18px',
            borderRadius: 10,
            border: '1px solid rgba(79,195,247,0.4)',
            background: 'rgba(79,195,247,0.12)',
            color: researching ? 'rgba(255,255,255,0.5)' : '#bfe7fb',
            fontSize: 13,
            fontWeight: 800,
            fontFamily: 'monospace',
            letterSpacing: 1,
            textTransform: 'uppercase',
            cursor: researching ? 'default' : 'pointer',
            touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent'
          }}
        >
          <RefreshOutlinedIcon
            style={{
              fontSize: 22,
              animation: researching ? 'livi-research-spin 1s linear infinite' : undefined
            }}
          />
          {researching ? 'Searching' : 'Re-search'}
        </button>
        <button
          type="button"
          aria-label="Reboot Pi"
          data-testid="projection-waiting-reboot-button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            setConfirmReboot(true)
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            height: 48,
            padding: '0 18px',
            borderRadius: 10,
            border: '1px solid rgba(255,133,133,0.4)',
            background: 'rgba(255,85,85,0.12)',
            color: '#ff9d9d',
            fontSize: 13,
            fontWeight: 800,
            fontFamily: 'monospace',
            letterSpacing: 1,
            textTransform: 'uppercase',
            cursor: 'pointer',
            touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent'
          }}
        >
          <PowerSettingsNewOutlinedIcon style={{ fontSize: 22 }} />
          Reboot
        </button>
        <style>
          {`@keyframes livi-research-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}
        </style>
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
            background: 'rgba(0,0,0,0.9)',
            display: 'grid',
            placeItems: 'center',
            padding: 24,
            pointerEvents: 'auto'
          }}
        >
          <div
            style={{
              width: 'min(360px, 100%)',
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.14)',
              background: '#101316',
              padding: 24,
              textAlign: 'center'
            }}
          >
            <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.05 }}>Reboot Pi?</div>
            <div style={{ marginTop: 8, color: 'rgba(255,255,255,0.62)', fontSize: 14 }}>
              The display will go dark while the Pi restarts.
            </div>
            <div
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 22 }}
            >
              <button
                type="button"
                onClick={() => setConfirmReboot(false)}
                style={{
                  minHeight: 52,
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'transparent',
                  color: '#f8fafc',
                  fontWeight: 900,
                  fontSize: 15,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmReboot(false)
                  handleReboot()
                }}
                style={{
                  minHeight: 52,
                  borderRadius: 10,
                  border: '1px solid rgba(255,202,40,0.5)',
                  background: 'transparent',
                  color: '#ffca28',
                  fontWeight: 900,
                  fontSize: 15,
                  cursor: 'pointer'
                }}
              >
                Reboot
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
  const [rendererError] = useState<string | null>(null)
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

  // Visual delay for FFT so spectrum matches audio playback
  const fftVisualDelayMs = 0

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
  useFftPcm(fftVisualDelayMs)

  // Audio + touch hooks

  const clearRetryTimeout = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }
  }, [])

  const gotoHostUI = useCallback(() => {
    if (location.pathname !== HOST_UI_ROUTE) {
      navigate(HOST_UI_ROUTE, { replace: true })
    }
  }, [location.pathname, navigate])

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
      const inProjection = location.pathname === '/'

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
        attentionBackPathRef.current = location.pathname
        attentionSwitchedByRef.current = p.kind

        navigate('/', { replace: true })
        return
      }

      // INACTIVE: only return if we previously switched because of this kind
      if (attentionSwitchedByRef.current !== p.kind) return

      const back = attentionBackPathRef.current

      const doReturn = () => {
        attentionSwitchedByRef.current = null
        if (back && back !== '/' && location.pathname === '/') {
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
    [location.pathname, navigate, clearVoiceAssistantReleaseTimer]
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

        case 'dongleInfo': {
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
  }, [
    carplayWorker,
    clearRetryTimeout,
    gotoHostUI,
    setDeviceInfo,
    setAudioInfo,
    setPcmData,
    setReceivingVideo
  ])

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
      window.electron?.ipcRenderer.removeListener('usb-event', usbHandler)
    }
  }, [
    setReceivingVideo,
    setDongleConnected,
    setStreaming,
    clearRetryTimeout,
    navigate,
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

            if (!rendererError) {
              setReceivingVideo(true)
              setStreaming(true)
            }

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

            if (!isStreaming) {
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
            phoneType !== undefined ? phoneType === PhoneType.AndroidAuto : wirelessAaEnabled
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
    isStreaming,
    setDongleConnected,
    setNavVideoOverlayActive,
    applyAttention,
    rendererError,
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
  const videoVisible = receivingVideo && !rendererError
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
          backgroundColor:
            receivingVideo && !rendererError ? 'transparent' : theme.palette.background.default,
          visibility: receivingVideo && !rendererError ? 'visible' : 'hidden',
          zIndex: receivingVideo && !rendererError ? 1 : -1,
          position: 'relative',
          overflow: 'hidden'
        }}
      />

      <ViewAreaMask
        visible={showProjectionOverlay && ((receivingVideo && !rendererError) || fillEnabled)}
        displayWidth={settings.projectionWidth}
        displayHeight={settings.projectionHeight}
        insets={{
          top: settings.projectionViewAreaTop ?? 0,
          bottom: settings.projectionViewAreaBottom ?? 0,
          left: settings.projectionViewAreaLeft ?? 0,
          right: settings.projectionViewAreaRight ?? 0
        }}
        color={maskColor}
        cornerMask={roundedCornerMask}
        barsVisible={!blurBackdropActive}
      />

      <ProjectionSensorOverlay />
    </div>
  )
}

export const Projection = React.memo(CarplayComponent)
