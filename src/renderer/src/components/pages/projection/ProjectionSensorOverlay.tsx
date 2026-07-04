import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import type { Config, TelemetryPayload } from '@shared/types'
import { motoFillHex } from '@shared/utils'
import { useLiviStore } from '@store/store'
import * as React from 'react'
import { useLocation, useNavigate } from 'react-router'
import { MOTO_CLEAR_GRAPH_HISTORY_EVENT } from './motoGraphEvents'
import {
  MOTO_ARC_PCT,
  MOTO_ARC_STRIP_SIZE,
  MOTO_CENTER_SQUARE_SIZE,
  MOTO_SQUARE_PCT
} from './motoLayout'

type MetricKey =
  | 'speed'
  | 'heading'
  | 'ambientTemp'
  | 'chtLeft'
  | 'chtRight'
  | 'altitude'
  | 'gForce'
  | 'leanAngle'
  | 'pitchAngle'
  | 'piTemp'

type DataPoint = {
  ts: number
  val: number
}

type GpsSat = {
  prn: number
  el: number | null
  az: number | null
  snr: number | null
  used: boolean
}

type GpsSky = {
  fixType: 0 | 2 | 3
  satsUsed: number
  satsInView: number
  hdop: number | null
  pdop: number | null
  lat: number | null
  lon: number | null
  sats: GpsSat[]
  ttff: number | null
  acquiring: number | null
}

type MotoTelemetry = {
  speedMph: number | null
  headingDeg: number | null
  altitudeFt: number | null
  gpsFix: boolean | null
  gpsSatellites: number
  gpsSky: GpsSky | null
  ambientF: number | null
  chtLeftC: number | null
  chtRightC: number | null
  leanDeg: number | null
  pitchDeg: number | null
  gForceX: number | null
  gForceY: number | null
  piCpuC: number | null
  imuRecalibrating: boolean
  imuPeak: { leanL: number; leanR: number; g: number }
  chtPeak: { left: number; right: number }
  // Dropout handling: hold the last good reading + whether the sensor is
  // currently responding, so a gauge can show the stale value with a
  // blinking "not responding" hint instead of going blank.
  chtLeftLastC: number | null
  chtRightLastC: number | null
  chtLeftResponding: boolean
  chtRightResponding: boolean
  // GPS dropout handling: hold the last good speed/heading/altitude and a
  // "responding" flag, so the cluster slowly blinks the last reading on a
  // lost fix / lost satellites instead of dashing it out.
  speedMphLast: number | null
  headingDegLast: number | null
  altitudeFtLast: number | null
  gpsResponding: boolean
}

type MotoActions = {
  openMetric: (key: MetricKey) => void
  closeMetric: () => void
  clearMetric: (key: MetricKey) => void
  resetImuPeak: () => void
  resetChtPeak: () => void
}

type MotoSettings = Pick<
  Config,
  | 'backdropEnabled'
  | 'backdropMode'
  | 'ambientFillEnabled'
  | 'ambientFillColor'
  | 'projectionSafeAreaDrawOutside'
  | 'leanOffset'
  | 'pitchOffset'
  | 'reverseTilt'
  | 'reversePitch'
  | 'diagnosticMode'
>

type MetricZone = {
  max: number
  color: string
  label?: string
}

type MetricConfig = {
  label: string
  unit: string
  color: string
  minRange: number
  fmtVal: (v: number) => string
  zones?: MetricZone[]
}

const SQUARE_PCT = MOTO_SQUARE_PCT
const ARC_PCT = MOTO_ARC_PCT
const GRAPH_WINDOW_MS = 5 * 60 * 1000
const GRAPH_MAX_AGE_MS = 8 * 60 * 60 * 1000
const GRAPH_SAMPLE_MS = 1000
// Diagnostic Mode: how often to persist a snapshot, and how many raw telemetry
// payloads to retain between flushes (bounded so the buffer can't grow forever).
const DIAG_FLUSH_MS = 30 * 1000
const DIAG_RAW_BUFFER_MAX = 2000
// CHT emits every ~2s; if no good reading arrives within this window the
// sensor service is treated as not responding (held value shown, blinking).
const CHT_STALE_MS = 7000

// If no GPS fix update arrives within this window (e.g. the gps service died or
// the antenna dropped link entirely), treat GPS as not responding so the held
// speed/heading/altitude slowly blink instead of freezing as if still live.
const GPS_STALE_MS = 5000

// When "Extend CarPlay Background" is on, the edge gauges float over live
// CarPlay wallpaper. Each numeric readout sits inside a uniform pill (an
// Apple-style capsule): one fill, one border, fully rounded, identical height
// and padding everywhere so every gauge reads as part of one instrument set.
const SCRIM_FILL = 'rgba(22,24,28,0.55)'
const SCRIM_STROKE = 'rgba(255,255,255,0.12)'
// Shared pill metrics (SVG user units, which equal on-screen px in the arcs).
const PILL_H = 34
// A soft shadow makes numerals readable even where a pill does not fully cover.
const NUM_SHADOW = '0 1px 3px rgba(0,0,0,0.85)'
const SVG_TEXT_SHADOW = 'drop-shadow(0 1px 2px rgba(0,0,0,0.85))'

// A uniform rounded capsule used behind every extend-mode gauge readout.
function GaugePill({
  cx,
  cy,
  width,
  height = PILL_H,
  'data-testid': testId
}: {
  cx: number
  cy: number
  width: number
  height?: number
  'data-testid'?: string
}) {
  return (
    <rect
      data-testid={testId}
      x={cx - width / 2}
      y={cy - height / 2}
      width={width}
      height={height}
      rx={height / 2}
      fill={SCRIM_FILL}
      stroke={SCRIM_STROKE}
      strokeWidth={1}
    />
  )
}

// CHT color thresholds (°C): blue < 80 (cold), green 80–140 (normal),
// yellow 140–150 (warm), red > 150 (hot).
const CHT_ZONES: MetricZone[] = [
  { max: 80, color: '#4fc3f7' },
  { max: 140, color: '#66bb6a' },
  { max: 150, color: '#ffca28', label: 'WARM' },
  { max: Infinity, color: '#ef5350', label: 'HOT' }
]

// The zone boundaries, for drawing threshold divider lines on the L/R gauges.
const CHT_THRESHOLDS = [80, 140, 150]

const METRIC_CONFIG: Record<MetricKey, MetricConfig> = {
  speed: {
    label: 'SPEED',
    unit: 'mph',
    color: '#4fc3f7',
    minRange: 20,
    fmtVal: (v) => String(Math.round(v))
  },
  heading: {
    label: 'HEADING',
    unit: '\u00b0',
    color: '#81c784',
    minRange: 45,
    fmtVal: (v) => String(Math.round(v))
  },
  ambientTemp: {
    label: 'AMBIENT',
    unit: '\u00b0F',
    color: '#fff176',
    minRange: 10,
    fmtVal: (v) => String(Math.round(v))
  },
  chtLeft: {
    label: 'CHT LEFT',
    unit: '\u00b0C',
    color: '#ff8a65',
    minRange: 30,
    fmtVal: (v) => String(Math.round(v)),
    zones: CHT_ZONES
  },
  chtRight: {
    label: 'CHT RIGHT',
    unit: '\u00b0C',
    color: '#ff5252',
    minRange: 30,
    fmtVal: (v) => String(Math.round(v)),
    zones: CHT_ZONES
  },
  altitude: {
    label: 'ALTITUDE',
    unit: 'ft',
    color: '#ce93d8',
    minRange: 100,
    fmtVal: (v) => Math.round(v).toLocaleString()
  },
  gForce: {
    label: 'G-FORCE',
    unit: 'G',
    color: '#ffca28',
    minRange: 0.5,
    fmtVal: (v) => v.toFixed(2)
  },
  leanAngle: {
    label: 'LEAN',
    unit: '\u00b0',
    color: '#ffd700',
    minRange: 30,
    fmtVal: (v) => String(Math.round(v))
  },
  pitchAngle: {
    label: 'PITCH',
    unit: '\u00b0',
    color: '#80cbc4',
    minRange: 20,
    fmtVal: (v) => String(Math.round(v))
  },
  piTemp: {
    label: 'PI CPU',
    unit: '\u00b0C',
    color: '#4dd0e1',
    minRange: 15,
    fmtVal: (v) => String(Math.round(v)),
    zones: [
      { max: 70, color: '#43d17a' },
      { max: 80, color: '#ffb300', label: 'WARM' },
      { max: Infinity, color: '#ff5252', label: 'THROTTLE' }
    ]
  }
}

const GPS_KEYS: MetricKey[] = ['speed', 'heading', 'altitude']
const IMU_KEYS: MetricKey[] = ['leanAngle', 'pitchAngle', 'gForce']
const CHT_KEYS: MetricKey[] = ['chtLeft', 'chtRight']

function emptyLog(): Record<MetricKey, DataPoint[]> {
  return {
    speed: [],
    heading: [],
    ambientTemp: [],
    chtLeft: [],
    chtRight: [],
    altitude: [],
    gForce: [],
    leanAngle: [],
    pitchAngle: [],
    piTemp: []
  }
}

