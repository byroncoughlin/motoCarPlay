import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import type { Config, TelemetryPayload } from '@shared/types'
import { useLiviStore } from '@store/store'
import * as React from 'react'
import { useLocation, useNavigate } from 'react-router'
import {
  MOTO_CLEAR_GRAPH_HISTORY_EVENT,
  MOTO_CLOSE_METRIC_EVENT,
  MOTO_OPEN_METRIC_EVENT
} from './motoGraphEvents'
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
  | 'leanOffset'
  | 'pitchOffset'
  | 'reverseTilt'
  | 'reversePitch'
  | 'diagnosticMode'
  | 'chtReadoutInBar'
  | 'leanRulerEnabled'
  | 'altitudeOffsetFt'
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

// Tests run the overlay under jsdom; timers/telemetry side channels stay off.
const IS_JSDOM =
  typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('jsdom')
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

// The edge gauges float over whatever the background mode paints beneath the
// strips (solid color, sampled color, blurred frame, or live CarPlay
// wallpaper). Each numeric readout sits inside a uniform pill (an Apple-style
// capsule): one fill, one border, fully rounded, identical height and padding
// everywhere so every gauge reads as part of one instrument set.
const SCRIM_FILL = 'rgba(22,24,28,0.55)'
const SCRIM_STROKE = 'rgba(255,255,255,0.12)'
// Shared pill metrics (SVG user units, which equal on-screen px in the arcs).
const PILL_H = 34
// A soft shadow makes numerals readable even where a pill does not fully cover.
const NUM_SHADOW = '0 1px 3px rgba(0,0,0,0.85)'
const SVG_TEXT_SHADOW = 'drop-shadow(0 1px 2px rgba(0,0,0,0.85))'

// A uniform rounded capsule used behind every gauge readout.
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
// yellow 140–150 (warm), red > 150 (hot). Single source of truth — the pill
// colors, panel zone badges, gauge threshold lines and graph zones all derive
// from this list. (Only WARM/HOT carry a `label`: the graph threshold lines
// annotate just those.)
const CHT_ZONES: MetricZone[] = [
  { max: 80, color: '#4fc3f7' },
  { max: 140, color: '#66bb6a' },
  { max: 150, color: '#ffca28', label: 'WARM' },
  { max: Infinity, color: '#ef5350', label: 'HOT' }
]

// The zone boundaries, for drawing threshold divider lines on the L/R gauges.
const CHT_THRESHOLDS = CHT_ZONES.slice(0, -1).map((z) => z.max)

