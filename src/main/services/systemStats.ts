import { readFileSync, statfsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { networkInterfaces } from 'node:os'

export type PowerStatus = {
  // Raw bitmask from `vcgencmd get_throttled` (null when unavailable)
  throttledRaw: number | null
  underVoltageNow: boolean
  underVoltageOccurred: boolean
  throttledNow: boolean
  throttledOccurred: boolean
  freqCappedNow: boolean
  // Core voltage (V) from `vcgencmd measure_volts`
  coreVolts: number | null
  // Pi 5 input rail voltage (V) from `vcgencmd pmic_read_adc EXT5V_V`
  inputVolts: number | null
  // Pi 5 USB power budget: true when the firmware unlocked full 1.6A
  // (detected/trusted 5A supply), false when capped to 600mA, null if unknown.
  // From `vcgencmd get_config usb_max_current_enable`.
  usbHighCurrent: boolean | null
}

export type SystemStats = {
  cpu?: number
  cores?: number[]
  memUsedMb?: number | null
  memTotalMb?: number | null
  memPct?: number | null
  diskFreeMb?: number | null
  diskTotalMb?: number | null
  diskPct?: number | null
  swapUsedMb?: number | null
  tempC?: number | null
  load?: number[] | null
  uptime?: number | null
  power?: PowerStatus | null
  wiredIp?: string | null
  wirelessIp?: string | null
  error?: string
}

type NetIfaceAddr = { address: string; family: string | number; internal: boolean }
type ReadNetInterfaces = () => Record<string, NetIfaceAddr[] | undefined>

type CpuSnapshot = Record<string, number[]>
type ReadText = (path: string) => string
type StatFsResult = { bsize: number; blocks: number; bavail: number }
type StatFs = (path: string) => StatFsResult
type ExecText = (cmd: string) => string
type Sleep = (ms: number) => Promise<void>

const defaultReadText: ReadText = (path) => readFileSync(path, 'utf8')
const defaultStatFs: StatFs = (path) => statfsSync(path)
const defaultExecText: ExecText = (cmd) =>
  execSync(cmd, { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] })
const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const defaultReadNetInterfaces: ReadNetInterfaces = () =>
  networkInterfaces() as Record<string, NetIfaceAddr[] | undefined>

// `vcgencmd get_throttled` bit meanings (https://www.raspberrypi.com/documentation)
const THROTTLE_UNDERVOLTAGE_NOW = 0x1
const THROTTLE_FREQ_CAPPED_NOW = 0x2
const THROTTLE_THROTTLED_NOW = 0x4
const THROTTLE_UNDERVOLTAGE_OCCURRED = 0x10000
const THROTTLE_THROTTLED_OCCURRED = 0x40000

export function parseThrottled(text: string): number | null {
  const match = text.match(/throttled=0x([0-9a-fA-F]+)/)
  if (!match) return null
  const value = Number.parseInt(match[1], 16)
  return Number.isFinite(value) ? value : null
}

export function parseVolts(text: string): number | null {
  const match = text.match(/volt=([0-9.]+)V/)
  if (!match) return null
  const value = Number.parseFloat(match[1])
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null
}

// pmic_read_adc prints lines like "EXT5V_V volt(24)=4.95781250V"
export function parsePmicVolts(text: string, label: string): number | null {
  const match = text.match(new RegExp(`${label}\\s+volt\\([0-9]+\\)=([0-9.]+)V`))
  if (!match) return null
  const value = Number.parseFloat(match[1])
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null
}

// `vcgencmd get_config usb_max_current_enable` prints "usb_max_current_enable=1".
// 1 => USB unlocked to full 1.6A (5A supply trusted); 0 => capped to 600mA.
export function parseUsbMaxCurrent(text: string): boolean | null {
  const match = text.match(/usb_max_current_enable=(-?\d+)/)
  if (!match) return null
  return Number.parseInt(match[1], 10) === 1
}

export function readPowerStatus(execText: ExecText): PowerStatus | null {
  const throttledRaw = tryRead(() => parseThrottled(execText('vcgencmd get_throttled')), null)
  const coreVolts = tryRead(() => parseVolts(execText('vcgencmd measure_volts')), null)
  const inputVolts = tryRead(
    () => parsePmicVolts(execText('vcgencmd pmic_read_adc EXT5V_V'), 'EXT5V_V'),
    null
  )
  const usbHighCurrent = tryRead(
    () => parseUsbMaxCurrent(execText('vcgencmd get_config usb_max_current_enable')),
    null as boolean | null
  )

  if (
    throttledRaw === null &&
    coreVolts === null &&
    inputVolts === null &&
    usbHighCurrent === null
  ) {
    return null
  }

  const bits = throttledRaw ?? 0
  return {
    throttledRaw,
    underVoltageNow: (bits & THROTTLE_UNDERVOLTAGE_NOW) !== 0,
    freqCappedNow: (bits & THROTTLE_FREQ_CAPPED_NOW) !== 0,
    throttledNow: (bits & THROTTLE_THROTTLED_NOW) !== 0,
    underVoltageOccurred: (bits & THROTTLE_UNDERVOLTAGE_OCCURRED) !== 0,
    throttledOccurred: (bits & THROTTLE_THROTTLED_OCCURRED) !== 0,
    coreVolts,
    inputVolts,
    usbHighCurrent
  }
}