function initialTelemetry(): MotoTelemetry {
  return {
    speedMph: null,
    headingDeg: null,
    altitudeFt: null,
    gpsFix: null,
    gpsSatellites: 0,
    gpsSky: null,
    ambientF: null,
    chtLeftC: null,
    chtRightC: null,
    leanDeg: null,
    pitchDeg: null,
    gForceX: null,
    gForceY: null,
    piCpuC: null,
    imuRecalibrating: false,
    imuPeak: { leanL: 0, leanR: 0, g: 0 },
    chtPeak: { left: 0, right: 0 },
    chtLeftLastC: null,
    chtRightLastC: null,
    chtLeftResponding: true,
    chtRightResponding: true,
    speedMphLast: null,
    headingDegLast: null,
    altitudeFtLast: null,
    gpsResponding: true
  }
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function finiteOrNull(value: unknown): number | null | undefined {
  if (value === null) return null
  return finiteNumber(value)
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step
}

function cToF(c: number): number {
  return Math.round((c * 9) / 5 + 32)
}

function mToFt(m: number): number {
  return Math.round(m * 3.28084)
}

function fmtSecs(s: number): string {
  const t = Math.round(s)
  if (t < 60) return `${t}s`
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

function useSvgId(prefix: string): string {
  return `${prefix}-${React.useId().replace(/:/g, '')}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function normalizeGpsSky(value: unknown): GpsSky | null {
  const src = asRecord(value)
  if (!src) return null

  const satsRaw = Array.isArray(src.sats) ? src.sats : []
  const sats: GpsSat[] = satsRaw.map((sat) => {
    const s = asRecord(sat) ?? {}
    return {
      prn: finiteNumber(s.prn) ?? 0,
      el: finiteOrNull(s.el) ?? null,
      az: finiteOrNull(s.az) ?? null,
      snr: finiteOrNull(s.snr) ?? null,
      used: s.used === true
    }
  })

  return {
    fixType: src.fixType === 2 || src.fixType === 3 ? src.fixType : 0,
    satsUsed: finiteNumber(src.satsUsed) ?? 0,
    satsInView: finiteNumber(src.satsInView) ?? sats.length,
    hdop: finiteOrNull(src.hdop) ?? null,
    pdop: finiteOrNull(src.pdop) ?? null,
    lat: finiteOrNull(src.lat) ?? null,
    lon: finiteOrNull(src.lon) ?? null,
    sats,
    ttff: finiteOrNull(src.ttff) ?? null,
    acquiring: finiteOrNull(src.acquiring) ?? null
  }
}

function readSensors(payload: unknown): Partial<MotoTelemetry> | null {
  const msg = asRecord(payload)
  if (!msg) return null

  const patch: Partial<MotoTelemetry> = {}
  const gps = asRecord(msg.gps)

  const speedKph = finiteNumber(msg.speedKph)
  if (speedKph !== undefined) patch.speedMph = Math.max(0, Math.round(speedKph * 0.621371))

  const heading = finiteNumber(gps?.heading)
  if (heading !== undefined) patch.headingDeg = Math.round(((heading % 360) + 360) % 360)

  const altitudeM = finiteNumber(gps?.alt)
  if (altitudeM !== undefined) patch.altitudeFt = mToFt(altitudeM)

  if (typeof msg.gpsFix === 'boolean') patch.gpsFix = msg.gpsFix

  const sats =
    finiteNumber(msg.gpsSatellites) ??
    finiteNumber(gps?.satellites) ??
    finiteNumber(asRecord(msg.gpsSky)?.satsUsed)
  if (sats !== undefined) patch.gpsSatellites = Math.max(0, Math.round(sats))

  if ('gpsSky' in msg) patch.gpsSky = normalizeGpsSky(msg.gpsSky)

  const ambientC = finiteNumber(msg.ambientC)
  if (ambientC !== undefined) patch.ambientF = cToF(ambientC)

  const piCpuC = finiteNumber(msg.piCpuC)
  if (piCpuC !== undefined) patch.piCpuC = Math.round(piCpuC)

  const chtLeft = finiteOrNull(msg.chtLeftC)
  if (chtLeft !== undefined) patch.chtLeftC = chtLeft === null ? null : roundTo(chtLeft, 1)

  const chtRight = finiteOrNull(msg.chtRightC)
  if (chtRight !== undefined) patch.chtRightC = chtRight === null ? null : roundTo(chtRight, 1)

  const lean = finiteNumber(msg.leanDeg)
  if (lean !== undefined) patch.leanDeg = roundTo(lean, 0.5)

  const pitch = finiteNumber(msg.pitchDeg)
  if (pitch !== undefined) patch.pitchDeg = roundTo(pitch, 0.5)

  const gForceX = finiteNumber(msg.gForceX)
  if (gForceX !== undefined) patch.gForceX = roundTo(gForceX, 0.01)

  const gForceY = finiteNumber(msg.gForceY)
  if (gForceY !== undefined) patch.gForceY = roundTo(gForceY, 0.01)

  if (typeof msg.imuRecalibrating === 'boolean') patch.imuRecalibrating = msg.imuRecalibrating

  return Object.keys(patch).length > 0 ? patch : null
}

function changed<T extends Record<string, unknown>>(prev: T, next: T): boolean {
  return Object.keys(next).some((key) => !Object.is(prev[key], next[key]))
}

function toCardinal(deg: number): string {
  const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return cardinals[Math.round(deg / 45) % 8]
}

function tempColor(temp: number | null): string {
  if (temp == null) return '#333'
  if (temp < 80) return '#4fc3f7'
  if (temp < 140) return '#66bb6a'
  if (temp <= 150) return '#ffca28'
  return '#ef5350'
}

function chtZone(temp: number): { label: string; color: string } {
  if (temp < 80) return { label: 'COLD', color: '#4fc3f7' }
  if (temp < 140) return { label: 'NORMAL', color: '#66bb6a' }
  if (temp <= 150) return { label: 'WARM', color: '#ffca28' }
  return { label: 'HOT', color: '#ef5350' }
}

function leanColor(absLean: number): string {
  if (absLean < 15) return '#66bb6a'
  if (absLean < 30) return '#9ccc65'
  if (absLean < 40) return '#ffca28'
  return '#ef5350'
}

function gColor(g: number): string {
  if (g < 0.5) return '#66bb6a'
  if (g < 1.0) return '#ffca28'
  return '#ef5350'
}

type StableValueState = {
  shown: number | null
  pending: { value: number; since: number } | null
}

type SpeedState = {
  shown: number | null
  moving: boolean
  aboveSince: number | null
}

function stableValue(
  raw: number | null,
  state: StableValueState,
  step: number,
  holdMs: number,
  now: number
): number | null {
  if (raw == null) {
    state.shown = null
    state.pending = null
    return null
  }

  if (state.shown == null) {
    state.shown = raw
    state.pending = null
    return state.shown
  }

  if (Math.abs(raw - state.shown) <= step) {
    state.shown = raw
    state.pending = null
    return state.shown
  }

  if (!state.pending || Math.abs(raw - state.pending.value) > step) {
    state.pending = { value: raw, since: now }
  }

  if (now - state.pending.since >= holdMs) {
    state.shown = raw
    state.pending = null
  }

  return state.shown
}

function stableSpeed(rawMph: number | null, state: SpeedState, now: number): number | null {
  const rise = 4
  const fall = 2
  const holdMs = 1800

  if (rawMph == null) {
    state.shown = null
    state.moving = false
    state.aboveSince = null
    return null
  }

  if (!state.moving) {
    if (rawMph >= rise) {
      state.aboveSince ??= now
      if (now - state.aboveSince >= holdMs) {
        state.moving = true
        state.aboveSince = null
        state.shown = Math.round(rawMph)
        return state.shown
      }
    } else {
      state.aboveSince = null
    }
    state.shown = 0
    return state.shown
  }

  if (rawMph < fall) {
    state.moving = false
    state.aboveSince = null
    state.shown = 0
    return state.shown
  }

  state.shown = Math.round(rawMph)
  return state.shown
}

function useMotoTelemetry(settings: MotoSettings | null): {
  telemetry: MotoTelemetry
  activeGraph: MetricKey | null
  dataRef: React.MutableRefObject<Record<MetricKey, DataPoint[]>>
  actions: MotoActions
} {
  const [telemetry, setTelemetry] = React.useState<MotoTelemetry>(() => initialTelemetry())
  const [activeGraph, setActiveGraph] = React.useState<MetricKey | null>(null)
  const [, setHistoryRevision] = React.useState(0)
  const dataRef = React.useRef<Record<MetricKey, DataPoint[]>>(emptyLog())
  const lastSampleRef = React.useRef<Partial<Record<MetricKey, number>>>({})
  const settingsRef = React.useRef(settings)
  const stableRef = React.useRef({
    speed: { shown: null, moving: false, aboveSince: null } as SpeedState,
    ambient: { shown: null, pending: null } as StableValueState,
    chtLeft: { shown: null, pending: null } as StableValueState,
    chtRight: { shown: null, pending: null } as StableValueState
  })
  // CHT dropout tracking: remember the last good (non-null) reading and the
  // last time a real number arrived, so the gauge can show the held value
  // with a "not responding" hint when a fault clears the value (explicit
  // null) or the sensor service dies entirely (no events → staleness).
  const chtTrackRef = React.useRef({
    left: { lastGood: null as number | null, lastGoodTs: 0 },
    right: { lastGood: null as number | null, lastGoodTs: 0 }
  })
  // GPS dropout tracking: remember the last good speed/heading/altitude (taken
  // while we had a fix) and the last time a fix arrived. On a lost fix / lost
  // satellites the cluster slowly blinks the held values instead of blanking.
  const gpsTrackRef = React.useRef({
    speed: null as number | null,
    heading: null as number | null,
    altitude: null as number | null,
    lastFixTs: 0,
    lastSig: ''
  })
  // Diagnostic Mode: rolling buffer of the most recent raw telemetry payloads,
  // only populated while diagnosticMode is on (see the flush effect below).
  const rawBufRef = React.useRef<unknown[]>([])
  // Mirror of the latest telemetry so the diagnostic flush can read current
  // sensor state without resubscribing the interval on every update.
  const telemetryRef = React.useRef<MotoTelemetry>(telemetry)
  React.useEffect(() => {
    telemetryRef.current = telemetry
  }, [telemetry])

  React.useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  const addPoint = React.useCallback((key: MetricKey, val: number, now = Date.now()) => {
    if (!Number.isFinite(val)) return
    const last = lastSampleRef.current[key] ?? 0
    if (now - last < GRAPH_SAMPLE_MS) return
    const cutoff = now - GRAPH_MAX_AGE_MS
    const series = dataRef.current[key]
    let stale = 0
    while (stale < series.length && series[stale].ts <= cutoff) stale += 1
    if (stale > 0) series.splice(0, stale)
    series.push({ ts: now, val })
    lastSampleRef.current[key] = now
  }, [])

  const logFromState = React.useCallback(
    (next: MotoTelemetry, patch: Partial<MotoTelemetry>, now: number) => {
      const leanOffset = settingsRef.current?.leanOffset ?? 0
      const pitchOffset = settingsRef.current?.pitchOffset ?? 0

      if (patch.speedMph !== undefined && next.speedMph != null && next.gpsFix === true)
        addPoint('speed', next.speedMph, now)
      if (patch.headingDeg !== undefined && next.headingDeg != null && next.gpsFix === true)
        addPoint('heading', next.headingDeg, now)
      if (patch.altitudeFt !== undefined && next.altitudeFt != null)
        addPoint('altitude', next.altitudeFt, now)
      if (patch.ambientF !== undefined && next.ambientF != null)
        addPoint('ambientTemp', next.ambientF, now)
      if (patch.piCpuC !== undefined && next.piCpuC != null) addPoint('piTemp', next.piCpuC, now)
      if (patch.chtLeftC !== undefined && next.chtLeftC != null)
        addPoint('chtLeft', next.chtLeftC, now)
      if (patch.chtRightC !== undefined && next.chtRightC != null)
        addPoint('chtRight', next.chtRightC, now)
      if (patch.leanDeg !== undefined && next.leanDeg != null)
        addPoint('leanAngle', next.leanDeg - leanOffset, now)
      if (patch.pitchDeg !== undefined && next.pitchDeg != null)
        addPoint('pitchAngle', next.pitchDeg - pitchOffset, now)
      if (
        (patch.gForceX !== undefined || patch.gForceY !== undefined) &&
        next.gForceX != null &&
        next.gForceY != null
      ) {
        addPoint('gForce', Math.sqrt(next.gForceX ** 2 + next.gForceY ** 2), now)
      }
    },
    [addPoint]
  )

  React.useEffect(() => {
    const clearAll = () => {
      dataRef.current = emptyLog()
      lastSampleRef.current = {}
      setHistoryRevision((v) => v + 1)
    }
    window.addEventListener(MOTO_CLEAR_GRAPH_HISTORY_EVENT, clearAll)
    return () => window.removeEventListener(MOTO_CLEAR_GRAPH_HISTORY_EVENT, clearAll)
  }, [])

  // Diagnostic Mode: persist a snapshot (graph history + sensor diagnostics +
  // recent raw telemetry) to disk every DIAG_FLUSH_MS and once on unmount/close.
  // Entirely gated on the setting — when off, no interval, no listener, no push.
  React.useEffect(() => {
    if (!settings?.diagnosticMode) return
    const isJsdom =
      typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('jsdom')
    if (isJsdom) return

    const flush = () => {
      const send = window.projection?.ipc?.sendDiagnosticSnapshot
      if (typeof send !== 'function') return
      const graphs: Record<string, DataPoint[]> = {}
      for (const [key, series] of Object.entries(dataRef.current)) {
        if (series.length > 0) graphs[key] = series
      }
      const t = telemetryRef.current
      const sensors = {
        imuRecalibrating: t.imuRecalibrating,
        imuPeak: t.imuPeak,
        chtPeak: t.chtPeak,
        chtLeftResponding: t.chtLeftResponding,
        chtRightResponding: t.chtRightResponding,
        gpsResponding: t.gpsResponding,
        gpsSatellites: t.gpsSatellites
      }
      const rawTelemetry = rawBufRef.current.slice()
      rawBufRef.current = []
      try {
        send({ ts: Date.now(), graphs, sensors, rawTelemetry })
      } catch (e) {
        console.warn('[diagnostics] flush failed (ignored)', e)
      }
    }

    const id = window.setInterval(flush, DIAG_FLUSH_MS)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('beforeunload', flush)
      flush() // final snapshot when the setting turns off or the view unmounts
    }
  }, [settings?.diagnosticMode])

  React.useEffect(() => {
    let disposed = false

    const apply = (payload: unknown) => {
      const patch = readSensors(payload)
      if (!patch || disposed) return
      const now = Date.now()

      // Diagnostic Mode: keep a bounded rolling buffer of raw payloads. Bounded
      // so the buffer can't grow without limit between 30s flushes.
      if (settingsRef.current?.diagnosticMode) {
        const buf = rawBufRef.current
        buf.push({ ts: now, payload })
        if (buf.length > DIAG_RAW_BUFFER_MAX) buf.splice(0, buf.length - DIAG_RAW_BUFFER_MAX)
      } else if (rawBufRef.current.length > 0) {
        rawBufRef.current = []
      }

      setTelemetry((prev) => {
        const next: MotoTelemetry = { ...prev, ...patch }
        const stable = stableRef.current

        // Reverse-tilt: invert lean angle (and lateral G) so a physical
        // left lean reads as left. Reverse-pitch independently inverts pitch
        // (and longitudinal G) for a flipped fore/aft mount. Applied once here
        // so every downstream consumer (gauges, peaks, graphs, calibration
        // offsets) stays consistent. Only flip freshly-arrived patch values.
        if (settingsRef.current?.reverseTilt) {
          if (patch.leanDeg != null) next.leanDeg = -patch.leanDeg
          if (patch.gForceX != null) next.gForceX = -patch.gForceX
        }
        if (settingsRef.current?.reversePitch) {
          if (patch.pitchDeg != null) next.pitchDeg = -patch.pitchDeg
          if (patch.gForceY != null) next.gForceY = -patch.gForceY
        }

        if (patch.speedMph !== undefined || patch.gpsFix !== undefined) {
          next.speedMph = stableSpeed(
            next.gpsFix === true ? next.speedMph : null,
            stable.speed,
            now
          )
        }
        if (patch.ambientF !== undefined) {
          next.ambientF = stableValue(patch.ambientF, stable.ambient, 3, 3000, now)
        }
        if (patch.chtLeftC !== undefined) {
          next.chtLeftC = stableValue(patch.chtLeftC, stable.chtLeft, 3, 3000, now)
          const track = chtTrackRef.current.left
          if (next.chtLeftC != null) {
            track.lastGood = next.chtLeftC
            track.lastGoodTs = now
          }
          next.chtLeftLastC = next.chtLeftC ?? track.lastGood
          next.chtLeftResponding = next.chtLeftC != null
        }
        if (patch.chtRightC !== undefined) {
          next.chtRightC = stableValue(patch.chtRightC, stable.chtRight, 3, 3000, now)
          const track = chtTrackRef.current.right
          if (next.chtRightC != null) {
            track.lastGood = next.chtRightC
            track.lastGoodTs = now
          }
          next.chtRightLastC = next.chtRightC ?? track.lastGood
          next.chtRightResponding = next.chtRightC != null
        }

        // GPS dropout: while we have a fix, remember the latest good
        // speed/heading/altitude. On a lost fix keep the held values and mark
        // GPS as not responding so the cluster slowly blinks them.
        {
          const track = gpsTrackRef.current
          const hasFix = next.gpsFix === true
          // The app relays telemetry continuously even after the gps sensor
          // stops emitting (the last payload is held), so gpsFix alone can stay
          // stale-true. Only treat the fix as "fresh" when a GPS field actually
          // changes; otherwise let it age out into the stale (blinking) state.
          const sig = `${next.speedMph ?? ''}|${next.headingDeg ?? ''}|${next.altitudeFt ?? ''}|${next.gpsSatellites ?? ''}|${String(next.gpsFix)}`
          const gpsChanged = sig !== track.lastSig
          track.lastSig = sig
          if (hasFix && gpsChanged) {
            track.lastFixTs = now
            if (next.speedMph != null) track.speed = next.speedMph
            if (next.headingDeg != null) track.heading = next.headingDeg
            if (next.altitudeFt != null) track.altitude = next.altitudeFt
          }
          const fresh = track.lastFixTs > 0 && now - track.lastFixTs <= GPS_STALE_MS
          const gpsLive = hasFix && fresh
          next.speedMphLast = gpsLive && next.speedMph != null ? next.speedMph : track.speed
          next.headingDegLast = gpsLive && next.headingDeg != null ? next.headingDeg : track.heading
          next.altitudeFtLast =
            gpsLive && next.altitudeFt != null ? next.altitudeFt : track.altitude
          next.gpsResponding = gpsLive
        }

        if (next.leanDeg != null) {
          const leanOffset = settingsRef.current?.leanOffset ?? 0
          const lean = next.leanDeg - leanOffset
          next.imuPeak = {
            ...next.imuPeak,
            leanR: Math.max(next.imuPeak.leanR, lean),
            leanL: Math.max(next.imuPeak.leanL, -lean)
          }
        }
        if (next.gForceX != null && next.gForceY != null) {
          const g = Math.sqrt(next.gForceX ** 2 + next.gForceY ** 2)
          next.imuPeak = { ...next.imuPeak, g: Math.max(next.imuPeak.g, g) }
        }
        if (next.chtLeftC != null) {
          next.chtPeak = { ...next.chtPeak, left: Math.max(next.chtPeak.left, next.chtLeftC) }
        }
        if (next.chtRightC != null) {
          next.chtPeak = { ...next.chtPeak, right: Math.max(next.chtPeak.right, next.chtRightC) }
        }

        logFromState(next, patch, now)
        return changed(
          prev as unknown as Record<string, unknown>,
          next as unknown as Record<string, unknown>
        )
          ? next
          : prev
      })
    }

    const snapPromise = window.projection?.ipc?.getTelemetrySnapshot?.()
    if (snapPromise) {
      void snapPromise.then((snap) => {
        if (!disposed) apply(snap)
      })
    }

    window.projection?.ipc?.onTelemetry?.(apply)
    return () => {
      disposed = true
      window.projection?.ipc?.offTelemetry?.(apply)
    }
  }, [logFromState])

  // Detect a CHT service that stops emitting entirely (process died / link
  // dropped): the value never goes null, so flag "not responding" once the
  // last good reading is older than CHT_STALE_MS while still showing it.
  React.useEffect(() => {
    const isJsdom =
      typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('jsdom')
    if (isJsdom) return
    const id = window.setInterval(() => {
      const now = Date.now()
      setTelemetry((prev) => {
        const track = chtTrackRef.current
        const leftStale = track.left.lastGoodTs > 0 && now - track.left.lastGoodTs > CHT_STALE_MS
        const rightStale = track.right.lastGoodTs > 0 && now - track.right.lastGoodTs > CHT_STALE_MS
        const nextLeftResponding = !leftStale && prev.chtLeftResponding
        const nextRightResponding = !rightStale && prev.chtRightResponding
        const gpsTrack = gpsTrackRef.current
        const gpsStale = gpsTrack.lastFixTs > 0 && now - gpsTrack.lastFixTs > GPS_STALE_MS
        const nextGpsResponding = !gpsStale && prev.gpsResponding
        if (
          (leftStale && prev.chtLeftResponding) ||
          (rightStale && prev.chtRightResponding) ||
          (gpsStale && prev.gpsResponding)
        ) {
          return {
            ...prev,
            chtLeftResponding: nextLeftResponding,
            chtRightResponding: nextRightResponding,
            gpsResponding: nextGpsResponding
          }
        }
        return prev
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  const actions = React.useMemo<MotoActions>(
    () => ({
      openMetric: (key) => setActiveGraph((cur) => (cur === key ? null : key)),
      closeMetric: () => setActiveGraph(null),
      clearMetric: (key) => {
        dataRef.current = { ...dataRef.current, [key]: [] }
        lastSampleRef.current[key] = 0
        setHistoryRevision((v) => v + 1)
      },
      resetImuPeak: () =>
        setTelemetry((prev) => ({ ...prev, imuPeak: { leanL: 0, leanR: 0, g: 0 } })),
      resetChtPeak: () => setTelemetry((prev) => ({ ...prev, chtPeak: { left: 0, right: 0 } }))
    }),
    []
  )

  return { telemetry, activeGraph, dataRef, actions }
}

function TopArc({
  telemetry,
  actions,
  background,
  extend
}: {
  telemetry: MotoTelemetry
  actions: MotoActions
  background: string
  extend: boolean
}) {
  const hasFix = telemetry.gpsFix === true
  // GPS is "live" only when we currently have a fix and the sensor is still
  // emitting. When the fix drops OR the sensor stops responding entirely, keep
  // showing the last good value but slowly blinking (gpsStale) rather than
  // dashing it out.
  const gpsLive = hasFix && telemetry.gpsResponding
  const speed = gpsLive ? telemetry.speedMph : telemetry.speedMphLast
  const heading = gpsLive ? telemetry.headingDeg : telemetry.headingDegLast
  const gpsStale = !gpsLive && (telemetry.speedMphLast != null || telemetry.headingDegLast != null)
  const cardinal = heading != null ? toCardinal(heading) : null
  const gpsLabel =
    telemetry.gpsFix == null
      ? 'NO GPS'
      : `ACQUIRING${telemetry.gpsSatellites > 0 ? ` \u00b7 ${telemetry.gpsSatellites} SAT` : ''}`
  const gpsDotColor = telemetry.gpsFix == null ? '#777' : '#ffb300'

  const bandBase: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    bottom: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-end',
    boxSizing: 'border-box',
    cursor: 'pointer',
    userSelect: 'none'
  }
  // Extend mode: each readout sits in its own rounded capsule (pill) so the
  // gauge set reads uniformly over the CarPlay wallpaper. No gradient band.
  const containerBg = extend ? 'transparent' : background
  const numShadow = extend ? NUM_SHADOW : undefined
  const pill: React.CSSProperties = extend
    ? {
        background: SCRIM_FILL,
        border: `1px solid ${SCRIM_STROKE}`,
        borderRadius: 999,
        padding: '4px 14px'
      }
    : {}

  return (
    <div
      style={{ position: 'relative', width: '100%', height: '100%', background: containerBg }}
      data-testid="projection-top-arc"
    >
      {telemetry.gpsFix !== true && (
        <button
          type="button"
          onClick={() => actions.openMetric('speed')}
          style={{
            position: 'absolute',
            top: 5,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            zIndex: 2,
            border: 0,
            background: 'transparent',
            padding: 0
          }}
        >
          <span
            data-testid="projection-gps-status-dot"
            className={telemetry.gpsFix === false ? 'moto-gps-acquiring-dot' : undefined}
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: gpsDotColor,
              boxShadow: `0 0 6px ${gpsDotColor}88`
            }}
          />
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: 1.5,
              color: '#bbb',
              fontFamily: 'monospace'
            }}
          >
            {gpsLabel}
          </span>
        </button>
      )}

      <button
        type="button"
        onClick={() => actions.openMetric('heading')}
        style={{
          ...bandBase,
          left: 70,
          width: '24%',
          paddingBottom: 16,
          border: 0,
          background: 'transparent'
        }}
      >
        <span
          className={gpsStale && heading != null ? 'moto-gps-stale' : undefined}
          style={{
            ...pill,
            display: 'flex',
            alignItems: 'baseline',
            gap: 6,
            textShadow: numShadow
          }}
        >
          <span style={{ fontSize: 34, fontWeight: 800, color: 'white', lineHeight: 1 }}>
            {cardinal ?? '--'}
          </span>
          <span style={{ fontSize: 18, fontWeight: 800, color: 'rgba(255,255,255,0.78)' }}>
            {heading != null ? `${heading}\u00b0` : ''}
          </span>
        </span>
      </button>

      <button
        type="button"
        aria-label="GPS speed"
        onClick={() => actions.openMetric('speed')}
        style={{
          ...bandBase,
          left: '30%',
          right: '30%',
          paddingBottom: 12,
          border: 0,
          background: 'transparent'
        }}
      >
        <span
          className={gpsStale && speed != null ? 'moto-gps-stale' : undefined}
          style={{
            ...pill,
            padding: extend ? '2px 18px' : 0,
            display: 'flex',
            alignItems: 'baseline',
            gap: extend ? 8 : 4,
            textShadow: numShadow
          }}
        >
          <span
            style={{
              fontSize: extend ? 64 : 90,
              fontWeight: 800,
              color: 'white',
              lineHeight: 1,
              letterSpacing: 0,
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {speed != null ? speed : '--'}
          </span>
          <span
            style={{
              fontSize: extend ? 16 : 13,
              fontWeight: 800,
              color: extend ? 'rgba(255,255,255,0.78)' : 'white',
              letterSpacing: extend ? 2 : 3,
              textTransform: 'uppercase'
            }}
          >
            mph
          </span>
        </span>
      </button>

      <button
        type="button"
        onClick={() => actions.openMetric('ambientTemp')}
        style={{
          ...bandBase,
          right: 70,
          width: '24%',
          paddingBottom: 16,
          border: 0,
          background: 'transparent'
        }}
      >
        <span
          style={{
            ...pill,
            display: 'flex',
            alignItems: 'baseline',
            gap: 6,
            textShadow: numShadow
          }}
        >
          <span style={{ fontSize: 34, fontWeight: 800, color: 'white', lineHeight: 1 }}>
            {telemetry.ambientF != null ? `${telemetry.ambientF}\u00b0` : '--'}
          </span>
          <span style={{ fontSize: 18, fontWeight: 800, color: 'rgba(255,255,255,0.78)' }}>
            {telemetry.ambientF != null ? 'F' : ''}
          </span>
        </span>
      </button>
    </div>
  )
}

function ChtGauge({
  side,
  value,
  lastValue,
  responding,
  actions,
  background,
  extend
}: {
  side: 'L' | 'R'
  value: number | null
  lastValue?: number | null
  responding?: boolean
  actions: MotoActions
  background: string
  extend: boolean
}) {
  const maxTemp = 200
  const barW = 72
  const vw = MOTO_ARC_STRIP_SIZE
  const barH = 268
  const barY = 159
  const vh = MOTO_CENTER_SQUARE_SIZE
  const metricKey = side === 'L' ? 'chtLeft' : 'chtRight'
  const isResponding = responding !== false
  // When the sensor stops responding, keep showing the last good reading
  // (dimmed) with a blinking "NO RESP" hint instead of going blank.
  const heldValue = value ?? lastValue ?? null
  const displayValue = isResponding ? value : heldValue
  const hasData = displayValue !== null
  const showStale = !isResponding && hasData
  const clamped = Math.max(0, Math.min(maxTemp, displayValue ?? 0))
  const fill = (clamped / maxTemp) * barH
  const liveColor = tempColor(clamped)
  const color = !hasData ? '#333' : showStale ? '#8a6d3b' : liveColor
  const barInset = 29
  const barX = side === 'L' ? barInset : vw - barW - barInset
  const textCX = barX + barW / 2
  // Extend mode: transparent strip; only the temperature number sits in a pill
  // whose width matches the thermometer bar, centered on the bar (mirror-safe).
  const numPillCY = barY + barH + 25
  const numPillW = barW + 12

  return (
    <button
      type="button"
      aria-label={`${side} cylinder head temperature`}
      data-responding={isResponding ? 'true' : 'false'}
      onClick={() => actions.openMetric(metricKey)}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        border: 0,
        padding: 0,
        background: extend ? 'transparent' : background
      }}
    >
      <svg
        viewBox={`0 0 ${vw} ${vh}`}
        width="100%"
        height="100%"
        style={{ display: 'block' }}
        preserveAspectRatio="xMidYMid meet"
      >
        <rect x={barX} y={barY} width={barW} height={barH} fill="#141414" rx={6} />
        {hasData && fill > 0 && (
          <rect
            x={barX}
            y={barY + barH - fill}
            width={barW}
            height={fill}
            fill={color}
            rx={6}
            opacity={showStale ? 0.55 : 1}
          />
        )}
        {CHT_THRESHOLDS.map((t) => {
          const y = barY + barH - (t / maxTemp) * barH
          return (
            <line
              key={t}
              x1={barX}
              y1={y}
              x2={barX + barW}
              y2={y}
              stroke={tempColor(t + 0.1)}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              opacity={0.7}
            />
          )
        })}
        {extend && (
          <GaugePill
            data-testid={`projection-cht-pill-${side}`}
            cx={textCX}
            cy={numPillCY}
            width={numPillW}
          />
        )}
        <text
          x={textCX}
          y={numPillCY + 10}
          textAnchor="middle"
          fill={!hasData ? 'white' : showStale ? '#c9a227' : color}
          fontSize={28}
          fontWeight="bold"
          fontFamily="sans-serif"
          opacity={showStale ? 0.85 : 1}
          style={extend ? { filter: SVG_TEXT_SHADOW } : undefined}
        >
          {hasData ? Math.round(displayValue as number) : '--'}
          {extend && (
            <tspan fontSize={14} fill="rgba(255,255,255,0.7)" dx={3}>
              C
            </tspan>
          )}
        </text>
        {showStale ? (
          <text
            x={textCX}
            y={barY + barH + 54}
            textAnchor="middle"
            fill="#ffca28"
            fontSize={12}
            fontWeight="bold"
            fontFamily="sans-serif"
            letterSpacing={0.5}
          >
            NO RESP
            <animate
              attributeName="opacity"
              values="1;0.15;1"
              dur="1.1s"
              repeatCount="indefinite"
            />
          </text>
        ) : (
          !extend && (
            <text
              x={textCX}
              y={barY + barH + 52}
              textAnchor="middle"
              fill="white"
              fontSize={12}
              fontWeight="bold"
              fontFamily="sans-serif"
            >
              C
            </text>
          )
        )}
      </svg>
    </button>
  )
}

function BottomArc({
  telemetry,
  settings,
  actions,
  background,
  extend
}: {
  telemetry: MotoTelemetry
  settings: MotoSettings | null
  actions: MotoActions
  background: string
  extend: boolean
}) {
  const clipId = useSvgId('bottom-arc')
  const w = MOTO_CENTER_SQUARE_SIZE
  const h = MOTO_ARC_STRIP_SIZE
  const cx = w / 2
  const pitchScale = 2.5
  const refY = h / 2
  const ref = '#ffd700'
  const leanOffset = settings?.leanOffset ?? 0
  const pitchOffset = settings?.pitchOffset ?? 0
  const leanVal = telemetry.leanDeg != null ? telemetry.leanDeg - leanOffset : 0
  const pitchVal = telemetry.pitchDeg != null ? telemetry.pitchDeg - pitchOffset : 0
  const hasLean = telemetry.leanDeg != null
  const absLean = Math.abs(Math.round(leanVal))
  const side = leanVal > 0.5 ? 'R' : leanVal < -0.5 ? 'L' : ''
  const absPitch = Math.abs(Math.round(pitchVal))
  const pitchDir = pitchVal > 0.5 ? '\u25b2' : pitchVal < -0.5 ? '\u25bc' : ''
  const gpsLive = telemetry.gpsFix === true && telemetry.gpsResponding
  const gpsStale = !gpsLive && telemetry.altitudeFtLast != null
  const altValue = gpsLive ? telemetry.altitudeFt : telemetry.altitudeFtLast
  const altFt = altValue != null ? altValue.toLocaleString() : '--'
  const totalG =
    telemetry.gForceX != null && telemetry.gForceY != null
      ? Math.sqrt(telemetry.gForceX ** 2 + telemetry.gForceY ** 2)
      : null
  const hasG = totalG != null
  const gVal = totalG ?? 0
  const gTextColor = !hasG ? '#444' : gColor(gVal)
  const horizonY = refY + pitchVal * pitchScale
  const rot = `rotate(${leanVal}, ${cx}, ${horizonY})`
  const pitchLines = [-15, -10, -5, 5, 10, 15].map((p) => ({
    y: horizonY - p * pitchScale,
    len: Math.abs(p) % 10 === 0 ? 120 : 70,
    label: Math.abs(p) % 10 === 0 ? Math.abs(p) : null
  }))
  // Extend mode: every readout is a uniform capsule on shared baselines.
  // ALT (left) and G (right) mirror each other on the same top row; lean sits
  // in a matching capsule centered under the horizon. Same height + radius.
  // Extend mode: readouts are uniform two-line capsules (label+unit line over a
  // big value) placed in the widest part of the bottom band so nothing is
  // clipped by the round display. ALT (left) and G (right) mirror exactly.
  const rowCY = 26 // vertical center of the ALT / G row
  const rowH = 42 // capsule height
  const rowW = 122 // capsule width
  const altCX = 152 // ALT capsule center (left)
  const gCX = w - altCX // G capsule center (right) — exact mirror of ALT
  const leanW = 104
  const leanCY = 86

  return (
    <div
      style={{ width: '100%', height: '100%', background: extend ? 'transparent' : background }}
      data-testid="projection-bottom-arc"
    >
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height="100%"
        style={{ display: 'block', filter: extend ? SVG_TEXT_SHADOW : undefined }}
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={0} y={0} width={w} height={h} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <g transform={rot}>
            <rect x={-w} y={-3 * h} width={3 * w} height={3 * h + horizonY} fill="transparent" />
            <rect
              x={-w}
              y={horizonY}
              width={3 * w}
              height={3 * h}
              fill={extend ? 'rgba(92,52,18,0.55)' : '#5c3412'}
            />
            <line
              x1={-w}
              y1={horizonY}
              x2={3 * w}
              y2={horizonY}
              stroke="white"
              strokeWidth={2}
              opacity={0.85}
            />
            {pitchLines.map(({ y, len, label }) => (
              <g key={y}>
                <line
                  x1={cx - len / 2}
                  y1={y}
                  x2={cx + len / 2}
                  y2={y}
                  stroke="white"
                  strokeWidth={1}
                  opacity={0.5}
                />
                {label && (
                  <>
                    <text
                      x={cx - len / 2 - 5}
                      y={y + 3.5}
                      textAnchor="end"
                      fill="white"
                      fontSize={8}
                      fontFamily="sans-serif"
                      opacity={0.55}
                    >
                      {label}
                    </text>
                    <text
                      x={cx + len / 2 + 5}
                      y={y + 3.5}
                      textAnchor="start"
                      fill="white"
                      fontSize={8}
                      fontFamily="sans-serif"
                      opacity={0.55}
                    >
                      {label}
                    </text>
                  </>
                )}
              </g>
            ))}
          </g>
        </g>
        <line
          x1={cx - 72}
          y1={refY}
          x2={cx - 12}
          y2={refY}
          stroke={ref}
          strokeWidth={3.5}
          strokeLinecap="round"
        />
        <line
          x1={cx - 72}
          y1={refY}
          x2={cx - 72}
          y2={refY + 9}
          stroke={ref}
          strokeWidth={3.5}
          strokeLinecap="round"
        />
        <line
          x1={cx + 12}
          y1={refY}
          x2={cx + 72}
          y2={refY}
          stroke={ref}
          strokeWidth={3.5}
          strokeLinecap="round"
        />
        <line
          x1={cx + 72}
          y1={refY}
          x2={cx + 72}
          y2={refY + 9}
          stroke={ref}
          strokeWidth={3.5}
          strokeLinecap="round"
        />
        {extend ? (
          <GaugePill cx={cx} cy={18} width={64} height={26} />
        ) : (
          <rect x={cx - 27} y={34} width={54} height={24} fill="rgba(0,0,0,0.88)" rx={8} />
        )}
        <text
          x={cx}
          y={extend ? 23 : 52}
          textAnchor="middle"
          fill={telemetry.pitchDeg != null ? ref : 'white'}
          fontSize={extend ? 16 : 18}
          fontWeight="bold"
          fontFamily="monospace"
        >
          {telemetry.pitchDeg != null
            ? absPitch === 0
              ? '\u2014'
              : `${pitchDir}${absPitch}\u00b0`
            : '--'}
        </text>
        {!extend && <rect x={0} y={60} width={w} height={h - 60} fill="rgba(0,0,0,0.25)" />}

        <g>
          {extend ? (
            <>
              <GaugePill cx={altCX} cy={rowCY} width={rowW} height={rowH} />
              <text
                x={altCX}
                y={rowCY - 8}
                textAnchor="middle"
                fill="rgba(255,255,255,0.75)"
                fontSize={13}
                fontWeight="bold"
                fontFamily="monospace"
                letterSpacing={2}
              >
                ALT
              </text>
              <text
                x={altCX}
                y={rowCY + 14}
                textAnchor="middle"
                fill={altValue != null ? '#f0f0f0' : 'white'}
                fontSize={22}
                fontWeight="bold"
                fontFamily="monospace"
              >
                {altFt}
                <tspan fontSize={13} fill="rgba(255,255,255,0.7)" dx={4}>
                  FT
                </tspan>
                {gpsStale && (
                  <animate
                    attributeName="opacity"
                    values="1;0.25;1"
                    dur="2.4s"
                    repeatCount="indefinite"
                  />
                )}
              </text>
            </>
          ) : (
            <>
              <rect x={110} y={5} width={88} height={53} fill="rgba(0,0,0,0.72)" rx={5} />
              <text
                x={154}
                y={20}
                textAnchor="middle"
                fill="rgba(255,255,255,0.7)"
                fontSize={12}
                fontWeight="bold"
                fontFamily="monospace"
                letterSpacing={2}
              >
                ALT
              </text>
              <text
                x={154}
                y={43}
                textAnchor="middle"
                fill={altValue != null ? '#e0e0e0' : 'white'}
                fontSize={22}
                fontWeight="bold"
                fontFamily="monospace"
              >
                {altFt}
                {gpsStale && (
                  <animate
                    attributeName="opacity"
                    values="1;0.25;1"
                    dur="2.4s"
                    repeatCount="indefinite"
                  />
                )}
              </text>
              <text
                x={154}
                y={54}
                textAnchor="middle"
                fill="rgba(255,255,255,0.7)"
                fontSize={11}
                fontWeight="bold"
                fontFamily="sans-serif"
              >
                ft
              </text>
            </>
          )}
        </g>

        <g>
          {extend ? (
            <GaugePill cx={cx} cy={leanCY} width={leanW} height={34} />
          ) : (
            <rect
              x={cx - 40}
              y={68}
              width={80}
              height={32}
              fill="rgba(0,0,0,0.88)"
              stroke="rgba(255,255,255,0.07)"
              strokeWidth={0.75}
              rx={12}
            />
          )}
          <text
            x={cx}
            y={extend ? leanCY + 7 : 90}
            textAnchor="middle"
            fill="white"
            fontSize={extend ? 21 : 21}
            fontWeight="bold"
            fontFamily="sans-serif"
          >
            {hasLean ? (absLean > 0 ? `${absLean}\u00b0 ${side}` : `0\u00b0`) : '--'}
          </text>
          {telemetry.imuRecalibrating && (
            <text
              x={cx}
              y={extend ? leanCY + 24 : 112}
              textAnchor="middle"
              fill="#ffca28"
              fontSize={11}
              fontWeight="bold"
              fontFamily="monospace"
              letterSpacing={1}
            >
              CALIBRATING
              <animate
                attributeName="opacity"
                values="1;0.2;1"
                dur="1.1s"
                repeatCount="indefinite"
              />
            </text>
          )}
        </g>

        <g>
          {extend ? (
            <>
              <GaugePill cx={gCX} cy={rowCY} width={rowW} height={rowH} />
              <text
                x={gCX}
                y={rowCY - 8}
                textAnchor="middle"
                fontSize={13}
                fontWeight="bold"
                fontFamily="monospace"
                letterSpacing={2}
              >
                <tspan fill="rgba(255,255,255,0.75)">G</tspan>
                {hasG && telemetry.imuPeak.g > 0.05 && (
                  <tspan fill="rgba(255,170,0,0.92)" dx={8} letterSpacing={0}>
                    {`\u25b2${telemetry.imuPeak.g.toFixed(1)}`}
                  </tspan>
                )}
              </text>
              <text
                x={gCX}
                y={rowCY + 14}
                textAnchor="middle"
                fill={hasG ? gTextColor : 'white'}
                fontSize={22}
                fontWeight="bold"
                fontFamily="monospace"
              >
                {hasG ? gVal.toFixed(1) : '--'}
              </text>
            </>
          ) : (
            <>
              <text
                x={428}
                y={11}
                textAnchor="middle"
                fill="rgba(255,255,255,0.75)"
                fontSize={12}
                fontWeight="bold"
                fontFamily="monospace"
                letterSpacing={2}
              >
                G
              </text>
              <rect x={398} y={14} width={60} height={34} fill="rgba(0,0,0,0.72)" rx={5} />
              <text
                x={428}
                y={40}
                textAnchor="middle"
                fill={hasG ? gTextColor : 'white'}
                fontSize={30}
                fontWeight="bold"
                fontFamily="monospace"
              >
                {hasG ? gVal.toFixed(1) : '--'}
              </text>
              {hasG && telemetry.imuPeak.g > 0.05 && (
                <g>
                  <text
                    x={488}
                    y={11}
                    textAnchor="middle"
                    fill="rgba(255,170,0,0.85)"
                    fontSize={11}
                    fontWeight="bold"
                    fontFamily="monospace"
                    letterSpacing={1}
                  >
                    MAX
                  </text>
                  <rect x={464} y={14} width={48} height={23} fill="rgba(0,0,0,0.65)" rx={5} />
                  <text
                    x={488}
                    y={30}
                    textAnchor="middle"
                    fill="rgba(255,170,0,0.92)"
                    fontSize={18}
                    fontWeight="bold"
                    fontFamily="monospace"
                  >
                    {telemetry.imuPeak.g.toFixed(1)}
                  </text>
                </g>
              )}
            </>
          )}
        </g>

        <rect
          x={0}
          y={0}
          width={210}
          height={h}
          fill="transparent"
          style={{ cursor: 'pointer' }}
          onClick={() => actions.openMetric('altitude')}
        />
        <rect
          x={390}
          y={0}
          width={196}
          height={h}
          fill="transparent"
          style={{ cursor: 'pointer' }}
          onClick={() => actions.openMetric('gForce')}
        />
        <rect
          x={165}
          y={0}
          width={225}
          height={68}
          fill="transparent"
          style={{ cursor: 'pointer' }}
          onClick={() => actions.openMetric('pitchAngle')}
        />
        <rect
          x={165}
          y={68}
          width={225}
          height={h - 68}
          fill="transparent"
          style={{ cursor: 'pointer' }}
          onClick={() => actions.openMetric('leanAngle')}
        />
      </svg>
    </div>
  )
}

function GpsSkyPanel({ telemetry }: { telemetry: MotoTelemetry }) {
  const sky = telemetry.gpsSky
  const sweepId = useSvgId('gps-sweep')
  if (!sky) {
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <div style={{ textAlign: 'center', fontFamily: 'monospace' }}>
          <div style={{ color: '#888', fontSize: 14, fontWeight: 800, letterSpacing: 2 }}>
            {telemetry.gpsFix === null ? 'NO GPS RECEIVER' : 'WAITING FOR SATELLITES\u2026'}
          </div>
          <div style={{ color: '#555', fontSize: 11, marginTop: 6 }}>
            {telemetry.gpsFix === null
              ? 'check the USB GPS connection'
              : `${telemetry.gpsSatellites} sat${telemetry.gpsSatellites === 1 ? '' : 's'} so far`}
          </div>
        </div>
      </div>
    )
  }

  const snrColor = (snr: number | null): string => {
    if (snr === null || snr <= 0) return '#555'
    if (snr < 15) return '#ff7043'
    if (snr < 25) return '#ffca28'
    if (snr < 35) return '#9ccc65'
    return '#4caf50'
  }
  const hdopQuality = (hdop: number | null): { label: string; color: string } => {
    if (hdop === null) return { label: '-', color: '#888' }
    if (hdop < 1) return { label: 'EXCELLENT', color: '#4caf50' }
    if (hdop < 2) return { label: 'GOOD', color: '#9ccc65' }
    if (hdop < 5) return { label: 'MODERATE', color: '#ffca28' }
    if (hdop < 10) return { label: 'FAIR', color: '#ff7043' }
    return { label: 'POOR', color: '#ef5350' }
  }
  const badge =
    sky.fixType === 3
      ? { label: '3D FIX', color: '#4caf50' }
      : sky.fixType === 2
        ? { label: '2D FIX', color: '#ffca28' }
        : { label: 'NO FIX', color: '#ef5350' }
  const q = hdopQuality(sky.hdop)
  const noFix = sky.fixType === 0
  const plotR = 92
  const cx = 100
  const cy = 100
  const ring = (el: number) => ((90 - el) / 90) * plotR
  const satXY = (el: number, az: number): { x: number; y: number } => {
    const r = ((90 - el) / 90) * plotR
    const a = (az * Math.PI) / 180
    return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) }
  }
  const plotted = sky.sats.filter((s) => s.el !== null && s.az !== null)
  const ordered = [...sky.sats].sort((a, b) => (b.snr ?? 0) - (a.snr ?? 0)).slice(0, 12)
  const yForSnr = (snr: number) => 64 - (Math.min(snr, 50) / 50) * 64

  const stat = (label: string, value: string, color = 'white') => (
    <div
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}
    >
      <span style={{ color: '#dcdcdc', fontSize: 14, fontWeight: 800, letterSpacing: 0.5 }}>
        {label}
      </span>
      <span style={{ color, fontSize: 17, fontWeight: 900, fontFamily: 'monospace' }}>{value}</span>
    </div>
  )
  const ttffRow = noFix
    ? sky.acquiring != null
      ? stat('ACQUIRING', fmtSecs(sky.acquiring), '#ffca28')
      : null
    : sky.ttff != null
      ? stat('TTFF', fmtSecs(sky.ttff), '#4caf50')
      : null

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        gap: 8,
        padding: '8px 12px 6px 10px',
        fontFamily: 'sans-serif'
      }}
    >
      <div style={{ flex: '0 0 45%', minWidth: 0, display: 'flex', justifyContent: 'center' }}>
        <svg
          viewBox="0 0 200 212"
          style={{ height: '100%', display: 'block' }}
          preserveAspectRatio="xMidYMid meet"
        >
          {[0, 30, 60].map((el) => (
            <circle
              key={el}
              cx={cx}
              cy={cy}
              r={ring(el)}
              fill={el === 0 ? '#0c0c0c' : 'none'}
              stroke="rgba(255,255,255,0.13)"
              strokeWidth={el === 0 ? 1.2 : 0.8}
            />
          ))}
          <line
            x1={cx}
            y1={cy - plotR}
            x2={cx}
            y2={cy + plotR}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={0.8}
          />
          <line
            x1={cx - plotR}
            y1={cy}
            x2={cx + plotR}
            y2={cy}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={0.8}
          />
          {noFix && (
            <g>
              <defs>
                <linearGradient id={sweepId} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#4fc3f7" stopOpacity="0" />
                  <stop offset="100%" stopColor="#4fc3f7" stopOpacity="0.33" />
                </linearGradient>
              </defs>
              <path
                d={`M${cx},${cy} L${cx + plotR},${cy} A${plotR},${plotR} 0 0 0 ${cx + plotR * Math.cos(-0.5)},${cy + plotR * Math.sin(-0.5)} Z`}
                fill={`url(#${sweepId})`}
                data-testid="projection-gps-acquiring-sweep"
              >
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  from={`0 ${cx} ${cy}`}
                  to={`360 ${cx} ${cy}`}
                  dur="3s"
                  repeatCount="indefinite"
                />
              </path>
            </g>
          )}
          {[
            ['N', cx, 11],
            ['S', cx, 196],
            ['E', 192, cy + 3],
            ['W', 8, cy + 3]
          ].map(([t, x, y]) => (
            <text
              key={t as string}
              x={x as number}
              y={y as number}
              textAnchor="middle"
              fill="rgba(255,255,255,0.45)"
              fontSize={11}
              fontWeight="bold"
              fontFamily="monospace"
            >
              {t}
            </text>
          ))}
          {plotted.map((s) => {
            const { x, y } = satXY(s.el as number, s.az as number)
            const color = snrColor(s.snr)
            return (
              <g key={s.prn}>
                <circle
                  cx={x}
                  cy={y}
                  r={6}
                  fill={s.used ? color : '#161616'}
                  stroke={s.used ? 'rgba(255,255,255,0.85)' : color}
                  strokeWidth={s.used ? 1 : 1.5}
                />
                <text
                  x={x}
                  y={y + 15}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.65)"
                  fontSize={8}
                  fontWeight={600}
                  fontFamily="monospace"
                >
                  {s.prn}
                </text>
              </g>
            )
          })}
          {plotted.length === 0 && (
            <text
              x={cx}
              y={cy + 4}
              textAnchor="middle"
              fill="rgba(255,255,255,0.5)"
              fontSize={12}
              fontWeight={600}
              letterSpacing={1}
              fontFamily="monospace"
            >
              {'SEARCHING\u2026'}
            </text>
          )}
        </svg>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ height: 62, display: 'flex', alignItems: 'center', paddingRight: 64 }}>
          <span
            style={{
              display: 'inline-block',
              padding: '5px 14px',
              borderRadius: 9,
              background: `${badge.color}22`,
              border: `1.5px solid ${badge.color}`,
              color: badge.color,
              fontSize: 18,
              fontWeight: 900,
              letterSpacing: 1,
              fontFamily: 'monospace'
            }}
          >
            {badge.label}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {ttffRow}
          {stat('SATS', `${sky.satsUsed} used \u00b7 ${sky.satsInView} in view`)}
          {stat(
            'HDOP',
            sky.hdop !== null ? `${sky.hdop.toFixed(1)} ${q.label}` : '\u2014',
            q.color
          )}
          {stat(
            'POS',
            sky.lat !== null && sky.lon !== null
              ? `${sky.lat.toFixed(4)}, ${sky.lon.toFixed(4)}`
              : 'no fix',
            sky.lat !== null ? '#ddd' : '#777'
          )}
        </div>
        <div style={{ marginTop: 'auto' }}>
          <div
            style={{
              color: '#aaa',
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 2,
              fontFamily: 'monospace',
              marginBottom: 2
            }}
          >
            SIGNAL (dB-Hz)
          </div>
          {ordered.length > 0 && (
            <svg
              viewBox="0 0 280 78"
              style={{ width: '100%', display: 'block' }}
              preserveAspectRatio="xMidYMid meet"
            >
              {[20, 30, 40].map((db) => (
                <g key={db}>
                  <line
                    x1={0}
                    y1={yForSnr(db)}
                    x2={280}
                    y2={yForSnr(db)}
                    stroke="rgba(255,255,255,0.10)"
                    strokeWidth={0.75}
                    strokeDasharray="3 3"
                  />
                  <text
                    x={1}
                    y={yForSnr(db) - 1.5}
                    fill="rgba(255,255,255,0.5)"
                    fontSize={8}
                    fontWeight={600}
                    fontFamily="monospace"
                  >
                    {db}
                  </text>
                </g>
              ))}
              {ordered.map((s, i) => {
                const slot = 280 / ordered.length
                const bw = Math.min(18, slot - 4)
                const snr = s.snr ?? 0
                const height = Math.max(2, (Math.min(snr, 50) / 50) * 64)
                const x = i * slot + (slot - bw) / 2
                const color = snrColor(s.snr)
                return (
                  <g key={s.prn}>
                    <rect
                      x={x}
                      y={64 - height}
                      width={bw}
                      height={height}
                      rx={2}
                      fill={color}
                      opacity={s.used ? 1 : 0.4}
                    />
                    <text
                      x={x + bw / 2}
                      y={75}
                      textAnchor="middle"
                      fill="rgba(255,255,255,0.65)"
                      fontSize={9}
                      fontWeight={600}
                      fontFamily="monospace"
                    >
                      {s.prn}
                    </text>
                  </g>
                )
              })}
            </svg>
          )}
        </div>
      </div>
    </div>
  )
}

