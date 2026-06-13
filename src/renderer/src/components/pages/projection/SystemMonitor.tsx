import * as React from 'react'

const HOLD_MS = 1000
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

    const activePointers = new Set<number>()
    let timer: number | null = null

    const clearTimer = (): void => {
      if (timer == null) return
      window.clearTimeout(timer)
      timer = null
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (typeof window.app?.systemStats !== 'function') return
      activePointers.add(event.pointerId)
      if (activePointers.size === 2 && !timer && !openRef.current) {
        timer = window.setTimeout(() => {
          if (activePointers.size >= 2) setOpen(true)
          timer = null
        }, HOLD_MS)
      }
    }

    const onPointerUp = (event: PointerEvent): void => {
      if (typeof window.app?.systemStats !== 'function') return
      activePointers.delete(event.pointerId)
      if (activePointers.size < 2) clearTimer()
    }

    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    window.addEventListener('pointerup', onPointerUp, { passive: true })
    window.addEventListener('pointercancel', onPointerUp, { passive: true })

    return () => {
      clearTimer()
      window.removeEventListener('livi:open-system-monitor', onOpenMonitor)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
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

  return (
    <div
      data-testid="projection-system-monitor-backdrop"
      onPointerDown={() => setOpen(false)}
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
        onPointerDown={(event) => event.stopPropagation()}
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
            onPointerDown={(event) => {
              event.stopPropagation()
              setOpen(false)
            }}
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
              'SWAP',
              stats.swapUsedMb != null ? `${stats.swapUsedMb} MB` : '--',
              stats.swapUsedMb != null && stats.swapUsedMb > 80 ? '#ffca28' : undefined
            )}
            {statRow(
              'TEMP',
              stats.tempC != null ? `${stats.tempC.toFixed(1)}\u00b0C` : '--',
              stats.tempC != null ? heat(stats.tempC, 70, 80) : undefined
            )}
            {statRow(
              'LOAD',
              stats.load ? stats.load.map((load) => load.toFixed(2)).join(' ') : '--'
            )}
            {statRow('UPTIME', stats.uptime != null ? formatUptime(stats.uptime) : '--')}
          </div>
        )}

        <div style={{ color: '#5b6066', fontSize: 12, textAlign: 'center' }}>
          tap to close / two-finger hold to reopen
        </div>
      </div>
    </div>
  )
}
