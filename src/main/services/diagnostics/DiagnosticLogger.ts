import { app } from 'electron'
import fs from 'fs'
import path from 'path'

/**
 * DiagnosticLogger — persists LIVI run data to disk ONLY while diagnostic mode
 * is enabled. Snapshots (graph history + sensor diagnostics + raw telemetry
 * samples) arrive from the renderer over IPC roughly every 30s and on unload.
 *
 * Files land in <userData>/diagnostics/ as `diag-<ISO>.json`. The whole folder
 * is size-capped (default 256 MB); when a write would exceed the cap the oldest
 * files are pruned first. Nothing is written, and no folder is created, until a
 * snapshot actually arrives — so a disabled logger has zero footprint.
 */
export const DIAGNOSTIC_VERSION = 1

const DEFAULT_MAX_BYTES = 256 * 1024 * 1024 // 256 MB, generous per user request

export type DiagnosticSnapshot = {
  /** Wall-clock capture time (ms epoch), supplied by the renderer. */
  ts?: number
  /** Per-metric graph history: { speed: [{ts,val}], ... }. */
  graphs?: Record<string, Array<{ ts: number; val: number }>>
  /** Sensor / IMU diagnostic events + calibration state. */
  sensors?: unknown
  /** Rolling buffer of raw telemetry:update payloads. */
  rawTelemetry?: unknown[]
}

export class DiagnosticLogger {
  private readonly dir: string
  private readonly maxBytes: number

  constructor(opts: { dir?: string; maxBytes?: number } = {}) {
    this.dir = opts.dir ?? path.join(app.getPath('userData'), 'diagnostics')
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  }

  /** Persist one snapshot. Best-effort: failures are logged, never thrown. */
  write(snapshot: DiagnosticSnapshot): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true })
      const out = {
        version: DIAGNOSTIC_VERSION,
        timestamp: new Date().toISOString(),
        payload: snapshot
      }
      const json = JSON.stringify(out)
      this.pruneToFit(Buffer.byteLength(json, 'utf8'))
      const stamp = new Date(snapshot.ts ?? Date.now()).toISOString().replace(/[:.]/g, '-')
      const file = path.join(this.dir, `diag-${stamp}.json`)
      const tmp = file + '.tmp'
      fs.writeFileSync(tmp, json, 'utf8')
      fs.renameSync(tmp, file)
    } catch (e) {
      console.warn('[DiagnosticLogger] write failed (ignored)', e)
    }
  }

  /**
   * Delete every diagnostic file. Used by the "Clear diagnostic data" button.
   * Returns what actually happened — `remaining` is a fresh re-listing of the
   * folder after the deletes, so the UI can show true success/failure instead
   * of assuming.
   */
  clear(): { deleted: number; remaining: number } {
    let deleted = 0
    try {
      if (!fs.existsSync(this.dir)) return { deleted: 0, remaining: 0 }
      for (const f of this.listFiles()) {
        try {
          fs.unlinkSync(path.join(this.dir, f.name))
          deleted += 1
        } catch (e) {
          console.warn('[DiagnosticLogger] unlink failed (ignored)', f.name, e)
        }
      }
    } catch (e) {
      console.warn('[DiagnosticLogger] clear failed (ignored)', e)
    }
    return { deleted, remaining: this.listFiles().length }
  }

  /** Total bytes currently used by the diagnostics folder. */
  usageBytes(): number {
    return this.listFiles().reduce((sum, f) => sum + f.size, 0)
  }

  private listFiles(): Array<{ name: string; size: number; mtimeMs: number }> {
    try {
      return fs
        .readdirSync(this.dir)
        .filter((n) => n.startsWith('diag-') && n.endsWith('.json'))
        .map((name) => {
          const st = fs.statSync(path.join(this.dir, name))
          return { name, size: st.size, mtimeMs: st.mtimeMs }
        })
    } catch {
      return []
    }
  }

  /** Delete oldest files until there's room for `incomingBytes` under the cap. */
  private pruneToFit(incomingBytes: number): void {
    let files = this.listFiles().sort((a, b) => a.mtimeMs - b.mtimeMs)
    let used = files.reduce((sum, f) => sum + f.size, 0)
    while (files.length > 0 && used + incomingBytes > this.maxBytes) {
      const oldest = files.shift()!
      try {
        fs.unlinkSync(path.join(this.dir, oldest.name))
        used -= oldest.size
      } catch (e) {
        console.warn('[DiagnosticLogger] prune unlink failed (ignored)', oldest.name, e)
        break
      }
    }
  }
}
