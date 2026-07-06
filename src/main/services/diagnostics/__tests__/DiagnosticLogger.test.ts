import fs from 'fs'
import os from 'os'
import path from 'path'
import { DiagnosticLogger } from '../DiagnosticLogger'

describe('DiagnosticLogger', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diaglog-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  function files(): string[] {
    return fs.readdirSync(dir).filter((n) => n.startsWith('diag-') && n.endsWith('.json'))
  }

  test('write() persists a JSON snapshot file', () => {
    const logger = new DiagnosticLogger({ dir })
    logger.write({ ts: 1000, graphs: { speed: [{ ts: 1, val: 2 }] } })
    const list = files()
    expect(list).toHaveLength(1)
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, list[0]), 'utf8'))
    expect(parsed.payload.graphs.speed).toEqual([{ ts: 1, val: 2 }])
    expect(parsed.version).toBe(1)
  })

  test('does not create the folder or write until a snapshot arrives', () => {
    const sub = path.join(dir, 'nested-diagnostics')
    // eslint-disable-next-line no-new
    new DiagnosticLogger({ dir: sub })
    expect(fs.existsSync(sub)).toBe(false)
  })

  test('prunes oldest files to stay under the size cap', () => {
    // Cap small enough that only ~2 snapshots fit.
    const payload = { rawTelemetry: Array.from({ length: 50 }, (_, i) => ({ i })) }
    const oneSize = Buffer.byteLength(
      JSON.stringify({ version: 1, timestamp: '', payload }),
      'utf8'
    )
    const logger = new DiagnosticLogger({ dir, maxBytes: oneSize * 2 + 10 })
    for (let i = 0; i < 6; i++) {
      logger.write({ ts: 1000 + i * 1000, ...payload })
    }
    // Never exceeds the cap; keeps only the most recent files.
    expect(logger.usageBytes()).toBeLessThanOrEqual(oneSize * 2 + 10)
    expect(files().length).toBeLessThanOrEqual(2)
    expect(files().length).toBeGreaterThanOrEqual(1)
  })

  test('clear() removes every diagnostic file and reports counts', () => {
    const logger = new DiagnosticLogger({ dir })
    logger.write({ ts: 1000 })
    logger.write({ ts: 2000 })
    expect(files().length).toBeGreaterThan(0)
    expect(logger.clear()).toEqual({ deleted: 2, remaining: 0 })
    expect(files()).toHaveLength(0)
  })

  test('clear() on a missing folder is a no-op (no throw)', () => {
    const logger = new DiagnosticLogger({ dir: path.join(dir, 'does-not-exist') })
    expect(logger.clear()).toEqual({ deleted: 0, remaining: 0 })
  })

  test('usageBytes() sums file sizes', () => {
    const logger = new DiagnosticLogger({ dir })
    expect(logger.usageBytes()).toBe(0)
    logger.write({ ts: 1000, graphs: { speed: [{ ts: 1, val: 2 }] } })
    expect(logger.usageBytes()).toBeGreaterThan(0)
  })
})