function RideDynamicsPanel({
  telemetry,
  settings,
  actions
}: {
  telemetry: MotoTelemetry
  settings: MotoSettings | null
  actions: MotoActions
}) {
  if (telemetry.leanDeg === null && telemetry.gForceX === null) {
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <div
          style={{
            color: '#888',
            fontSize: 14,
            fontWeight: 800,
            letterSpacing: 2,
            fontFamily: 'monospace'
          }}
        >
          NO IMU DATA
        </div>
      </div>
    )
  }

  const lean = telemetry.leanDeg != null ? telemetry.leanDeg - (settings?.leanOffset ?? 0) : 0
  const pitch = telemetry.pitchDeg != null ? telemetry.pitchDeg - (settings?.pitchOffset ?? 0) : 0
  const gx = telemetry.gForceX ?? 0
  const gy = telemetry.gForceY ?? 0
  const totalG = Math.sqrt(gx ** 2 + gy ** 2)
  const absLean = Math.abs(Math.round(lean))
  const side = lean > 0.5 ? 'R' : lean < -0.5 ? 'L' : ''
  const absPitch = Math.abs(Math.round(pitch))
  const pitchDir = pitch > 0.5 ? '\u25b2' : pitch < -0.5 ? '\u25bc' : ''
  const attitudeClip = useSvgId('ride-attitude')

  const stat = (label: string, value: string, color = '#fff') => (
    <div
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}
    >
      <span style={{ color: '#dcdcdc', fontSize: 14, fontWeight: 800, letterSpacing: 0.5 }}>
        {label}
      </span>
      <span style={{ color, fontSize: 17, fontWeight: 900, fontFamily: 'monospace' }}>{value}</span>
    </div>
  )

  const rim = (deg: number, r = 70) => {
    const a = (deg * Math.PI) / 180
    return { x: 84 + r * Math.sin(a), y: 90 - r * Math.cos(a) }
  }
  const gScale = 58 / 1.2
  const gDx = Math.max(-58, Math.min(58, gx * gScale))
  const gDy = Math.max(-58, Math.min(58, gy * gScale))
  const peakR = Math.min(58, telemetry.imuPeak.g * gScale)

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        gap: 6,
        padding: '6px 12px 4px 8px',
        fontFamily: 'sans-serif'
      }}
    >
      <div style={{ flex: '0 0 33%', minWidth: 0, display: 'flex', justifyContent: 'center' }}>
        <svg
          viewBox="0 0 168 210"
          style={{ height: '100%', display: 'block' }}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <clipPath id={attitudeClip}>
              <circle cx={84} cy={90} r={70} />
            </clipPath>
            <linearGradient id={`${attitudeClip}-sky`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2b6cb0" />
              <stop offset="100%" stopColor="#1a3a5c" />
            </linearGradient>
          </defs>
          <g clipPath={`url(#${attitudeClip})`}>
            <g transform={`rotate(${lean}, 84, ${90 + pitch * 2.2})`}>
              <rect
                x={-126}
                y={90 + pitch * 2.2 - 210}
                width={420}
                height={210}
                fill={`url(#${attitudeClip}-sky)`}
              />
              <rect x={-126} y={90 + pitch * 2.2} width={420} height={210} fill="#5c3412" />
              <line
                x1={-126}
                y1={90 + pitch * 2.2}
                x2={294}
                y2={90 + pitch * 2.2}
                stroke="#fff"
                strokeWidth={2}
                opacity={0.9}
              />
              {[-10, 10].map((p) => (
                <line
                  key={p}
                  x1={62}
                  y1={90 + pitch * 2.2 - p * 2.2}
                  x2={106}
                  y2={90 + pitch * 2.2 - p * 2.2}
                  stroke="#fff"
                  strokeWidth={1}
                  opacity={0.45}
                />
              ))}
            </g>
          </g>
          <circle
            cx={84}
            cy={90}
            r={70}
            fill="none"
            stroke="rgba(255,255,255,0.25)"
            strokeWidth={1.5}
          />
          {[-45, -30, -15, 0, 15, 30, 45].map((d) => {
            const o = rim(d, 71)
            const i = rim(d, d === 0 ? 61 : 64)
            return (
              <line
                key={d}
                x1={o.x}
                y1={o.y}
                x2={i.x}
                y2={i.y}
                stroke="rgba(255,255,255,0.6)"
                strokeWidth={d === 0 ? 2 : 1.2}
              />
            )
          })}
          {telemetry.imuPeak.leanL > 1 &&
            (() => {
              const p = rim(-telemetry.imuPeak.leanL, 71)
              const q = rim(-telemetry.imuPeak.leanL, 61)
              return (
                <line
                  x1={p.x}
                  y1={p.y}
                  x2={q.x}
                  y2={q.y}
                  stroke="#ff8a65"
                  strokeWidth={2.4}
                  strokeLinecap="round"
                />
              )
            })()}
          {telemetry.imuPeak.leanR > 1 &&
            (() => {
              const p = rim(telemetry.imuPeak.leanR, 71)
              const q = rim(telemetry.imuPeak.leanR, 61)
              return (
                <line
                  x1={p.x}
                  y1={p.y}
                  x2={q.x}
                  y2={q.y}
                  stroke="#ff8a65"
                  strokeWidth={2.4}
                  strokeLinecap="round"
                />
              )
            })()}
          {(() => {
            const p = rim(lean, 68)
            return (
              <polygon
                points={`${p.x},${p.y} ${p.x - 5},${p.y - 9} ${p.x + 5},${p.y - 9}`}
                fill={leanColor(absLean)}
                transform={`rotate(${lean}, ${p.x}, ${p.y})`}
              />
            )
          })()}
          <line
            x1={54}
            y1={90}
            x2={75}
            y2={90}
            stroke="#ffd700"
            strokeWidth={3}
            strokeLinecap="round"
          />
          <line
            x1={93}
            y1={90}
            x2={114}
            y2={90}
            stroke="#ffd700"
            strokeWidth={3}
            strokeLinecap="round"
          />
          <circle cx={84} cy={90} r={2.6} fill="#ffd700" />
          <text
            x={84}
            y={190}
            textAnchor="middle"
            fill={leanColor(absLean)}
            fontSize={34}
            fontWeight="900"
            fontFamily="monospace"
          >
            {`${absLean}\u00b0${side}`}
          </text>
          <text
            x={84}
            y={205}
            textAnchor="middle"
            fill="#cfcfcf"
            fontSize={12}
            fontWeight={800}
            letterSpacing={3}
            fontFamily="monospace"
          >
            LEAN
          </text>
        </svg>
      </div>
      <div style={{ flex: '0 0 30%', minWidth: 0, display: 'flex', justifyContent: 'center' }}>
        <svg
          viewBox="0 0 150 210"
          style={{ height: '100%', display: 'block' }}
          preserveAspectRatio="xMidYMid meet"
        >
          <circle
            cx={75}
            cy={88}
            r={58}
            fill="#0c0c0c"
            stroke="rgba(255,255,255,0.2)"
            strokeWidth={1.2}
          />
          <circle
            cx={75}
            cy={88}
            r={29}
            fill="none"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth={0.8}
            strokeDasharray="3 3"
          />
          <line
            x1={17}
            y1={88}
            x2={133}
            y2={88}
            stroke="rgba(255,255,255,0.12)"
            strokeWidth={0.8}
          />
          <line
            x1={75}
            y1={30}
            x2={75}
            y2={146}
            stroke="rgba(255,255,255,0.12)"
            strokeWidth={0.8}
          />
          <text
            x={75}
            y={26}
            textAnchor="middle"
            fill="rgba(255,255,255,0.55)"
            fontSize={9}
            fontWeight={700}
            fontFamily="monospace"
          >
            BRAKE
          </text>
          <text
            x={75}
            y={158}
            textAnchor="middle"
            fill="rgba(255,255,255,0.55)"
            fontSize={9}
            fontWeight={700}
            fontFamily="monospace"
          >
            ACCEL
          </text>
          {telemetry.imuPeak.g > 0.05 && (
            <circle
              cx={75}
              cy={88}
              r={peakR}
              fill="none"
              stroke="#ffb300"
              strokeWidth={1.2}
              strokeDasharray="2 2"
              opacity={0.7}
            />
          )}
          <line
            x1={75}
            y1={88}
            x2={75 + gDx}
            y2={88 + gDy}
            stroke={gColor(totalG)}
            strokeWidth={1.5}
            opacity={0.5}
          />
          <circle
            cx={75 + gDx}
            cy={88 + gDy}
            r={6}
            fill={gColor(totalG)}
            stroke="#fff"
            strokeWidth={1.2}
          />
          <text
            x={75}
            y={186}
            textAnchor="middle"
            fill={gColor(totalG)}
            fontSize={30}
            fontWeight="900"
            fontFamily="monospace"
          >
            {totalG.toFixed(2)}
          </text>
          <text
            x={75}
            y={203}
            textAnchor="middle"
            fill="#cfcfcf"
            fontSize={12}
            fontWeight={800}
            letterSpacing={2}
            fontFamily="monospace"
          >
            G-FORCE
          </text>
        </svg>
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 9,
          paddingTop: 50,
          paddingRight: 2
        }}
      >
        {stat('MAX L', `${Math.round(telemetry.imuPeak.leanL)}\u00b0`, '#ff8a65')}
        {stat('MAX R', `${Math.round(telemetry.imuPeak.leanR)}\u00b0`, '#ff8a65')}
        {stat(
          'PITCH',
          telemetry.pitchDeg != null
            ? absPitch === 0
              ? `0\u00b0`
              : `${pitchDir}${absPitch}\u00b0`
            : '\u2014',
          '#80cbc4'
        )}
        {stat(
          'PEAK G',
          telemetry.imuPeak.g > 0.05 ? telemetry.imuPeak.g.toFixed(2) : '\u2014',
          '#ffb300'
        )}
        <div style={{ marginTop: 4, alignSelf: 'flex-end' }}>
          <ResetMaxButton onReset={actions.resetImuPeak} width={132} />
        </div>
      </div>
    </div>
  )
}