const METRIC_CONFIG: Record<MetricKey, MetricConfig> = {
  speed: {
    label: 'SPEED',
    unit: 'mph',
    color: '#4fc3f7',
    minRange: 10,
    fmtVal: (v) => String(Math.round(v))
  },
  heading: {
    label: 'HEADING',
    unit: '\u00b0',
    color: '#81c784',
    minRange: 20,
    fmtVal: (v) => String(Math.round(v))
  },
  ambientTemp: {
    label: 'AMBIENT',
    unit: '\u00b0F',
    color: '#fff176',
    minRange: 6,
    fmtVal: (v) => String(Math.round(v))
  },
  chtLeft: {
    label: 'CHT LEFT',
    unit: '\u00b0C',
    color: '#ff8a65',
    minRange: 20,
    fmtVal: (v) => String(Math.round(v)),
    zones: CHT_ZONES
  },
  chtRight: {
    label: 'CHT RIGHT',
    unit: '\u00b0C',
    color: '#ff5252',
    minRange: 20,
    fmtVal: (v) => String(Math.round(v)),
    zones: CHT_ZONES
  },
  altitude: {
    label: 'ALTITUDE',
    unit: 'ft',
    color: '#ce93d8',
    minRange: 50,
    fmtVal: (v) => Math.round(v).toLocaleString()
  },
  gForce: {
    label: 'G-FORCE',
    unit: 'G',
    color: '#ffca28',
    minRange: 0.3,
    fmtVal: (v) => v.toFixed(2)
  },
  leanAngle: {
    label: 'LEAN',
    unit: '\u00b0',
    color: '#ffd700',
    minRange: 20,
    fmtVal: (v) => String(Math.round(v))
  },
  pitchAngle: {
    label: 'PITCH',
    unit: '\u00b0',
    color: '#80cbc4',
    minRange: 12,
    fmtVal: (v) => String(Math.round(v))
  },
  piTemp: {
    label: 'PI CPU',
    unit: '\u00b0C',
    color: '#4dd0e1',
    minRange: 10,
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
  const log = {} as Record<MetricKey, DataPoint[]>
  for (const k of Object.keys(METRIC_CONFIG) as MetricKey[]) log[k] = []
  return log
}

// Graph history and MAX peaks live at MODULE scope, not in per-mount refs:
// the whole Projection page (and this overlay with it) unmounts whenever the
// rider opens Settings, and per-mount storage silently wiped all logging on
// every visit. These survive for the renderer session; only the explicit
// Reset actions / clear-history event empty them. Shaped as {current} so
// they slot in wherever a React ref is expected.
const persistentDataRef: { current: Record<MetricKey, DataPoint[]> } = { current: emptyLog() }
const persistentLastSampleRef: { current: Partial<Record<MetricKey, number>> } = { current: {} }
const persistentPeaks = {
  imu: { leanL: 0, leanR: 0, g: 0 },
  cht: { left: 0, right: 0 }
}

// Test hook: jsdom suites mount the page many times in one module instance,
// so leaked history would bleed between test cases.
export function resetMotoGraphHistoryForTests(): void {
  persistentDataRef.current = emptyLog()
  persistentLastSampleRef.current = {}
  persistentPeaks.imu = { leanL: 0, leanR: 0, g: 0 }
  persistentPeaks.cht = { left: 0, right: 0 }
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
    // Re-seed peaks from the module store so MAX values survive a
    // settings-visit remount.
    imuPeak: { ...persistentPeaks.imu },
    chtPeak: { ...persistentPeaks.cht },
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

  // Not rounded here: stableSpeed rounds the displayed value, and its
  // rise/fall thresholds compare more accurately against the raw mph.
  const speedKph = finiteNumber(msg.speedKph)
  if (speedKph !== undefined) patch.speedMph = Math.max(0, speedKph * 0.621371)

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

const CHT_ZONE_NAMES = ['COLD', 'NORMAL', 'WARM', 'HOT'] as const

// Boundary semantics preserved from the original hand-rolled checks:
// a value on a threshold belongs to the zone below only at 150 (<= WARM).
function chtZone(temp: number): { label: string; color: string } {
  const idx =
    temp < CHT_ZONES[0].max ? 0 : temp < CHT_ZONES[1].max ? 1 : temp <= CHT_ZONES[2].max ? 2 : 3
  return { label: CHT_ZONE_NAMES[idx], color: CHT_ZONES[idx].color }
}

function tempColor(temp: number | null): string {
  return temp == null ? '#333' : chtZone(temp).color
}

// Offset-corrected lean/pitch/G readouts shared by the bottom band and the
// ride-dynamics panel (they previously derived these independently).
function deriveAttitude(telemetry: MotoTelemetry, settings: MotoSettings | null) {
  const lean = telemetry.leanDeg != null ? telemetry.leanDeg - (settings?.leanOffset ?? 0) : 0
  const pitch = telemetry.pitchDeg != null ? telemetry.pitchDeg - (settings?.pitchOffset ?? 0) : 0
  const totalG =
    telemetry.gForceX != null && telemetry.gForceY != null
      ? Math.sqrt(telemetry.gForceX ** 2 + telemetry.gForceY ** 2)
      : null
  return {
    lean,
    pitch,
    totalG,
    absLean: Math.abs(Math.round(lean)),
    side: lean > 0.5 ? 'R' : lean < -0.5 ? 'L' : '',
    absPitch: Math.abs(Math.round(pitch)),
    pitchDir: pitch > 0.5 ? '▲' : pitch < -0.5 ? '▼' : ''
  }
}

// Label/value row shared by the GPS and ride-dynamics center panels.
const stat = (label: string, value: string, color = 'white'): React.JSX.Element => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
    <span style={{ color: '#dcdcdc', fontSize: 15, fontWeight: 700, letterSpacing: 0.3 }}>
      {label}
    </span>
    <span style={{ color, fontSize: 19, fontWeight: 800 }}>{value}</span>
  </div>
)

// Centered placeholder shown by the center panels while a sensor has no data.
function PanelEmptyState({ title, detail }: { title: string; detail?: string }) {
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
      <div style={{ textAlign: 'center' }}>
        <div style={{ color: '#999', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>
          {title}
        </div>
        {detail && <div style={{ color: '#777', fontSize: 14, marginTop: 8 }}>{detail}</div>}
      </div>
    </div>
  )
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
  historyRevision: number
} {
  const [telemetry, setTelemetry] = React.useState<MotoTelemetry>(() => initialTelemetry())
  const [activeGraph, setActiveGraph] = React.useState<MetricKey | null>(null)
  // Bumped whenever graph history is cleared. Also passed down to the
  // memoized GraphPane so a clear redraws it immediately instead of waiting
  // for the next 1 Hz nowMs tick (dataRef mutations are invisible to memo).
  const [historyRevision, setHistoryRevision] = React.useState(0)
  // Module-scope stores (see persistentDataRef above): plain {current}
  // objects, ref-shaped, so downstream MutableRefObject consumers are
  // unaffected — but history survives this component unmounting.
  const dataRef = persistentDataRef
  const lastSampleRef = persistentLastSampleRef
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
    // Site-demo remote control: lets the project page's scroll steps open
    // and close real graphs. Inert in the app — nothing dispatches these.
    const openMetricEvt = (e: Event) => {
      const key = (e as CustomEvent).detail as MetricKey | undefined
      if (key && key in METRIC_CONFIG) setActiveGraph(key)
    }
    const closeMetricEvt = () => setActiveGraph(null)
    window.addEventListener(MOTO_CLEAR_GRAPH_HISTORY_EVENT, clearAll)
    window.addEventListener(MOTO_OPEN_METRIC_EVENT, openMetricEvt)
    window.addEventListener(MOTO_CLOSE_METRIC_EVENT, closeMetricEvt)
    return () => {
      window.removeEventListener(MOTO_CLEAR_GRAPH_HISTORY_EVENT, clearAll)
      window.removeEventListener(MOTO_OPEN_METRIC_EVENT, openMetricEvt)
      window.removeEventListener(MOTO_CLOSE_METRIC_EVENT, closeMetricEvt)
    }
  }, [])

  // Diagnostic Mode: persist a snapshot (graph history + sensor diagnostics +
  // recent raw telemetry) to disk every DIAG_FLUSH_MS and once on unmount/close.
  // Entirely gated on the setting — when off, no interval, no listener, no push.
  React.useEffect(() => {
    if (!settings?.diagnosticMode) return
    if (IS_JSDOM) return

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

        // Rider-set GPS altitude correction (Advanced > Altitude Offset),
        // applied to freshly-arrived readings so the pill, holds and graphs
        // all see the corrected value.
        if (patch.altitudeFt !== undefined && next.altitudeFt != null) {
          next.altitudeFt = next.altitudeFt + Math.round(settingsRef.current?.altitudeOffsetFt ?? 0)
        }

        // normalizeGpsSky always builds a fresh object graph; reuse the
        // previous one when the report is byte-identical so an unchanged sky
        // doesn't defeat the Object.is dedup below at GPS report rate.
        if (
          patch.gpsSky !== undefined &&
          patch.gpsSky !== null &&
          prev.gpsSky != null &&
          JSON.stringify(patch.gpsSky) === JSON.stringify(prev.gpsSky)
        ) {
          next.gpsSky = prev.gpsSky
        }

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

        // Peaks: only look at freshly-arrived patch values, and only allocate a
        // new peak object when a peak actually increases. Unconditional spreads
        // here gave imuPeak/chtPeak a new identity on every payload, which made
        // changed() below always report a change and re-rendered the whole
        // overlay at raw sensor tick rate.
        if (patch.leanDeg !== undefined && next.leanDeg != null) {
          const leanOffset = settingsRef.current?.leanOffset ?? 0
          const lean = next.leanDeg - leanOffset
          if (lean > next.imuPeak.leanR || -lean > next.imuPeak.leanL) {
            next.imuPeak = {
              ...next.imuPeak,
              leanR: Math.max(next.imuPeak.leanR, lean),
              leanL: Math.max(next.imuPeak.leanL, -lean)
            }
          }
        }
        if (
          (patch.gForceX !== undefined || patch.gForceY !== undefined) &&
          next.gForceX != null &&
          next.gForceY != null
        ) {
          const g = Math.sqrt(next.gForceX ** 2 + next.gForceY ** 2)
          if (g > next.imuPeak.g) next.imuPeak = { ...next.imuPeak, g }
        }
        if (
          patch.chtLeftC !== undefined &&
          next.chtLeftC != null &&
          next.chtLeftC > next.chtPeak.left
        ) {
          next.chtPeak = { ...next.chtPeak, left: next.chtLeftC }
        }
        if (
          patch.chtRightC !== undefined &&
          next.chtRightC != null &&
          next.chtRightC > next.chtPeak.right
        ) {
          next.chtPeak = { ...next.chtPeak, right: next.chtRightC }
        }
        // Mirror peaks into the module store so a remount re-seeds them.
        persistentPeaks.imu = next.imuPeak
        persistentPeaks.cht = next.chtPeak

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
    if (IS_JSDOM) return
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
      resetImuPeak: () => {
        persistentPeaks.imu = { leanL: 0, leanR: 0, g: 0 }
        setTelemetry((prev) => ({ ...prev, imuPeak: { leanL: 0, leanR: 0, g: 0 } }))
      },
      resetChtPeak: () => {
        persistentPeaks.cht = { left: 0, right: 0 }
        setTelemetry((prev) => ({ ...prev, chtPeak: { left: 0, right: 0 } }))
      }
    }),
    []
  )

  return { telemetry, activeGraph, dataRef, actions, historyRevision }
}

