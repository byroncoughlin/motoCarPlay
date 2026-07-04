import * as React from 'react'

const POLL_MS = 1000

const heat = (value: number, warm: number, hot: number): string =>
  value >= hot ? '#ef5350' : value >= warm ? '#ffca28' : '#66bb6a'

const formatUptime = (seconds: number): string => {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

const formatStorage = (mb: number): string => {
  if (mb >= 10240) return `${Math.round(mb / 1024)} GB`
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}

const formatDisk = (stats: SystemStats): string => {
  if (stats.diskFreeMb == null) return '--'
  if (stats.diskTotalMb == null || stats.diskTotalMb <= 0)
    return `${formatStorage(stats.diskFreeMb)} free`

  const freePct = Math.round((stats.diskFreeMb / stats.diskTotalMb) * 100)
  return `${formatStorage(stats.diskFreeMb)} / ${formatStorage(stats.diskTotalMb)} - ${freePct}% free`
}

// Colour a load-average sample by how hard it works the available cores:
// green under ~70% of cores busy, amber up to fully busy, red oversubscribed.
const loadHeat = (value: number, cores: number): string => {
  const n = cores > 0 ? cores : 4
  if (value >= n) return '#ef5350'
  if (value >= n * 0.7) return '#ffca28'
  return '#66bb6a'
}

const loadRow = (
  load: number[] | null | undefined,
  cores: number
): React.ReactElement => {
  const periods = ['1m', '5m', '15m']
  return (
    <div
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}
    >
      <span style={{ color: '#9aa0a6', fontSize: 15, letterSpacing: 1, fontWeight: 600 }}>
        LOAD AVG
      </span>
      <span style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
        {!load || load.length < 3
          ? '--'
          : periods.map((period, index) => (
              <span key={period} style={{ display: 'inline-flex', gap: 4, alignItems: 'baseline' }}>
                <span style={{ color: '#8b9096', fontSize: 13, fontWeight: 600 }}>{period}</span>
                <span
                  style={{
                    color: loadHeat(load[index], cores),
                    fontFamily: 'monospace',
                    fontSize: 24,
                    fontWeight: 800
                  }}
                >
                  {load[index].toFixed(2)}
                </span>
              </span>
            ))}
      </span>
    </div>
  )
}

const formatPower = (power: PowerStatus): string => {
  const usb =
    power.usbHighCurrent === true
      ? 'FULL USB'
      : power.usbHighCurrent === false
        ? 'USB 600mA'
        : null
  const suffix = usb ? ` - ${usb}` : ''
  if (power.underVoltageNow) return `UNDERVOLT NOW${suffix}`
  if (power.throttledNow) return `THROTTLED NOW${suffix}`
  const volts =
    power.inputVolts != null
      ? `${power.inputVolts.toFixed(2)}V`
      : power.coreVolts != null
        ? `${power.coreVolts.toFixed(2)}V core`
        : null
  if (power.underVoltageOccurred || power.throttledOccurred) {
    return `${volts ? `${volts} - ` : ''}dip seen${suffix}`
  }
  return `${volts ? `${volts} OK` : 'OK'}${suffix}`
}

const statRow = (label: string, value: string, color?: string): React.ReactElement => (
  <div
    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}
  >
    <span style={{ color: '#9aa0a6', fontSize: 15, letterSpacing: 1, fontWeight: 600 }}>
      {label}
    </span>
    <span
      style={{
        color: color ?? '#e8eaed',
        fontFamily: 'monospace',
        fontSize: 24,
        fontWeight: 800
      }}
    >
      {value}
    </span>
  </div>
)

const stopPointer = (event: React.PointerEvent): void => {
  event.stopPropagation()
}

