/**
 * AOAP handshake via the renderer's Chromium WebUSB.
 *
 * node-usb-rs routes every control transfer through a claimed interface. On macOS the normal-mode
 * phone exposes a single MTP interface that ptpcamerad holds exclusively, so that claim never
 * succeeds. Chromium sends a device-recipient EP0 control transfer on the opened device without
 * claiming anything, which is all the AOAP handshake needs.
 */

import type { WebContents } from 'electron'
import {
  AOAP_DESCRIPTION,
  AOAP_MANUFACTURER,
  AOAP_MODEL,
  AOAP_SERIAL,
  AOAP_URI,
  AOAP_VERSION,
  REQ_GET_PROTOCOL,
  REQ_SEND_STRING,
  REQ_START,
  STRING_DESCRIPTION,
  STRING_MANUFACTURER,
  STRING_MODEL,
  STRING_SERIAL,
  STRING_URI,
  STRING_VERSION
} from './constants.js'

type HandshakeResult = { ok: boolean; protocol?: number; error?: string }

type PageArgs = {
  vendorId: number
  productId: number
  reqGetProtocol: number
  reqSendString: number
  reqStart: number
  strings: Array<[number, string]>
  timeoutMs: number
}

const PAGE_TIMEOUT_MS = 10_000
const EXEC_TIMEOUT_MS = 12_000

// Runs in the renderer main world. Self-contained, returns a JSON result, never rejects.
function buildPageScript(args: PageArgs): string {
  return `(async (args) => {
    const run = async () => {
      if (!navigator.usb) return { ok: false, error: 'navigator.usb unavailable' }
      const devices = await navigator.usb.getDevices()
      const dev = devices.find((d) => d.vendorId === args.vendorId && d.productId === args.productId)
      if (!dev) return { ok: false, error: 'phone not visible via WebUSB' }
      await dev.open()
      try {
        if (!dev.configuration) await dev.selectConfiguration(1)
        const setup = (request, index) => ({
          requestType: 'vendor', recipient: 'device', request, value: 0, index
        })
        const r = await dev.controlTransferIn(setup(args.reqGetProtocol, 0), 2)
        if (r.status !== 'ok' || !r.data || r.data.byteLength < 2) {
          return { ok: false, error: 'getProtocol status=' + r.status }
        }
        const protocol = r.data.getUint16(0, true)
        if (protocol < 1) return { ok: false, error: 'AOAP protocol ' + protocol + ' not supported' }
        const enc = new TextEncoder()
        for (const [index, value] of args.strings) {
          const w = await dev.controlTransferOut(setup(args.reqSendString, index), enc.encode(value + '\\0'))
          if (w.status !== 'ok') return { ok: false, error: 'sendString ' + index + ' status=' + w.status }
        }
        const s = await dev.controlTransferOut(setup(args.reqStart, 0), new Uint8Array(0))
        if (s.status !== 'ok') return { ok: false, error: 'start status=' + s.status }
        return { ok: true, protocol }
      } finally {
        try { await dev.close() } catch {}
      }
    }
    const timeout = new Promise((resolve) =>
      setTimeout(() => resolve({ ok: false, error: 'handshake timeout' }), args.timeoutMs)
    )
    try {
      return await Promise.race([run(), timeout])
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) }
    }
  })(${JSON.stringify(args)})`
}

export async function runRendererAoapHandshake(
  webContents: WebContents,
  vendorId: number,
  productId: number
): Promise<number> {
  const script = buildPageScript({
    vendorId,
    productId,
    reqGetProtocol: REQ_GET_PROTOCOL,
    reqSendString: REQ_SEND_STRING,
    reqStart: REQ_START,
    strings: [
      [STRING_MANUFACTURER, AOAP_MANUFACTURER],
      [STRING_MODEL, AOAP_MODEL],
      [STRING_DESCRIPTION, AOAP_DESCRIPTION],
      [STRING_VERSION, AOAP_VERSION],
      [STRING_URI, AOAP_URI],
      [STRING_SERIAL, AOAP_SERIAL]
    ],
    timeoutMs: PAGE_TIMEOUT_MS
  })

  // The page script resolves within its own timeout. The outer race only covers a dead renderer.
  const exec = webContents.executeJavaScript(script) as Promise<HandshakeResult>
  const watchdog = new Promise<HandshakeResult>((resolve) =>
    setTimeout(() => resolve({ ok: false, error: 'renderer did not answer' }), EXEC_TIMEOUT_MS)
  )
  const result = await Promise.race([exec, watchdog])
  if (!result?.ok) {
    throw new Error(`AOAP renderer handshake failed: ${result?.error ?? 'unknown'}`)
  }
  console.log(`[AOAP] renderer handshake ok (protocol=${result.protocol})`)
  return result.protocol ?? 0
}