// Memoized on exactly the fields the top band renders, so IMU-rate commits
// (lean/G change nearly every tick) don't re-render the speed/heading/temp
// pills. Keep TOP_ARC_FIELDS in sync with the telemetry.* reads below.
const TOP_ARC_FIELDS = [
  'ambientF',
  'gpsFix',
  'gpsResponding',
  'gpsSatellites',
  'headingDeg',
  'headingDegLast',
  'speedMph',
  'speedMphLast'
] as const satisfies readonly (keyof MotoTelemetry)[]

const TopArc = React.memo(
  TopArcImpl,
  (prev, next) =>
    prev.actions === next.actions &&
    TOP_ARC_FIELDS.every((f) => Object.is(prev.telemetry[f], next.telemetry[f]))
)

function TopArcImpl({ telemetry, actions }: { telemetry: MotoTelemetry; actions: MotoActions }) {
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
    userSelect: 'none',
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent'
  }
  // Each readout sits in its own rounded capsule (pill) so the gauge set reads
  // uniformly in every background mode. The strip itself stays transparent —
  // the mode's fill (or wallpaper) shows through from underneath.
  const pill: React.CSSProperties = {
    background: SCRIM_FILL,
    border: `1px solid ${SCRIM_STROKE}`,
    borderRadius: 999,
    padding: '4px 14px'
  }

  return (
    <div
      style={{ position: 'relative', width: '100%', height: '100%', background: 'transparent' }}
      data-testid="projection-top-arc"
    >
      {/* Cardinal only, as big as the band allows \u2014 the exact degrees live in
          the heading graph a tap away. A one-line "SW 249\u00b0" pill cannot grow
          without either poking the glass or colliding with a 3-digit speed. */}
      <button
        type="button"
        onClick={() => actions.openMetric('heading')}
        style={{
          ...bandBase,
          left: 70,
          width: '24%',
          // 4px (not 6) from the square: two-letter cardinals ("NE") need the
          // extra 2px of lower, wider circle to hold ~9px glass clearance.
          paddingBottom: 4,
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
            textShadow: NUM_SHADOW
          }}
        >
          <span style={{ fontSize: 42, fontWeight: 800, color: 'white', lineHeight: 1 }}>
            {cardinal ?? '--'}
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
          paddingBottom: 8,
          border: 0,
          background: 'transparent'
        }}
      >
        {telemetry.gpsFix === true ? (
          <span
            className={gpsStale && speed != null ? 'moto-gps-stale' : undefined}
            style={{
              ...pill,
              padding: '2px 18px',
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              textShadow: NUM_SHADOW
            }}
          >
            <span
              style={{
                fontSize: 76,
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
                fontSize: 20,
                fontWeight: 700,
                color: 'rgba(255,255,255,0.78)',
                letterSpacing: 0.3
              }}
            >
              mph
            </span>
          </span>
        ) : (
          // No fix: a compact two-line pill — smaller numeral over the GPS
          // state — so the status is large and central (not a tiny caption at
          // the top of the glass) yet the pill never grows past its band slot
          // into the heading/temperature pills.
          <span
            className={gpsStale && speed != null ? 'moto-gps-stale' : undefined}
            style={{
              ...pill,
              padding: '6px 16px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              textShadow: NUM_SHADOW
            }}
          >
            <span
              style={{
                fontSize: 48,
                fontWeight: 800,
                color: 'white',
                lineHeight: 1,
                letterSpacing: 0,
                fontVariantNumeric: 'tabular-nums'
              }}
            >
              {speed != null ? speed : '--'}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                data-testid="projection-gps-status-dot"
                className={telemetry.gpsFix === false ? 'moto-gps-acquiring-dot' : undefined}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: gpsDotColor,
                  boxShadow: `0 0 6px ${gpsDotColor}88`
                }}
              />
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: 1.2,
                  color: '#ccc',
                  whiteSpace: 'nowrap'
                }}
              >
                {gpsLabel}
              </span>
            </span>
          </span>
        )}
      </button>

      {/* Bare degree glyph (F implied, matching the CHT pills). Drops to 34px
          at 3-digit readings so the pill can't reach the 3-digit speed pill
          or the glass edge. */}
      <button
        type="button"
        onClick={() => actions.openMetric('ambientTemp')}
        style={{
          ...bandBase,
          right: 70,
          width: '24%',
          paddingBottom: 6,
          border: 0,
          background: 'transparent'
        }}
      >
        <span
          style={{
            ...pill,
            display: 'flex',
            alignItems: 'baseline',
            textShadow: NUM_SHADOW
          }}
        >
          <span
            style={{
              fontSize: telemetry.ambientF != null && telemetry.ambientF >= 100 ? 34 : 38,
              fontWeight: 800,
              color: 'white',
              lineHeight: 1,
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {telemetry.ambientF != null ? `${telemetry.ambientF}\u00b0` : '--'}
          </span>
        </span>
      </button>
    </div>
  )
}