function Cylinder({ temp, dir }: { temp: number | null; dir: -1 | 1 }) {
  const has = temp !== null
  const t = temp ?? 0
  const { color } = has ? chtZone(t) : { color: '#3a3a3a' }
  const glow = has ? Math.max(0, Math.min(1, (t - 40) / 200)) : 0
  const filterId = useSvgId(`cyl-glow-${dir === 1 ? 'r' : 'l'}`)

  return (
    <svg
      viewBox="0 0 130 96"
      width="100%"
      height="96"
      preserveAspectRatio="xMidYMid meet"
      style={{ transform: dir === -1 ? 'scaleX(-1)' : undefined }}
    >
      <defs>
        <filter id={filterId} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      {has && glow > 0.02 && (
        <g filter={`url(#${filterId})`} opacity={0.25 + glow * 0.6}>
          <rect x={28} y={26} width={86} height={44} rx={10} fill={color} />
        </g>
      )}
      <rect
        x={2}
        y={34}
        width={26}
        height={28}
        rx={4}
        fill="#2a2a2a"
        stroke="#444"
        strokeWidth={1}
      />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect
          key={i}
          x={30 + i * 14}
          y={24}
          width={9}
          height={48}
          rx={2}
          fill={has ? color : '#333'}
          opacity={has ? 0.55 + glow * 0.35 : 0.5}
        />
      ))}
      <rect
        x={100}
        y={20}
        width={20}
        height={56}
        rx={6}
        fill={has ? color : '#3a3a3a'}
        opacity={has ? 0.85 : 0.6}
      />
      <circle cx={123} cy={48} r={3.4} fill="#888" />
    </svg>
  )
}

