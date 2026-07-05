// Browser shim for the site demo: provides the minimal window.projection
// surface the sensor overlay touches, backed by the simulated ride. Must be
// imported BEFORE any app module so the mock exists at module-init time.

type TelemetryHandler = (payload: unknown) => void

const handlers = new Set<TelemetryHandler>()
let lastPayload: Record<string, unknown> = {}

export function emitTelemetry(payload: Record<string, unknown>): void {
  lastPayload = payload
  for (const h of handlers) h(payload)
}

const projectionMock = {
  ipc: {
    onTelemetry: (h: TelemetryHandler) => {
      handlers.add(h)
    },
    offTelemetry: (h: TelemetryHandler) => {
      handlers.delete(h)
    },
    getTelemetrySnapshot: async () => lastPayload
  },
  quit: async () => {
    // The demo can't quit anything — flash the hint instead.
    window.parent?.postMessage({ channel: 'motoDemo', event: 'quitAttempt' }, '*')
  }
}

// The app reads window.projection.* with optional chaining throughout, so a
// partial mock is safe.
;(window as unknown as Record<string, unknown>).projection = projectionMock