// Categorise the host's IPv4 addresses into wired vs wireless so the monitor can
// show both. Skips loopback / link-local / internal interfaces. When several
// interfaces match a category, the first non-link-local address wins.
export function pickIpAddresses(ifaces: Record<string, NetIfaceAddr[] | undefined>): {
  wired: string | null
  wireless: string | null
} {
  let wired: string | null = null
  let wireless: string | null = null
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue
    for (const addr of addrs) {
      const isV4 = addr.family === 'IPv4' || addr.family === 4
      if (!isV4 || addr.internal) continue
      if (addr.address.startsWith('169.254.')) continue
      if (/^(wlan|wl)/.test(name)) {
        if (wireless === null) wireless = addr.address
      } else if (/^(eth|en|end)/.test(name)) {
        if (wired === null) wired = addr.address
      } else if (wired === null) {
        // Unknown interface naming: treat as wired so it still surfaces.
        wired = addr.address
      }
    }
  }
  return { wired, wireless }
}

export function parseCpuSnapshot(text: string): CpuSnapshot {
  const out: CpuSnapshot = {}
  for (const line of text.split('\n')) {
    if (!line.startsWith('cpu')) continue
    const parts = line.trim().split(/\s+/)
    out[parts[0]] = parts.slice(1).map(Number)
  }
  return out
}

export function cpuPct(a: number[] | undefined, b: number[] | undefined): number {
  if (!a || !b) return 0
  const idleA = a[3] + (a[4] || 0)
  const idleB = b[3] + (b[4] || 0)
  const totalA = a.reduce((sum, n) => sum + n, 0)
  const totalB = b.reduce((sum, n) => sum + n, 0)
  const totalDelta = totalB - totalA
  const idleDelta = idleB - idleA

  if (totalDelta <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 100)))
}

function parseMemKb(meminfo: string, key: string): number | null {
  const match = meminfo.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'))
  return match ? Number.parseInt(match[1], 10) : null
}

function tryRead<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}
export async function readSystemStats({
  readText = defaultReadText,
  statfs = defaultStatFs,
  execText = defaultExecText,
  sleep = defaultSleep,
  readNetInterfaces = defaultReadNetInterfaces,
  sampleMs = 240
}: {
  readText?: ReadText
  statfs?: StatFs
  execText?: ExecText
  sleep?: Sleep
  readNetInterfaces?: ReadNetInterfaces
  sampleMs?: number
} = {}): Promise<SystemStats> {
  const start = parseCpuSnapshot(readText('/proc/stat'))
  await sleep(sampleMs)
  const end = parseCpuSnapshot(readText('/proc/stat'))

  const cores: number[] = []
  for (let i = 0; start[`cpu${i}`] && end[`cpu${i}`]; i += 1) {
    cores.push(cpuPct(start[`cpu${i}`], end[`cpu${i}`]))
  }

  const meminfo = readText('/proc/meminfo')
  const memTotal = parseMemKb(meminfo, 'MemTotal')
  const memAvail = parseMemKb(meminfo, 'MemAvailable')
  const swapTotal = parseMemKb(meminfo, 'SwapTotal')
  const swapFree = parseMemKb(meminfo, 'SwapFree')
  const memUsed = memTotal != null && memAvail != null ? memTotal - memAvail : null
  const swapUsed = swapTotal != null && swapFree != null ? swapTotal - swapFree : null

  const tempC = tryRead(
    () => {
      const milliC = Number.parseInt(readText('/sys/class/thermal/thermal_zone0/temp').trim(), 10)
      return Number.isFinite(milliC) ? Math.round((milliC / 1000) * 10) / 10 : null
    },
    null as number | null
  )

  const load = tryRead(
    () => readText('/proc/loadavg').trim().split(/\s+/).slice(0, 3).map(Number),
    null as number[] | null
  )

  const uptime = tryRead(
    () => {
      const seconds = Number.parseFloat(readText('/proc/uptime').split(' ')[0])
      return Number.isFinite(seconds) ? Math.round(seconds) : null
    },
    null as number | null
  )

  const disk = tryRead(
    () => {
      const root = statfs('/')
      const totalBytes = root.blocks * root.bsize
      const freeBytes = root.bavail * root.bsize
      const usedBytes = totalBytes - freeBytes

      if (totalBytes <= 0 || freeBytes < 0 || usedBytes < 0) {
        return { freeMb: null, totalMb: null, pct: null }
      }

      return {
        freeMb: Math.round(freeBytes / 1024 / 1024),
        totalMb: Math.round(totalBytes / 1024 / 1024),
        pct: Math.round((usedBytes / totalBytes) * 100)
      }
    },
    null as { freeMb: number | null; totalMb: number | null; pct: number | null } | null
  )

  const power = tryRead(() => readPowerStatus(execText), null as PowerStatus | null)
  const ips = tryRead(() => pickIpAddresses(readNetInterfaces()), {
    wired: null as string | null,
    wireless: null as string | null
  })

  return {
    cpu: cpuPct(start.cpu, end.cpu),
    cores,
    memUsedMb: memUsed != null ? Math.round(memUsed / 1024) : null,
    memTotalMb: memTotal != null ? Math.round(memTotal / 1024) : null,
    memPct: memUsed != null && memTotal ? Math.round((memUsed / memTotal) * 100) : null,
    diskFreeMb: disk?.freeMb ?? null,
    diskTotalMb: disk?.totalMb ?? null,
    diskPct: disk?.pct ?? null,
    swapUsedMb: swapUsed != null ? Math.round(swapUsed / 1024) : null,
    tempC,
    load,
    uptime,
    power,
    wiredIp: ips.wired,
    wirelessIp: ips.wireless
  }
}