// Memoized: props are primitives plus the stable actions object.
const ChtGauge = React.memo(ChtGaugeImpl)

function ChtGaugeImpl({
  side,
  value,
  lastValue,
  responding,
  readoutInBar = true,
  actions
}: {
  side: 'L' | 'R'
  value: number | null
  lastValue?: number | null
  responding?: boolean
  readoutInBar?: boolean
  actions: MotoActions
}) {
  const maxTemp = 200
  const barW = 72
  const vw = MOTO_ARC_STRIP_SIZE
  // Two readout placements (Advanced > "CHT Readout In Gauge"):
  // - in-bar (default): full-length bar with the number embedded in a
  //   darkened base segment — always centered, always over a dark chip so it
  //   reads on all four zone colors.
  // - below-bar: bar shortened 22px so a centered pill fits higher up
  //   (screen y≈532) where the glass is wide enough for 8px+ clearance;
  //   the old full-length layout could only fit an OFF-center pill.
  const barH = readoutInBar ? 268 : 246
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
  // Below-bar pill (readoutInBar=false): perfectly centered under the bar.
  // With the shortened bar it sits at strip y≈425 (screen ≈532) where a
  // 66x28 capsule keeps ~8.2px clearance from the glass — verified with the
  // capsule arc-center model. 26px is the largest numeral that fits "100°"
  // in the 66px pill.
  const numPillCX = textCX
  const numPillCY = barY + barH + 20
  const numPillW = 66
  const numPillH = 28
  // In-bar chip (readoutInBar=true): darkened base segment of the bar.
  const chipH = 46
  const chipY = barY + barH - chipH

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
        background: 'transparent',
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent'
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
        {/* Zone division lines: full-width, one quiet monochrome color — a
            "how close am I to the next line" reference (Byron), not a color
            signal (the fill color already carries the zone). */}
        {CHT_THRESHOLDS.map((t) => {
          const y = barY + barH - (t / maxTemp) * barH
          return (
            <line
              key={t}
              x1={barX}
              y1={y}
              x2={barX + barW}
              y2={y}
              stroke="rgba(255,255,255,0.4)"
              strokeWidth={1.5}
            />
          )
        })}
        {readoutInBar ? (
          <>
            {/* Darkened base segment of the thermometer carries the number —
                white on ~45% black stays readable over all four zone colors
                and over the empty (dark) bar. */}
            <rect
              data-testid={`projection-cht-pill-${side}`}
              x={barX}
              y={chipY}
              width={barW}
              height={chipH}
              rx={6}
              fill="rgba(0,0,0,0.45)"
            />
            <text
              x={textCX}
              y={chipY + 31}
              textAnchor="middle"
              fill="white"
              fontSize={28}
              fontWeight="bold"
              opacity={showStale ? 0.7 : 1}
              style={{ filter: SVG_TEXT_SHADOW, fontVariantNumeric: 'tabular-nums' }}
            >
              {hasData ? `${Math.round(displayValue as number)}°` : '--'}
            </text>
          </>
        ) : (
          <>
            <GaugePill
              data-testid={`projection-cht-pill-${side}`}
              cx={numPillCX}
              cy={numPillCY}
              width={numPillW}
              height={numPillH}
            />
            <text
              x={numPillCX}
              y={numPillCY + 9}
              textAnchor="middle"
              fill={!hasData ? 'white' : showStale ? '#c9a227' : color}
              fontSize={26}
              fontWeight="bold"
              opacity={showStale ? 0.85 : 1}
              style={{ filter: SVG_TEXT_SHADOW, fontVariantNumeric: 'tabular-nums' }}
            >
              {hasData ? `${Math.round(displayValue as number)}°` : '--'}
            </text>
          </>
        )}
        {showStale && (
          <text
            x={textCX}
            y={barY + barH + (readoutInBar ? 20 : 40)}
            textAnchor="middle"
            fill="#ffca28"
            fontSize={13}
            fontWeight="bold"
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
        )}
      </svg>
    </button>
  )
}