export function SystemMonitor(): React.ReactElement | null {
  const [open, setOpen] = React.useState(false)
  const [stats, setStats] = React.useState<SystemStats | null>(null)
  const openRef = React.useRef(open)
  openRef.current = open
  const statsReaderAvailable = typeof window.app?.systemStats === 'function'

  React.useEffect(() => {
    const onOpenMonitor = (): void => {
      setOpen(true)
    }

    window.addEventListener('livi:open-system-monitor', onOpenMonitor)

    return () => {
      window.removeEventListener('livi:open-system-monitor', onOpenMonitor)
    }
  }, [])

  React.useEffect(() => {
    if (!open || typeof window.app?.systemStats !== 'function') return undefined

    let alive = true
    const readStats = async (): Promise<void> => {
      try {
        const nextStats = await window.app.systemStats()
        if (alive) setStats(nextStats)
      } catch {
        // Keep the monitor passive if one sample fails.
      }
    }

    void readStats()
    const interval = window.setInterval(() => {
      void readStats()
    }, POLL_MS)

    return () => {
      alive = false
      window.clearInterval(interval)
    }
  }, [open])

  if (!open) return null

  const cpu = stats?.cpu ?? 0
  const closeMonitor = (event: React.MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    setOpen(false)
  }

  return (
    <div
      data-testid="projection-system-monitor-backdrop"
      onPointerDown={stopPointer}
      onPointerUp={stopPointer}
      onClick={closeMonitor}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 4000,
        background: 'rgba(0,0,0,0.92)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none'
      }}
    >
      <div
        data-testid="projection-system-monitor"
        onPointerDown={stopPointer}
        onPointerUp={stopPointer}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'calc(min(100vw, 100vh) * 0.706)',
          height: 'calc(min(100vw, 100vh) * 0.706)',
          background: '#121316',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 36,
          padding: '24px 28px',
          boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#ffca28', fontSize: 18, fontWeight: 800, letterSpacing: 2.5 }}>
            PI MONITOR
          </span>
          <button
            type="button"
            aria-label="Close Pi monitor"
            onPointerDown={stopPointer}
            onPointerUp={stopPointer}
            onClick={closeMonitor}
            style={{
              background: 'none',
              border: 'none',
              color: '#9aa0a6',
              cursor: 'pointer',
              fontSize: 30,
              lineHeight: 1,
              padding: '0 4px'
            }}
          >
            x
          </button>
        </div>

        {!statsReaderAvailable || !stats || stats.error ? (
          <div
            style={{
              color: '#8b9096',
              fontSize: 18,
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {!statsReaderAvailable || stats?.error ? 'stats unavailable' : 'reading...'}
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-around',
              flex: 1,
              gap: 6,
              padding: '10px 0'
            }}
          >
            <div>
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}
              >
                <span style={{ color: '#9aa0a6', fontSize: 15, letterSpacing: 1, fontWeight: 600 }}>
                  CPU
                </span>
                <span
                  style={{
                    fontFamily: 'monospace',
                    fontSize: 58,
                    fontWeight: 800,
                    lineHeight: 0.9,
                    color: heat(cpu, 60, 85)
                  }}
                >
                  {stats.cpu ?? '--'}
                  <span style={{ fontSize: 22, color: '#8b9096' }}>%</span>
                </span>
              </div>
              {stats.cores && stats.cores.length > 0 && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  {stats.cores.map((core, index) => (
                    <div
                      key={index}
                      style={{
                        flex: 1,
                        height: 44,
                        background: '#1e2125',
                        borderRadius: 6,
                        position: 'relative',
                        overflow: 'hidden'
                      }}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          bottom: 0,
                          left: 0,
                          right: 0,
                          height: `${core}%`,
                          background: heat(core, 60, 85)
                        }}
                      />
                      <span
                        style={{
                          position: 'absolute',
                          inset: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#e8eaed',
                          fontFamily: 'monospace',
                          fontSize: 14,
                          fontWeight: 700
                        }}
                      >
                        {core}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ height: 1, background: 'rgba(255,255,255,0.08)' }} />

            {statRow(
              'RAM',
              stats.memUsedMb != null && stats.memTotalMb != null
                ? `${stats.memUsedMb}/${stats.memTotalMb} - ${stats.memPct}%`
                : '--',
              stats.memPct != null ? heat(stats.memPct, 75, 90) : undefined
            )}
            {statRow(
              'DISK',
              formatDisk(stats),
              stats.diskPct != null ? heat(stats.diskPct, 80, 92) : undefined
            )}
            {statRow(
              'SWAP',
              stats.swapUsedMb != null ? `${stats.swapUsedMb} MB` : '--',
              stats.swapUsedMb != null && stats.swapUsedMb > 80 ? '#ffca28' : undefined
            )}
            {statRow(
              'TEMP',
              stats.tempC != null ? `${stats.tempC.toFixed(1)}\u00b0C` : '--',
              stats.tempC != null ? heat(stats.tempC, 70, 80) : undefined
            )}
            {loadRow(stats.load, stats.cores?.length ?? 0)}
            {statRow('UPTIME', stats.uptime != null ? formatUptime(stats.uptime) : '--')}
            {statRow('WIRED', stats.wiredIp ?? '--')}
            {statRow('WI-FI', stats.wirelessIp ?? '--')}
            {stats.power &&
              statRow(
                'POWER',
                formatPower(stats.power),
                stats.power.underVoltageNow || stats.power.throttledNow
                  ? '#ef5350'
                  : stats.power.underVoltageOccurred ||
                      stats.power.throttledOccurred ||
                      stats.power.usbHighCurrent === false
                    ? '#ffca28'
                    : '#66bb6a'
              )}
          </div>
        )}

        <div style={{ color: '#5b6066', fontSize: 12, textAlign: 'center' }}>tap to close</div>
      </div>
    </div>
  )
}