function CylinderHeadsPanel({
  telemetry,
  actions
}: {
  telemetry: MotoTelemetry
  actions: MotoActions
}) {
  if (telemetry.chtLeftC === null && telemetry.chtRightC === null) {
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <div
          style={{
            color: '#888',
            fontSize: 14,
            fontWeight: 800,
            letterSpacing: 2,
            fontFamily: 'monospace'
          }}
        >
          NO CYLINDER-HEAD DATA
        </div>
      </div>
    )
  }

  const reading = (label: string, temp: number | null, peak: number) => {
    const has = temp !== null
    const zone = has ? chtZone(temp) : { label: '\u2014', color: '#777' }
    return { label, has, temp, zone, peak }
  }

  const left = reading('L', telemetry.chtLeftC, telemetry.chtPeak.left)
  const right = reading('R', telemetry.chtRightC, telemetry.chtPeak.right)
  const delta =
    telemetry.chtLeftC !== null && telemetry.chtRightC !== null
      ? Math.abs(Math.round(telemetry.chtLeftC - telemetry.chtRightC))
      : null
  const deltaColor =
    delta === null ? '#777' : delta < 20 ? '#9ccc65' : delta < 40 ? '#ffca28' : '#ef5350'

  const side = (s: typeof left, dir: -1 | 1) => (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1
      }}
    >
      <div
        style={{
          color: '#dcdcdc',
          fontSize: 14,
          fontWeight: 900,
          letterSpacing: 3,
          fontFamily: 'monospace'
        }}
      >
        {s.label} HEAD
      </div>
      <Cylinder temp={s.temp} dir={dir} />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
        <span
          style={{
            color: s.has ? s.zone.color : '#fff',
            fontSize: 40,
            fontWeight: 900,
            fontFamily: 'monospace',
            lineHeight: 1
          }}
        >
          {s.has ? Math.round(s.temp as number) : '--'}
        </span>
        <span style={{ color: '#bbb', fontSize: 16, fontWeight: 700, fontFamily: 'monospace' }}>
          {'\u00b0C'}
        </span>
      </div>
      <div
        style={{
          color: s.has ? s.zone.color : '#777',
          fontSize: 14,
          fontWeight: 800,
          letterSpacing: 2,
          fontFamily: 'monospace'
        }}
      >
        {s.zone.label}
      </div>
      <div style={{ color: '#aaa', fontSize: 12, fontWeight: 700, fontFamily: 'monospace' }}>
        {s.peak > 0 ? `MAX ${Math.round(s.peak)}\u00b0` : ''}
      </div>
    </div>
  )

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '8px 12px 4px',
        fontFamily: 'sans-serif'
      }}
    >
      {side(left, -1)}
      <div
        style={{
          flex: '0 0 124px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
          paddingTop: 20
        }}
      >
        <span
          style={{
            color: '#888',
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 2,
            fontFamily: 'monospace'
          }}
        >
          {'\u25c4 BOXER \u25ba'}
        </span>
        <span
          style={{
            color: '#888',
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: 2,
            fontFamily: 'monospace',
            marginTop: 4
          }}
        >
          {'\u0394T'}
        </span>
        <span
          style={{
            color: deltaColor,
            fontSize: 30,
            fontWeight: 900,
            fontFamily: 'monospace',
            lineHeight: 1
          }}
        >
          {delta !== null ? `${delta}\u00b0` : '\u2014'}
        </span>
        <div style={{ marginTop: 8 }}>
          <ResetMaxButton onReset={actions.resetChtPeak} width={116} />
        </div>
      </div>
      {side(right, 1)}
    </div>
  )
}