function BottomArc({
  telemetry,
  settings,
  actions
}: {
  telemetry: MotoTelemetry
  settings: MotoSettings | null
  actions: MotoActions
}) {
  const clipId = useSvgId('bottom-arc')
  const w = MOTO_CENTER_SQUARE_SIZE
  const h = MOTO_ARC_STRIP_SIZE
  const cx = w / 2
  const pitchScale = 2.5
  const refY = h / 2
  const ref = 'rgba(255,255,255,0.55)'
  const showLeanRuler = settings?.leanRulerEnabled === true
  const {
    lean: leanVal,
    pitch: pitchVal,
    totalG,
    absLean,
    side,
    absPitch,
    pitchDir
  } = deriveAttitude(telemetry, settings)
  const hasLean = telemetry.leanDeg != null
  const gpsLive = telemetry.gpsFix === true && telemetry.gpsResponding
  const gpsStale = !gpsLive && telemetry.altitudeFtLast != null
  const altValue = gpsLive ? telemetry.altitudeFt : telemetry.altitudeFtLast
  const altFt = altValue != null ? altValue.toLocaleString() : '--'
  const hasG = totalG != null
  const gVal = totalG ?? 0
  const gTextColor = !hasG ? '#444' : gColor(gVal)
  const horizonY = refY + pitchVal * pitchScale
  // Artificial-horizon convention: the world rotates OPPOSITE the vehicle's
  // bank. Lean left (negative) must show the ground climbing on the LEFT,
  // so the ground graphic rotates by -lean (rotating by +lean rendered the
  // horizon backwards — ground climbed right on a left lean).
  const rot = `rotate(${-leanVal}, ${cx}, ${horizonY})`
  const pitchLines = [-15, -10, -5, 5, 10, 15].map((p) => ({
    y: horizonY - p * pitchScale,
    len: Math.abs(p) % 10 === 0 ? 120 : 70,
    label: Math.abs(p) % 10 === 0 ? Math.abs(p) : null
  }))
  // Every readout is a uniform two-line capsule (label+unit line over a big
  // value) on shared baselines, placed in the widest part of the bottom band
  // so nothing is clipped by the round display. ALT (left) and G (right)
  // mirror each other on the same top row; lean sits in a matching capsule
  // centered under the horizon. Same height + radius.
  // 2026-07 size-max pass: every capsule grown to the largest size that keeps
  // ~8px+ clearance from the round glass (capsule arc-center model), a 2px+
  // gap below the CarPlay square (band top), and no overlap between the ALT/G
  // row (y ~696–750) and the lean pill row (y ~751–789).
  const rowCY = 30 // vertical center of the ALT / G row
  const rowH = 54 // capsule height
  const rowW = 142 // capsule width
  const altCX = 172 // ALT capsule center (left) — as far outward as the round
  // glass allows with margin: 10.3px clearance at this width (8px is the
  // floor; 13px further out would touch it). See the circle-safe model.
  const gCX = w - altCX // G capsule center (right) — exact mirror of ALT
  const leanW = 112
  const leanCY = 77 // keeps ~9px clearance from the bottom of the glass at
  // the taller pill height
  const leanH = 38
  const pitchCY = 17 // pitch chip center / height
  const pitchH = 30
  // Tap zones derived from the capsule geometry so moving a capsule can't
  // orphan its hit area (they were hand-tuned pixels before, and the top of
  // the lean pill actually landed in the pitch zone). Each boundary is the
  // midpoint between neighboring capsules; lean gets the taller lower slice
  // of the center column since it's the most-glanced readout.
  const centerZoneLeft = (altCX + rowW / 2 + (cx - leanW / 2)) / 2
  const centerZoneRight = w - centerZoneLeft
  const pitchLeanSplit = (pitchCY + pitchH / 2 + (leanCY - leanH / 2)) / 2

  return (
    <div
      style={{ width: '100%', height: '100%', background: 'transparent' }}
      data-testid="projection-bottom-arc"
    >
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height="100%"
        style={{ display: 'block', filter: SVG_TEXT_SHADOW }}
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
            <rect x={-w} y={horizonY} width={3 * w} height={3 * h} fill="rgba(92,52,18,0.55)" />
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
        {/* Fixed ADI reference wings: monochrome (color = state only) and
            off by default — Advanced > "Lean Ruler" brings them back. */}
        {showLeanRuler && (
          <>
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
          </>
        )}
        <GaugePill cx={cx} cy={pitchCY} width={74} height={pitchH} />
        <text
          x={cx}
          y={pitchCY + 6}
          textAnchor="middle"
          fill="white"
          fontSize={18}
          fontWeight="bold"
        >
          {telemetry.pitchDeg != null
            ? absPitch === 0
              ? '\u2014'
              : `${pitchDir}${absPitch}\u00b0`
            : '--'}
        </text>

        <g>
          <GaugePill cx={altCX} cy={rowCY} width={rowW} height={rowH} />
          <text
            x={altCX}
            y={rowCY - 12}
            textAnchor="middle"
            fill="rgba(255,255,255,0.75)"
            fontSize={15}
            fontWeight="bold"
            letterSpacing={2}
          >
            ALT
          </text>
          <text
            x={altCX}
            y={rowCY + 17}
            textAnchor="middle"
            fill={altValue != null ? '#f0f0f0' : 'white'}
            fontSize={26}
            fontWeight="bold"
          >
            {altFt}
            <tspan fontSize={15} fill="rgba(255,255,255,0.7)" dx={4}>
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
        </g>

        <g>
          <GaugePill cx={cx} cy={leanCY} width={leanW} height={leanH} />
          {telemetry.imuRecalibrating ? (
            // The lean value is unreliable while the IMU recalibrates, so the
            // pill itself carries the state \u2014 larger and well inside the glass
            // instead of an 11px caption 7px from the bottom edge.
            <text
              x={cx}
              y={leanCY + 5}
              textAnchor="middle"
              fill="#ffca28"
              fontSize={14}
              fontWeight="bold"
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
          ) : (
            <text
              x={cx}
              y={leanCY + 8}
              textAnchor="middle"
              fill="white"
              fontSize={24}
              fontWeight="bold"
            >
              {hasLean ? (absLean > 0 ? `${absLean}\u00b0 ${side}` : `0\u00b0`) : '--'}
            </text>
          )}
        </g>

        <g>
          <GaugePill cx={gCX} cy={rowCY} width={rowW} height={rowH} />
          <text
            x={gCX}
            y={rowCY - 12}
            textAnchor="middle"
            fontSize={15}
            fontWeight="bold"
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
            y={rowCY + 17}
            textAnchor="middle"
            fill={hasG ? gTextColor : 'white'}
            fontSize={26}
            fontWeight="bold"
          >
            {hasG ? gVal.toFixed(1) : '--'}
          </text>
        </g>

        <rect
          x={0}
          y={0}
          width={centerZoneLeft}
          height={h}
          fill="transparent"
          style={{ cursor: 'pointer' }}
          onClick={() => actions.openMetric('altitude')}
        />
        <rect
          x={centerZoneRight}
          y={0}
          width={w - centerZoneRight}
          height={h}
          fill="transparent"
          style={{ cursor: 'pointer' }}
          onClick={() => actions.openMetric('gForce')}
        />
        <rect
          x={centerZoneLeft}
          y={0}
          width={centerZoneRight - centerZoneLeft}
          height={pitchLeanSplit}
          fill="transparent"
          style={{ cursor: 'pointer' }}
          onClick={() => actions.openMetric('pitchAngle')}
        />
        <rect
          x={centerZoneLeft}
          y={pitchLeanSplit}
          width={centerZoneRight - centerZoneLeft}
          height={h - pitchLeanSplit}
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
      <PanelEmptyState
        title={telemetry.gpsFix === null ? 'NO GPS RECEIVER' : 'WAITING FOR SATELLITES\u2026'}
        detail={
          telemetry.gpsFix === null
            ? 'check the USB GPS connection'
            : `${telemetry.gpsSatellites} sat${telemetry.gpsSatellites === 1 ? '' : 's'} so far`
        }
      />
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
        padding: '8px 12px 6px 10px'
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
              letterSpacing: 1
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
  // Hook must run before the early return below — otherwise the hook count
  // changes when IMU data first arrives with this panel open, and React
  // throws (rules of hooks).
  const attitudeClip = useSvgId('ride-attitude')

  if (telemetry.leanDeg === null && telemetry.gForceX === null) {
    return <PanelEmptyState title="NO IMU DATA" />
  }

  const attitude = deriveAttitude(telemetry, settings)
  const { lean, pitch, absLean, side, absPitch, pitchDir } = attitude
  const gx = telemetry.gForceX ?? 0
  const gy = telemetry.gForceY ?? 0
  const totalG = attitude.totalG ?? 0

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
        padding: '6px 12px 4px 8px'
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
    return <PanelEmptyState title="NO CYLINDER-HEAD DATA" />
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
          letterSpacing: 3
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
            lineHeight: 1
          }}
        >
          {s.has ? Math.round(s.temp as number) : '--'}
        </span>
        <span style={{ color: '#bbb', fontSize: 16, fontWeight: 700 }}>{'\u00b0C'}</span>
      </div>
      <div
        style={{
          color: s.has ? s.zone.color : '#777',
          fontSize: 14,
          fontWeight: 800,
          letterSpacing: 2
        }}
      >
        {s.zone.label}
      </div>
      <div style={{ color: '#aaa', fontSize: 12, fontWeight: 700 }}>
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
        padding: '8px 12px 4px'
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
            letterSpacing: 2
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
            lineHeight: 1
          }}
        >
          {delta !== null ? `${delta}\u00b0` : '\u2014'}
        </span>
      </div>
      {side(right, 1)}
    </div>
  )
}

