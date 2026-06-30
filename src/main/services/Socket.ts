/**
 * Telemetry transport over Socket.IO.
 *
 * Inbound:
 *   socket.on('telemetry:push', payload) → store.merge(payload)
 *
 * Outbound (re-broadcast on every store change):
 *   io.emit('telemetry:update', snapshot)
 *
 */

import type { TelemetryPayload } from '@shared/types/Telemetry'
import http from 'http'
import { Server } from 'socket.io'
import type { TelemetryStore } from './telemetry/TelemetryStore'

export enum TelemetryEvents {
  Connection = 'connection',
  Push = 'telemetry:push',
  Update = 'telemetry:update'
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function legacyTelemetryPatch(event: string, payload: unknown): TelemetryPayload | null {
  const objectPayload =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null

  switch (event) {
    case 'ambient': {
      const ambientC = finiteNumber(payload)
      return ambientC === undefined ? null : { ambientC }
    }
    case 'pi-temp': {
      const piCpuC = finiteNumber(objectPayload?.cpu)
      return piCpuC === undefined ? null : { piCpuC }
    }
    case 'cht': {
      return {
        chtLeftC: finiteNumber(objectPayload?.left) ?? null,
        chtRightC: finiteNumber(objectPayload?.right) ?? null
      }
    }
    case 'lean': {
      const leanDeg = finiteNumber(payload)
      return leanDeg === undefined ? null : { leanDeg }
    }
    case 'pitch': {
      const pitchDeg = finiteNumber(payload)
      return pitchDeg === undefined ? null : { pitchDeg }
    }
    case 'gforce': {
      return {
        gForceX: finiteNumber(objectPayload?.x) ?? 0,
        gForceY: finiteNumber(objectPayload?.y) ?? 0
      }
    }
    case 'imu-status': {
      if (!objectPayload) return null
      return {
        imuRecalibrating: Boolean(objectPayload.recalibrating),
        imuGyroCal: finiteNumber(objectPayload.gyro) ?? null,
        imuSysCal: finiteNumber(objectPayload.sys) ?? null
      }
    }
    case 'gps-status': {
      const sats = finiteNumber(objectPayload?.sats)
      return {
        gpsFix: Boolean(objectPayload?.fix),
        ...(sats === undefined ? {} : { gps: { satellites: sats }, gpsSatellites: sats })
      }
    }
    case 'gps-sky': {
      const lat = finiteNumber(objectPayload?.lat)
      const lng = finiteNumber(objectPayload?.lon)
      const satellites = finiteNumber(objectPayload?.satsUsed)
      return {
        gpsSky: payload,
        gps: {
          ...(lat === undefined ? {} : { lat }),
          ...(lng === undefined ? {} : { lng }),
          ...(satellites === undefined ? {} : { satellites })
        }
      }
    }
    case 'gps': {
      const speedKph = finiteNumber(objectPayload?.speed)
      const heading = finiteNumber(objectPayload?.heading)
      const alt = finiteNumber(objectPayload?.altitude)
      return {
        ...(speedKph === undefined ? {} : { speedKph }),
        gps: {
          ...(speedKph === undefined ? {} : { speedMs: speedKph / 3.6 }),
          ...(heading === undefined ? {} : { heading }),
          ...(alt === undefined ? {} : { alt })
        }
      }
    }
    default:
      return null
  }
}

export class TelemetrySocket {
  io: Server | null = null
  httpServer: http.Server | null = null

  private unsubscribeStore: (() => void) | null = null

  constructor(
    private readonly store: TelemetryStore,
    private port = 4000
  ) {
    this.startServer()
  }

  private setupListeners(): void {
    this.io?.on(TelemetryEvents.Connection, (socket) => {
      const snapshot = this.store.snapshot()
      if (Object.keys(snapshot).length > 0) {
        socket.emit(TelemetryEvents.Update, snapshot)
      }
      socket.on(TelemetryEvents.Push, (payload: TelemetryPayload) => {
        this.store.merge(payload)
      })

      for (const event of [
        'ambient',
        'pi-temp',
        'cht',
        'lean',
        'pitch',
        'gforce',
        'imu-status',
        'gps-status',
        'gps-sky',
        'gps'
      ]) {
        socket.on(event, (payload: unknown) => {
          this.store.merge(legacyTelemetryPatch(event, payload))
        })
      }
    })

    // Re-broadcast every merged snapshot to all socket.io clients.
    const onChange = (_patch: TelemetryPayload, snapshot: TelemetryPayload): void => {
      this.io?.emit(TelemetryEvents.Update, snapshot)
    }
    this.store.on('change', onChange)
    this.unsubscribeStore = (): void => {
      this.store.off('change', onChange)
    }
  }

  private startServer(): void {
    this.httpServer = http.createServer()
    this.io = new Server(this.httpServer, { cors: { origin: '*' } })
    this.setupListeners()
    this.httpServer.on('error', (err: NodeJS.ErrnoException) => {
      console.error(`[TelemetrySocket] server error on port ${this.port}:`, err.message)
    })
    this.httpServer.listen(this.port, () => {
      console.log(`[TelemetrySocket] Server listening on port ${this.port}`)
    })
  }

  async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      this.unsubscribeStore?.()
      this.unsubscribeStore = null
      if (this.io) this.io.close(() => console.log('[TelemetrySocket] IO closed'))
      if (this.httpServer) {
        this.httpServer.close(() => {
          console.log('[TelemetrySocket] HTTP server closed')
          this.io = null
          this.httpServer = null
          resolve()
        })
      } else {
        resolve()
      }
    })
  }

  async connect(): Promise<void> {
    await new Promise((r) => setTimeout(r, 200))
    this.startServer()
  }
}