function ResetMaxButton({ onReset, width = 120 }: { onReset: () => void; width?: number }) {
  const [confirm, setConfirm] = React.useState(false)
  const base: React.CSSProperties = {
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontWeight: 800,
    letterSpacing: 1,
    borderRadius: 10,
    textAlign: 'center',
    userSelect: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width
  }

  if (!confirm) {
    return (
      <button
        type="button"
        onClick={() => setConfirm(true)}
        style={{
          ...base,
          minHeight: 46,
          padding: '11px 14px',
          fontSize: 15,
          color: '#ff9a9a',
          background: 'rgba(255,107,107,0.12)',
          border: '2px solid #ff6b6b66'
        }}
      >
        RESET MAX
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width }}>
      <button
        type="button"
        onClick={() => {
          onReset()
          setConfirm(false)
        }}
        style={{
          ...base,
          minHeight: 44,
          padding: '10px 12px',
          fontSize: 14,
          color: '#fff',
          background: '#7a1414',
          border: '2px solid #ff6b6b'
        }}
      >
        CONFIRM
      </button>
      <button
        type="button"
        onClick={() => setConfirm(false)}
        style={{
          ...base,
          minHeight: 40,
          padding: '9px 12px',
          fontSize: 14,
          color: '#ccc',
          background: '#242424',
          border: '2px solid #555'
        }}
      >
        CANCEL
      </button>
    </div>
  )
}