function MetricGraph({
  metricKey,
  telemetry,
  settings,
  dataRef,
  actions,
  historyRevision
}: {
  metricKey: MetricKey
  telemetry: MotoTelemetry
  settings: MotoSettings | null
  dataRef: React.MutableRefObject<Record<MetricKey, DataPoint[]>>
  actions: MotoActions
  historyRevision: number
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
  // Settings gear on EVERY graph page (Byron) — the header strip always has
  // room beside the close button.
  const showSettingsShortcut = true
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
        top: `calc(${ARC_PCT} - 2px)`,
        left: `calc(${ARC_PCT} - 2px)`,
        width: `calc(${SQUARE_PCT} + 4px)`,
        height: `calc(${SQUARE_PCT} + 4px)`,
        background: '#000',
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        userSelect: 'none',
        pointerEvents: 'auto'
      }}
    >
      {/* Sheet-style header strip (Apple Maps/Health sheets): the gear and
          close button get their own row ABOVE the cards, so they can never
          float over card content (GPS stats, MAX/MIN columns, panel labels). */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: 12,
          padding: '8px 12px 0'
        }}
      >
        {showSettingsShortcut && (
          <button
            type="button"
            aria-label="Open settings from graph"
            data-testid="projection-graph-settings-button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={openSettings}
            style={headerBtnWrap}
          >
            <span style={graphSettingsBtn}>
              <SettingsOutlinedIcon style={{ fontSize: 27 }} />
            </span>
          </button>
        )}
        <button
          type="button"
          aria-label="Close graph"
          onPointerDown={closeHoldStart}
          onPointerUp={closeHoldEnd}
          onPointerLeave={closeHoldCancel}
          style={headerBtnWrap}
          title={'tap to close \u00b7 hold to quit app'}
        >
          <span style={closeBtn}>{'\u00d7'}</span>
        </button>
      </div>

      {topPanel && (
        <div style={{ ...graphCard, marginBottom: 0 }}>
          {topPanel === 'gps' && <GpsSkyPanel telemetry={telemetry} />}
          {topPanel === 'imu' && (
            <RideDynamicsPanel telemetry={telemetry} settings={settings} actions={actions} />
          )}
          {topPanel === 'cht' && <CylinderHeadsPanel telemetry={telemetry} actions={actions} />}
        </div>
      )}

      {keys.map((key, index) => (
        <GraphPane
          key={key}
          metricKey={key}
          nowMs={nowMs}
          compact={compact}
          dataRef={dataRef}
          actions={actions}
          historyRevision={historyRevision}
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
            gap: 10
          }}
        >
          <div
            style={{
              color: 'white',
              fontSize: 44,
              fontWeight: 700,
              letterSpacing: 0.2,
              textAlign: 'center'
            }}
          >
            Quit motoCarPlay?
          </div>
          <div style={{ color: 'rgba(235,235,245,0.6)', fontSize: 17, marginBottom: 26 }}>
            This closes the dashboard
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: 320 }}>
            <button
              type="button"
              onClick={() => {
                void window.projection.quit()
              }}
              style={bigAlertBtn('#e0322e', '#ffffff')}
            >
              Quit
            </button>
            <button
              type="button"
              onClick={() => setConfirmQuit(false)}
              style={bigAlertBtn('rgba(255,255,255,0.1)', '#ffffff')}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Memoized: all props are primitives or stable refs, and the graph only needs
