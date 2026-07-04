/**
 * Telemetry entrypoint — owns the store, attaches every adapter.
 *
 *   ingestion (Socket.IO + IPC)
 *           │
 *           ▼
 *      TelemetryStore.merge(patch)
 *           │
 *           │  on 'change'
 *           ▼
 *   ┌──────────────────┬───────────────┬───────────────┐
 *   │ liviDashAdapt    │   aaAdapter   │ dongleAdapter │
 *   │ (IPC → Renderer) │  (AaDriver)   │ (DongleDriver)│
 *   └──────────────────┴───────────────┴───────────────┘
 *
 */

import { registerIpcHandle, registerIpcOn } from '@main/ipc/register'
import { configEvents } from '@main/ipc/utils'
import { DiagnosticLogger, type DiagnosticSnapshot } from '@main/services/diagnostics/DiagnosticLogger'
import type { ProjectionService } from '@main/services/projection/services/ProjectionService'
import { getAllRendererWebContents } from '@main/window/broadcast'
import type { Config } from '@shared/types'
import type { TelemetryPayload } from '@shared/types/Telemetry'
import { resolveNightMode } from '@shared/utils'
import { ipcMain } from 'electron'
import { attachAaAdapter } from './adapters/aaAdapter'
import { attachBlinkerSound } from './adapters/blinkerSoundAdapter'
import { attachDongleAdapter } from './adapters/dongleAdapter'
import { attachLiviDashAdapter } from './adapters/liviDashAdapter'
import { attachGpsPersist } from './gpsPersist'
import type { TelemetryStore } from './TelemetryStore'

export type SetupTelemetryDeps = {
  store: TelemetryStore
  projectionService?: ProjectionService
  initialConfig?: Config
}

export type TelemetryHandle = {
  store: TelemetryStore
  dispose: () => void
}

export function setupTelemetry({
  store,
  projectionService,
  initialConfig
}: SetupTelemetryDeps): TelemetryHandle {
  // Renderer-side IPC ingestion (kept symmetrical with Socket.IO).
  registerIpcOn<[TelemetryPayload | undefined]>('telemetry:push', (_evt, payload) => {
    store.merge(payload)
  })

  // Snapshot fetch — used by dashes on mount to hydrate
  registerIpcHandle('telemetry:snapshot', (): TelemetryPayload => store.snapshot())

  // ── Diagnostic Mode — persist run data ONLY while the setting is on ───────
  // The renderer decides when to push (30s cadence + on unload) and only pushes
  // when diagnosticMode is on; we double-gate here so a stale/rogue push while
  // the mode is off never touches disk. Disabled = no folder, no writes.
  const diagnosticLogger = new DiagnosticLogger()
  registerIpcOn<[DiagnosticSnapshot | undefined]>('diagnostics:snapshot', (_evt, snapshot) => {
    if (!currentConfig?.diagnosticMode || !snapshot) return
    diagnosticLogger.write(snapshot)
  })
  registerIpcHandle('diagnostics:clear', (): { ok: true } => {
    diagnosticLogger.clear()
    return { ok: true }
  })

  // ── Initial seed: appearanceMode + persisted GPS ────────────────────────

  applyAppearanceMode(store, initialConfig)

  const gpsPersist = attachGpsPersist({
    store,
    initialGps: initialConfig?.lastKnownGps
  })

  let currentConfig: Config | undefined = initialConfig
  const onConfigChanged = (merged: Config): void => {
    currentConfig = merged
    // Re-derive every config change: mode or the scheduled hours may have moved.
    applyAppearanceMode(store, merged)
  }
  configEvents.on('changed', onConfigChanged)

  // 'scheduled' flips day↔night at the configured hours without any user action
  // or phone reconnect. A 1-minute poll is plenty (nightMode is diff-suppressed
  // downstream, so re-applying the same value is a no-op).
  const appearanceTimer = setInterval(() => {
    applyAppearanceMode(store, currentConfig)
  }, 60_000)
  // Never let this keep the process (or a jest run) alive on its own.
  ;(appearanceTimer as unknown as { unref?: () => void }).unref?.()

  // ── Adapters ────────────────────────────────────────────────────────────

  const offDash = attachLiviDashAdapter({
    store,
    getWebContents: () => getAllRendererWebContents()
  })

  let offAa: (() => void) | null = null
  let offDongle: (() => void) | null = null
  let offPlugHook: (() => void) | null = null
  let offBlinker: (() => void) | null = null
  if (projectionService) {
    offBlinker = attachBlinkerSound({
      store,
      setActive: (active) => projectionService.setBlinkerSoundActive(active)
    })

    const aa = attachAaAdapter({
      store,
      getAaDriver: () => projectionService.getAaDriver()
    })
    const dongle = attachDongleAdapter({
      store,
      getDongleDriver: () => projectionService.getDongleDriver(),
      getConfig: () => currentConfig
    })
    offAa = aa.off
    offDongle = dongle.off

    offPlugHook = projectionService.addPluggedHook(() => {
      try {
        aa.hydrate()
      } catch (e) {
        console.warn('[setupTelemetry] aa.hydrate threw (ignored)', e)
      }
      try {
        dongle.hydrate()
      } catch (e) {
        console.warn('[setupTelemetry] dongle.hydrate threw (ignored)', e)
      }
    })
  }

  return {
    store,
    dispose: (): void => {
      ipcMain.removeAllListeners('telemetry:push')
      ipcMain.removeHandler('telemetry:snapshot')
      ipcMain.removeAllListeners('diagnostics:snapshot')
      ipcMain.removeHandler('diagnostics:clear')
      clearInterval(appearanceTimer)
      configEvents.off('changed', onConfigChanged)
      gpsPersist.off()
      offDash()
      offAa?.()
      offDongle?.()
      offPlugHook?.()
      offBlinker?.()
    }
  }
}

/**
 * For 'scheduled' appearance: is the given local hour in the day/light window?
 * Re-exported from the shared appearance util so existing imports keep working.
 */
export { isDaytime } from '@shared/utils'

function applyAppearanceMode(store: TelemetryStore, config: Config | undefined): void {
  const nightMode = resolveNightMode(config)
  if (typeof nightMode === 'boolean') {
    store.merge({ nightMode })
  }
}