function MetricGraph({
  metricKey,
  telemetry,
  settings,
  dataRef,
  actions
}: {
  metricKey: MetricKey
  telemetry: MotoTelemetry
  settings: MotoSettings | null
  dataRef: React.MutableRefObject<Record<MetricKey, DataPoint[]>>
  actions: MotoActions
}) {
  const navigate = useNavigate()
  const topPanel = GPS_KEYS.includes(metricKey)
    ? 'gps'
    : IMU_KEYS.includes(metricKey)
      ? 'imu'
      : CHT_KEYS.includes(metricKey)
        ? 'cht'
        : null
  const keys: MetricKey[] = metricKey === 'ambientTemp' ? ['ambientTemp', 'piTemp'] : [metricKey]
  const compact = topPanel !== null || keys.length > 1
  const showSettingsShortcut = metricKey === 'ambientTemp'
  const [nowMs, setNowMs] = React.useState(() => Date.now())
  const [confirmQuit, setConfirmQuit] = React.useState(false)
  const closeHoldRef = React.useRef<{ timer: number | null; fired: boolean }>({
    timer: null,
    fired: false
  })

  React.useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  React.useEffect(
    () => () => {
      if (closeHoldRef.current.timer != null) {
        window.clearTimeout(closeHoldRef.current.timer)
      }
    },
    []
  )

  const closeHoldStart = () => {
    closeHoldRef.current.fired = false
    closeHoldRef.current.timer = window.setTimeout(() => {
      closeHoldRef.current.fired = true
      setConfirmQuit(true)
    }, 800)
  }

  const closeHoldEnd = () => {
    if (closeHoldRef.current.timer != null) {
      window.clearTimeout(closeHoldRef.current.timer)
      closeHoldRef.current.timer = null
    }
    if (!closeHoldRef.current.fired) actions.closeMetric()
    closeHoldRef.current.fired = false
  }

  const closeHoldCancel = () => {
    if (closeHoldRef.current.timer != null) {
      window.clearTimeout(closeHoldRef.current.timer)
      closeHoldRef.current.timer = null
    }
  }

  const openSettings = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    navigate('/settings', { replace: true })
  }

  return (
    <div
      data-testid="projection-metric-graph"
      style={{
        position: 'absolute',
        top: ARC_PCT,
        left: `calc(${ARC_PCT} - 2px)`,
        width: `calc(${SQUARE_PCT} + 4px)`,
        height: SQUARE_PCT,
        background: '#000',
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        userSelect: 'none',
        pointerEvents: 'auto'
      }}
    >
      <button
        type="button"
        aria-label="Close graph"
        onPointerDown={closeHoldStart}
        onPointerUp={closeHoldEnd}
        onPointerLeave={closeHoldCancel}
        style={{ ...closeBtn, position: 'absolute', top: 10, right: 12, zIndex: 20 }}
        title={'tap to close \u00b7 hold to quit app'}
      >
        {'\u2715'}
      </button>

      {showSettingsShortcut && (
        <button
          type="button"
          aria-label="Open settings from graph"
          data-testid="projection-graph-settings-button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={openSettings}
          style={graphSettingsBtn}
        >
          <SettingsOutlinedIcon style={{ fontSize: 27 }} />
        </button>
      )}

      {topPanel === 'gps' && <GpsSkyPanel telemetry={telemetry} />}
      {topPanel === 'imu' && (
        <RideDynamicsPanel telemetry={telemetry} settings={settings} actions={actions} />
      )}
      {topPanel === 'cht' && <CylinderHeadsPanel telemetry={telemetry} actions={actions} />}

      {(topPanel ? [metricKey] : keys).map((key, index) => (
        <GraphPane
          key={key}
          metricKey={key}
          nowMs={nowMs}
          compact={compact}
          first={topPanel === null && index === 0}
          reserveLeadingAction={showSettingsShortcut && index === 0}
          dataRef={dataRef}
          actions={actions}
        />
      ))}

      {confirmQuit && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 500,
            background: 'rgba(0,0,0,0.94)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8
          }}
        >
          <div
            style={{
              color: 'white',
              fontSize: 26,
              fontWeight: 800,
              fontFamily: 'sans-serif',
              letterSpacing: 0.5
            }}
          >
            Quit motoCarPlay?
          </div>
          <div style={{ color: '#888', fontSize: 12, fontFamily: 'monospace', marginBottom: 18 }}>
            this closes the dashboard app
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            <button
              type="button"
              onClick={() => setConfirmQuit(false)}
              style={actionBtn('#2a2a2a', '#ccc')}
            >
              CANCEL
            </button>
            <button
              type="button"
              onClick={() => {
                void window.projection.quit()
              }}
              style={actionBtn('#5c1010', '#ff6b6b')}
            >
              QUIT
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function GraphPane({
  metricKey,
  nowMs,
  compact,
  first,
  reserveLeadingAction,
  dataRef,
  actions
}: {
  metricKey: MetricKey
  nowMs: number
  compact: boolean
  first: boolean
  reserveLeadingAction?: boolean
  dataRef: React.MutableRefObject<Record<MetricKey, DataPoint[]>>
  actions: MotoActions
}) {
  const cfg = METRIC_CONFIG[metricKey]
  const data = dataRef.current[metricKey]
  const [viewOffset, setViewOffset] = React.useState(0)
  const [confirmReset, setConfirmReset] = React.useState(false)
  const panRef = React.useRef({ active: false, startX: 0, startOff: 0 })
  const { svgW, svgH, cx, cy, cw, ch } = motoGraphPaneGeometry(compact)
  const windowEnd = nowMs - viewOffset
  const windowStart = windowEnd - GRAPH_WINDOW_MS
  const visible = data.filter((p) => p.ts >= windowStart - 5000 && p.ts <= windowEnd + 5000)
  const vals = visible.map((p) => p.val)
  const rawMin = vals.length ? Math.min(...vals) : 0
  const rawMax = vals.length ? Math.max(...vals) : 1
  const center = (rawMax + rawMin) / 2
  const span = Math.max(rawMax - rawMin, cfg.minRange)
  const pad = span * 0.15
  const yMin = center - span / 2 - pad
  const yMax = center + span / 2 + pad
  const xFor = (ts: number) => cx + ((ts - windowStart) / GRAPH_WINDOW_MS) * cw
  const yFor = (v: number) => cy + ch - ((v - yMin) / (yMax - yMin)) * ch
  const pts = visible.map((p) => ({ x: xFor(p.ts), y: yFor(p.val) }))
  const linePath = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ')
  const areaPath =
    pts.length > 1
      ? `M${pts[0].x.toFixed(1)},${cy + ch} ${pts.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} L${pts[pts.length - 1].x.toFixed(1)},${cy + ch} Z`
      : ''
  const yTicks = [0, 0.5, 1].map((f) => yMin + f * (yMax - yMin))
  const xLabels: { x: number; label: string }[] = []
  const minMs = 60 * 1000
  const firstMin = Math.ceil(windowStart / minMs) * minMs
  for (let t = firstMin; t <= windowEnd; t += minMs) {
    const x = xFor(t)
    if (x >= cx && x <= cx + cw) {
      const d = new Date(t)
      xLabels.push({ x, label: `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` })
    }
  }
  const isLive = viewOffset < 3000
  const current = data.length ? data[data.length - 1].val : null
  const visMin = vals.length ? Math.min(...vals) : null
  const visMax = vals.length ? Math.max(...vals) : null
  const zones = cfg.zones
  const zoneOf = (v: number) => zones?.find((z) => v <= z.max) ?? zones?.[zones.length - 1]
  const valueColor = zones && current !== null ? (zoneOf(current)?.color ?? cfg.color) : 'white'
  const clipId = useSvgId(`graph-clip-${metricKey}`)
  const areaId = useSvgId(`graph-area-${metricKey}`)
  const gradId = useSvgId(`graph-grad-${metricKey}`)
  const resetMetric = () => {
    actions.clearMetric(metricKey)
    if (IMU_KEYS.includes(metricKey)) actions.resetImuPeak()
    if (CHT_KEYS.includes(metricKey)) actions.resetChtPeak()
  }

  const onPtrDown = (e: React.PointerEvent<SVGSVGElement>) => {
    panRef.current = { active: true, startX: e.clientX, startOff: viewOffset }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPtrMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!panRef.current.active) return
    const dx = e.clientX - panRef.current.startX
    const msPx = GRAPH_WINDOW_MS / cw
    setViewOffset(
      Math.max(0, Math.min(GRAPH_MAX_AGE_MS - GRAPH_WINDOW_MS, panRef.current.startOff + dx * msPx))
    )
  }
  const onPtrUp = () => {
    panRef.current.active = false
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {!first && (
        <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'center', paddingTop: 3 }}>
          <div
            style={{
              width: '75%',
              height: 2,
              borderRadius: 1,
              background: 'rgba(255,255,255,0.22)'
            }}
          />
        </div>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: first ? `12px 70px 0 ${reserveLeadingAction ? 70 : 14}px` : '8px 14px 0',
          flexShrink: 0
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              fontSize: 16,
              fontWeight: 800,
              letterSpacing: 3,
              color: cfg.color,
              fontFamily: 'monospace'
            }}
          >
            {cfg.label}
          </span>
          {isLive ? (
            <span
              style={{
                fontSize: 15,
                color: '#5fd0ff',
                fontWeight: 800,
                letterSpacing: 2,
                fontFamily: 'monospace'
              }}
            >
              {'\u25cf LIVE'}
            </span>
          ) : (
            <span
              style={{
                fontSize: 15,
                color: '#fff',
                fontWeight: 700,
                letterSpacing: 1,
                fontFamily: 'monospace'
              }}
            >
              {Math.round(viewOffset / 60000)}m ago
            </span>
          )}
        </div>
        {confirmReset ? (
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={() => setConfirmReset(false)}
              style={actionBtn('#2a2a2a', '#aaa', compact)}
            >
              CANCEL
            </button>
            <button
              type="button"
              onClick={() => {
                resetMetric()
                setConfirmReset(false)
              }}
              style={actionBtn('#5c1010', '#ff6b6b', compact)}
            >
              CONFIRM
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            style={actionBtn('#2a0808', '#ff6b6b', compact)}
          >
            RESET
          </button>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          padding: compact ? '2px 14px 4px' : '4px 14px 8px',
          flexShrink: 0
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span
            style={{
              fontSize: compact ? 46 : 84,
              fontWeight: 900,
              color: valueColor,
              lineHeight: 0.88,
              fontFamily: 'monospace',
              letterSpacing: 0
            }}
          >
            {current !== null ? cfg.fmtVal(current) : '--'}
          </span>
          <span
            style={{
              fontSize: compact ? 20 : 26,
              fontWeight: 700,
              color: '#e8e8e8',
              fontFamily: 'monospace'
            }}
          >
            {cfg.unit}
          </span>
        </div>
        <div
          style={{
            fontSize: 20,
            color: '#fff',
            fontWeight: 800,
            fontFamily: 'monospace',
            textAlign: 'right',
            lineHeight: 1.35
          }}
        >
          {visMax !== null && <div>MAX {cfg.fmtVal(visMax)}</div>}
          {visMin !== null && <div>MIN {cfg.fmtVal(visMin)}</div>}
          {!compact && (
            <div
              style={{ fontSize: 14, color: '#e0e0e0', fontWeight: 700, marginTop: 4 }}
            >{`${data.length} pts \u00b7 drag \u2190 \u2192`}</div>
          )}
        </div>
      </div>
      <svg
        data-testid={`projection-metric-graph-chart-${metricKey}`}
        viewBox={`0 0 ${svgW} ${svgH}`}
        style={{
          flex: 1,
          minHeight: 0,
          display: 'block',
          cursor: 'ew-resize',
          touchAction: 'none'
        }}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPtrDown}
        onPointerMove={onPtrMove}
        onPointerUp={onPtrUp}
        onPointerLeave={onPtrUp}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={cx} y={cy} width={cw} height={ch} />
          </clipPath>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={cfg.color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={cfg.color} stopOpacity="0.02" />
          </linearGradient>
          {zones && areaPath && (
            <clipPath id={areaId}>
              <path d={areaPath} />
            </clipPath>
          )}
        </defs>
        <rect
          data-testid={`projection-metric-graph-plot-${metricKey}`}
          x={cx}
          y={cy}
          width={cw}
          height={ch}
          fill="#080808"
          rx={4}
        />
        {yTicks.map((v, i) => {
          const y = yFor(v)
          return (
            <g key={i}>
              <line
                x1={cx}
                y1={y}
                x2={cx + cw}
                y2={y}
                stroke="rgba(255,255,255,0.1)"
                strokeWidth={1}
              />
              <text
                x={cx - 5}
                y={y + 5}
                textAnchor="end"
                fill="rgba(255,255,255,0.92)"
                fontSize={15}
                fontWeight={700}
                fontFamily="monospace"
              >
                {cfg.fmtVal(v)}
              </text>
            </g>
          )
        })}
        {xLabels.map(({ x, label }) => (
          <g key={`${x}:${label}`}>
            <line
              x1={x}
              y1={cy}
              x2={x}
              y2={cy + ch}
              stroke="rgba(255,255,255,0.1)"
              strokeWidth={1}
            />
            <text
              x={x}
              y={cy + ch + 18}
              textAnchor="middle"
              fill="rgba(255,255,255,0.92)"
              fontSize={15}
              fontWeight={700}
              fontFamily="monospace"
            >
              {label}
            </text>
          </g>
        ))}
        {areaPath && zones && (
          <g clipPath={`url(#${clipId})`}>
            <g clipPath={`url(#${areaId})`}>
              {zones.map((z, i) => {
                const lo = i === 0 ? yMin : zones[i - 1].max
                const vTop = Math.min(z.max, yMax)
                const vBot = Math.max(lo, yMin)
                if (vTop <= vBot) return null
                const yT = yFor(vTop)
                return (
                  <rect
                    key={i}
                    x={cx}
                    width={cw}
                    y={yT}
                    height={yFor(vBot) - yT}
                    fill={z.color}
                    opacity={0.3}
                  />
                )
              })}
            </g>
          </g>
        )}
        {areaPath && !zones && (
          <path d={areaPath} fill={`url(#${gradId})`} clipPath={`url(#${clipId})`} />
        )}
        {zones?.map((z, i) => {
          if (i === 0 || !z.label) return null
          const thr = zones[i - 1].max
          if (thr <= yMin || thr >= yMax) return null
          const y = yFor(thr)
          return (
            <g key={`thr-${i}`}>
              <line
                x1={cx}
                y1={y}
                x2={cx + cw}
                y2={y}
                stroke={z.color}
                strokeWidth={1}
                strokeDasharray="4 4"
                opacity={0.55}
              />
              <text
                x={cx + cw - 4}
                y={y - 5}
                textAnchor="end"
                fill={z.color}
                fontSize={14}
                fontWeight={800}
                fontFamily="monospace"
              >
                {`${z.label} ${cfg.fmtVal(thr)}\u00b0`}
              </text>
            </g>
          )
        })}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke={zones ? 'rgba(255,255,255,0.9)' : cfg.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            clipPath={`url(#${clipId})`}
          />
        )}
        {visible.length < 2 && (
          <text
            x={cx + cw / 2}
            y={cy + ch / 2 + 6}
            textAnchor="middle"
            fill="rgba(255,255,255,0.6)"
            fontSize={19}
            fontWeight={700}
            letterSpacing={2}
            fontFamily="monospace"
          >
            NO DATA IN WINDOW
          </text>
        )}
        <rect
          x={cx}
          y={cy}
          width={cw}
          height={ch}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={0.5}
          rx={4}
        />
        {data.length > 0 &&
          (() => {
            const totalRange = Math.max(data[data.length - 1].ts - data[0].ts, GRAPH_WINDOW_MS)
            const barW = Math.max(24, cw * (GRAPH_WINDOW_MS / totalRange))
            const maxOff = Math.max(0, totalRange - GRAPH_WINDOW_MS)
            const barX = cx + cw - (viewOffset / Math.max(1, maxOff)) * (cw - barW) - barW
            return (
              <>
                <rect
                  x={cx}
                  y={cy + ch + 30}
                  width={cw}
                  height={4}
                  fill="rgba(255,255,255,0.05)"
                  rx={2}
                />
                <rect
                  x={barX}
                  y={cy + ch + 30}
                  width={barW}
                  height={4}
                  fill={cfg.color}
                  rx={2}
                  opacity={0.45}
                />
              </>
            )
          })()}
      </svg>
    </div>
  )
}