// to redraw when nowMs ticks (1 Hz) — not on every telemetry commit.
const GraphPane = React.memo(GraphPaneImpl)

function GraphPaneImpl({
  metricKey,
  nowMs,
  compact,
  dataRef,
  actions
}: {
  metricKey: MetricKey
  nowMs: number
  compact: boolean
  dataRef: React.MutableRefObject<Record<MetricKey, DataPoint[]>>
  actions: MotoActions
  // Not read directly — included so React.memo re-renders the pane the
  // instant graph history is cleared (the data lives in a mutable ref).
  historyRevision: number
}) {
  const cfg = METRIC_CONFIG[metricKey]
  const data = dataRef.current[metricKey]
  const [viewOffset, setViewOffset] = React.useState(0)
  const [confirmReset, setConfirmReset] = React.useState(false)
  const panRef = React.useRef({ active: false, startX: 0, startOff: 0 })
  // The chart's viewBox matches the MEASURED container, so the plot fills
  // the card edge-to-edge at 1:1 pixels. The old fixed 586x222 viewBox with
  // "meet" letterboxed the chart to ~half the card (scaled to fit height,
  // centered with dead margins on both sides). jsdom (tests) measures 0x0
  // and falls back to the legacy static geometry.
  const chartBoxRef = React.useRef<HTMLDivElement>(null)
  const [chartBox, setChartBox] = React.useState<{ w: number; h: number } | null>(null)
  React.useEffect(() => {
    const el = chartBoxRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 60 && r.height > 60) {
        setChartBox((cur) => {
          const w = Math.round(r.width)
          const h = Math.round(r.height)
          return cur && cur.w === w && cur.h === h ? cur : { w, h }
        })
      }
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const fallback = motoGraphPaneGeometry(compact)
  const svgW = chartBox?.w ?? fallback.svgW
  const svgH = chartBox?.h ?? fallback.svgH
  const cx = chartBox ? 48 : fallback.cx
  const cy = chartBox ? 10 : fallback.cy
  const cw = chartBox ? svgW - cx - 14 : fallback.cw
  const ch = chartBox ? svgH - cy - 32 : fallback.ch
  const windowEnd = nowMs - viewOffset
  const windowStart = windowEnd - GRAPH_WINDOW_MS
  const visible = data.filter((p) => p.ts >= windowStart - 5000 && p.ts <= windowEnd + 5000)
  const vals = visible.map((p) => p.val)
  const rawMin = vals.length ? Math.min(...vals) : 0
  const rawMax = vals.length ? Math.max(...vals) : 1
  const center = (rawMax + rawMin) / 2
  const span = Math.max(rawMax - rawMin, cfg.minRange)
  // 8% headroom (was 15%): together with the tightened minRange floors this
  // lets a steady reading fill ~2x more of the plot height — flat temps and
  // parked lean/speed used to draw a sliver under a tall empty grid.
  const pad = span * 0.08
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
  const visMin = vals.length ? rawMin : null
  const visMax = vals.length ? rawMax : null
  const zones = cfg.zones
  const zoneOf = (v: number) => zones?.find((z) => v <= z.max) ?? zones?.[zones.length - 1]
  // Zoned metrics color the numeral by zone; the rest tint it with the
  // metric's own color (Apple Fitness style) instead of plain white.
  const valueColor = zones && current !== null ? (zoneOf(current)?.color ?? cfg.color) : cfg.color
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
    <div style={{ ...graphCard, flex: 1 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 14px 0',
          flexShrink: 0
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: 1.2,
              color: cfg.color
            }}
          >
            {cfg.label}
          </span>
          {isLive ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 15,
                color: 'rgba(235,235,245,0.6)',
                fontWeight: 600,
                letterSpacing: 0.3
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#30d158',
                  flex: '0 0 auto'
                }}
              />
              LIVE
            </span>
          ) : (
            <span
              style={{
                fontSize: 15,
                color: '#ffffff',
                fontWeight: 600,
                letterSpacing: 0.3
              }}
            >
              {Math.round(viewOffset / 60000)}m ago
            </span>
          )}
        </div>
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
              fontSize: compact ? 50 : 92,
              fontWeight: 800,
              color: valueColor,
              lineHeight: 0.88,
              letterSpacing: compact ? 0 : -1,
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {current !== null ? cfg.fmtVal(current) : '--'}
          </span>
          <span
            style={{
              fontSize: compact ? 20 : 28,
              fontWeight: 600,
              color: 'rgba(235,235,245,0.6)'
            }}
          >
            {cfg.unit}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              fontSize: 19,
              color: 'rgba(235,235,245,0.6)',
              fontWeight: 600,
              textAlign: 'right',
              lineHeight: 1.4,
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {visMax !== null && <div>MAX {cfg.fmtVal(visMax)}</div>}
            {visMin !== null && <div>MIN {cfg.fmtVal(visMin)}</div>}
          </div>
          {confirmReset ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                style={graphResetBtn('rgba(255,255,255,0.12)', '#ffffff')}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  resetMetric()
                  setConfirmReset(false)
                }}
                style={graphResetBtn('#e0322e', '#ffffff')}
              >
                Confirm
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              style={graphResetBtn('rgba(255,69,58,0.16)', '#ff453a')}
            >
              Reset
            </button>
          )}
        </div>
      </div>
      <div ref={chartBoxRef} style={{ flex: 1, minHeight: 0 }}>
        <svg
          data-testid={`projection-metric-graph-chart-${metricKey}`}
          viewBox={`0 0 ${svgW} ${svgH}`}
          width="100%"
          height="100%"
          style={{
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
              <stop offset="0%" stopColor={cfg.color} stopOpacity="0.42" />
              <stop offset="100%" stopColor={cfg.color} stopOpacity="0.05" />
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
            fill="rgba(255,255,255,0.04)"
            rx={8}
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
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth={1}
                />
                <text
                  x={cx - 5}
                  y={y + 5}
                  textAnchor="end"
                  fill="rgba(235,235,245,0.55)"
                  fontSize={15}
                  fontWeight={600}
                  style={{ fontVariantNumeric: 'tabular-nums' }}
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
                stroke="rgba(255,255,255,0.08)"
                strokeWidth={1}
              />
              <text
                x={x}
                y={cy + ch + 18}
                textAnchor="middle"
                fill="rgba(235,235,245,0.55)"
                fontSize={15}
                fontWeight={600}
                style={{ fontVariantNumeric: 'tabular-nums' }}
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
    </div>
  )
}