export function motoGraphPaneGeometry(compact: boolean) {
  const svgW = MOTO_CENTER_SQUARE_SIZE
  const cx = 58
  const cy = 8
  const cw = svgW - cx - 10
  const ch = compact ? 176 : 382
  const svgH = cy + ch + (compact ? 38 : 64)
  return { svgW, svgH, cx, cy, cw, ch }
}

const actionBtn = (bg: string, fg: string, compact = false): React.CSSProperties => ({
  background: bg,
  border: `2px solid ${fg}55`,
  color: fg,
  borderRadius: 16,
  height: compact ? 50 : 64,
  minWidth: compact ? 96 : 116,
  padding: compact ? '0 18px' : '0 26px',
  fontSize: compact ? 13 : 15,
  fontWeight: 800,
  letterSpacing: 2,
  cursor: 'pointer',
  fontFamily: 'monospace',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center'
})

const closeBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.07)',
  border: '2px solid rgba(255,255,255,0.22)',
  color: 'white',
  borderRadius: '50%',
  width: 56,
  height: 56,
  fontSize: 22,
  fontWeight: 700,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  flexShrink: 0
}

const graphSettingsBtn: React.CSSProperties = {
  position: 'absolute',
  top: 10,
  left: 12,
  zIndex: 20,
  width: 48,
  height: 48,
  borderRadius: 12,
  border: '2px solid rgba(255,255,255,0.22)',
  background: 'rgba(255,255,255,0.07)',
  color: 'white',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  cursor: 'pointer',
  touchAction: 'manipulation',
  WebkitTapHighlightColor: 'transparent'
}

export function ProjectionSensorOverlay() {
  const settings = useLiviStore((s) => s.settings)
  const backdropSampleColor = useLiviStore((s) => s.backdropSampleColor)
  const { pathname } = useLocation()
  const motoSettings = settings as MotoSettings | null
  const { telemetry, activeGraph, dataRef, actions } = useMotoTelemetry(motoSettings)
  const blurBackdropActive =
    motoSettings?.backdropEnabled === true && motoSettings.backdropMode === 'blur'
  // With "Extend CarPlay Background" on, the margin outside the safe square is
  // live CarPlay wallpaper — the arcs/strips must be transparent (like the blur
  // backdrop case) so the gauges float over it instead of hiding it behind an
  // opaque fill rectangle.
  const extendBackground = motoSettings?.projectionSafeAreaDrawOutside === true
  const arcBackground = motoSettings
    ? blurBackdropActive || extendBackground
      ? 'transparent'
      : ((motoSettings.backdropEnabled === true
          ? (backdropSampleColor ?? motoFillHex(motoSettings))
          : motoFillHex(motoSettings)) ?? 'transparent')
    : 'transparent'

  React.useEffect(() => {
    if (pathname !== '/') actions.closeMetric()
  }, [actions, pathname])

  return (
    <div
      data-testid="projection-sensor-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 10,
        pointerEvents: 'none'
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: SQUARE_PCT,
          height: ARC_PCT,
          pointerEvents: 'auto'
        }}
      >
        <TopArc
          telemetry={telemetry}
          actions={actions}
          background={arcBackground}
          extend={extendBackground}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: SQUARE_PCT,
          height: ARC_PCT,
          pointerEvents: 'auto'
        }}
      >
        <BottomArc
          telemetry={telemetry}
          settings={motoSettings}
          actions={actions}
          background={arcBackground}
          extend={extendBackground}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          width: ARC_PCT,
          height: SQUARE_PCT,
          pointerEvents: 'auto'
        }}
      >
        <ChtGauge
          side="L"
          value={telemetry.chtLeftC}
          lastValue={telemetry.chtLeftLastC}
          responding={telemetry.chtLeftResponding}
          actions={actions}
          background={arcBackground}
          extend={extendBackground}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          width: ARC_PCT,
          height: SQUARE_PCT,
          pointerEvents: 'auto'
        }}
      >
        <ChtGauge
          side="R"
          value={telemetry.chtRightC}
          lastValue={telemetry.chtRightLastC}
          responding={telemetry.chtRightResponding}
          actions={actions}
          background={arcBackground}
          extend={extendBackground}
        />
      </div>

      {activeGraph && (
        <MetricGraph
          metricKey={activeGraph}
          telemetry={telemetry}
          settings={motoSettings}
          dataRef={dataRef}
          actions={actions}
        />
      )}
    </div>
  )
}