export function motoGraphPaneGeometry(compact: boolean) {
  const svgW = MOTO_CENTER_SQUARE_SIZE
  const cx = 58
  const cy = 8
  // 66-unit right margin (was 10): reserves the card's bottom-right corner
  // for the floating Reset capsule so it never covers the newest data at
  // the plot's right edge (verified ~11px gap on-device).
  const cw = svgW - cx - 66
  const ch = compact ? 176 : 382
  const svgH = cy + ch + (compact ? 38 : 64)
  return { svgW, svgH, cx, cy, cw, ch }
}

// Full-size alert buttons (Apple action-sheet style): stacked, wide, 76px
// tall — the biggest tap targets on the screen, for the decisions that
// matter (Quit / Reboot).
const bigAlertBtn = (bg: string, fg: string): React.CSSProperties => ({
  background: bg,
  border: 0,
  color: fg,
  borderRadius: 20,
  height: 76,
  width: '100%',
  fontSize: 22,
  fontWeight: 600,
  letterSpacing: 0.2,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  touchAction: 'manipulation',
  WebkitTapHighlightColor: 'transparent'
})

// Graph-page action buttons: Apple tinted capsules — translucent tint fill,
// no border, capsule radius, >=60px tall for gloved taps.
const actionBtn = (bg: string, fg: string, compact = false): React.CSSProperties => ({
  background: bg,
  border: 0,
  color: fg,
  borderRadius: 999,
  height: compact ? 60 : 64,
  minWidth: compact ? 116 : 132,
  padding: compact ? '0 24px' : '0 28px',
  fontSize: compact ? 17 : 18,
  fontWeight: 600,
  letterSpacing: 0.2,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  touchAction: 'manipulation',
  WebkitTapHighlightColor: 'transparent'
})

// In-flow header-strip button: 76x64 tap zone (glove-friendly) around the
// smaller visible face — the hit area grows, the artwork doesn't.
const headerBtnWrap: React.CSSProperties = {
  width: 76,
  height: 64,
  background: 'transparent',
  border: 0,
  padding: 0,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  touchAction: 'manipulation',
  WebkitTapHighlightColor: 'transparent'
}

const closeBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.07)',
  border: '2px solid rgba(255,255,255,0.22)',
  color: 'white',
  borderRadius: '50%',
  width: 56,
  height: 56,
  fontSize: 30,
  fontWeight: 500,
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  flexShrink: 0
}

// Apple Health dark-mode surface: each graph/panel section is an elevated
// #1c1c1e card on the black pane instead of a divider-separated void.
// position:relative anchors the card's bottom-right Reset capsule.
const graphCard: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  margin: '10px 12px',
  background: '#1c1c1e',
  borderRadius: 20,
  overflow: 'hidden',
  position: 'relative'
}

// Slim tinted capsule for the in-card Reset/confirm — narrower than the
// dialog capsules so it fits the empty band right of the centered chart.
const graphResetBtn = (bg: string, fg: string): React.CSSProperties => ({
  background: bg,
  border: 0,
  color: fg,
  borderRadius: 999,
  height: 56,
  padding: '0 22px',
  fontSize: 16,
  fontWeight: 600,
  letterSpacing: 0.2,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  touchAction: 'manipulation',
  WebkitTapHighlightColor: 'transparent'
})

// Circular, matching the close ✕ face it now sits beside.
const graphSettingsBtn: React.CSSProperties = {
  width: 56,
  height: 56,
  borderRadius: '50%',
  border: '2px solid rgba(255,255,255,0.22)',
  background: 'rgba(255,255,255,0.07)',
  color: 'white',
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0
}

export function ProjectionSensorOverlay() {
  const settings = useLiviStore((s) => s.settings)
  const { pathname } = useLocation()
  const motoSettings = settings as MotoSettings | null
  const { telemetry, activeGraph, dataRef, actions, historyRevision } =
    useMotoTelemetry(motoSettings)

  React.useEffect(() => {
    if (pathname !== '/') actions.closeMetric()
  }, [actions, pathname])

  return (
    <div
      data-testid="projection-sensor-overlay"
      className="moto-overlay"
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
        <TopArc telemetry={telemetry} actions={actions} />
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
        <BottomArc telemetry={telemetry} settings={motoSettings} actions={actions} />
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
          readoutInBar={motoSettings?.chtReadoutInBar !== false}
          actions={actions}
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
          readoutInBar={motoSettings?.chtReadoutInBar !== false}
          actions={actions}
        />
      </div>

      {activeGraph && (
        <MetricGraph
          metricKey={activeGraph}
          telemetry={telemetry}
          settings={motoSettings}
          dataRef={dataRef}
          actions={actions}
          historyRevision={historyRevision}
        />
      )}
    </div>
  )
}
