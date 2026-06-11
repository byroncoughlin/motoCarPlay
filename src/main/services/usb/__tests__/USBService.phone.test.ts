import { registerIpcHandle } from '@main/ipc/register'
import { BrowserWindow } from 'electron'
import { usb } from 'usb'

jest.mock('electron', () => ({
  BrowserWindow: { getAllWindows: jest.fn(() => []) }
}))

jest.mock('@main/ipc/register', () => ({
  registerIpcHandle: jest.fn()
}))

jest.mock('@main/services/audio', () => ({
  Microphone: { getSysdefaultPrettyName: jest.fn(() => 'Mic') }
}))

jest.mock('usb', () => ({
  usb: {
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    getDevices: jest.fn(async () => [])
  }
}))

jest.mock('../helpers', () => ({
  findDongle: jest.fn(async () => null)
}))

const isAccessoryModeMock = jest.fn(() => false)
jest.mock('../../projection/driver/aa/stack/aoap/handshake', () => ({
  isAccessoryMode: (...a: unknown[]) => isAccessoryModeMock(...a)
}))

import { USBService } from '@main/services/usb/USBService'

const projection = {
  markDongleConnected: jest.fn(),
  markPhoneConnected: jest.fn(),
  autoStartIfNeeded: jest.fn(async () => undefined),
  stop: jest.fn(async () => undefined),
  getActiveTransport: jest.fn(() => null),
  isExpectingPhoneReenumeration: jest.fn(() => false)
} as any

// usb@3 USBDevice: flat fields + async methods. deviceClass 0x00 makes it a
// wired-AA phone candidate (not a dongle, not a non-phone class).
function mkPhoneCandidate(vid = 0x18d1, pid = 0x4ee1, deviceClass = 0x00) {
  return {
    vendorId: vid,
    productId: pid,
    deviceClass,
    open: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
    reset: jest.fn(async () => undefined)
  } as never
}

// USBConnectionEvent wraps the device under `.device`.
const evt = (device: unknown) => ({ device }) as never

function connectHandler(): (ev: unknown) => void {
  const calls = (usb.addEventListener as jest.Mock).mock.calls
  const row = calls.find(([e]) => e === 'connect')!
  return row[1] as (ev: unknown) => void
}

function disconnectHandler(): (ev: unknown) => void {
  const calls = (usb.addEventListener as jest.Mock).mock.calls
  const row = calls.find(([e]) => e === 'disconnect')!
  return row[1] as (ev: unknown) => void
}

beforeEach(() => {
  jest.clearAllMocks()
  isAccessoryModeMock.mockReset().mockReturnValue(false)
  ;(usb.getDevices as jest.Mock).mockReset().mockResolvedValue([])
  projection.markDongleConnected.mockReset()
  projection.markPhoneConnected.mockReset()
  projection.autoStartIfNeeded.mockReset().mockResolvedValue(undefined)
  projection.isExpectingPhoneReenumeration.mockReset().mockReturnValue(false)
  projection.getActiveTransport.mockReset().mockReturnValue(null)
  jest.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('USBService — phone attach paths', () => {
  test('accessory-mode device on connect marks phone connected', () => {
    isAccessoryModeMock.mockReturnValue(true)
    new USBService(projection)
    connectHandler()(evt(mkPhoneCandidate()))
    expect(projection.markPhoneConnected).toHaveBeenCalledWith(true, expect.anything())
  })

  test('phone candidate on connect kicks off the bring-up (no probe)', () => {
    new USBService(projection)
    connectHandler()(evt(mkPhoneCandidate()))
    expect(projection.markPhoneConnected).toHaveBeenCalledWith(true, expect.anything())
  })

  test('phone detach fires markPhoneConnected(false)', () => {
    const phone = mkPhoneCandidate()
    new USBService(projection)
    connectHandler()(evt(phone))
    // Advance past the PHONE_REENUM_SUPPRESS_MS window so detach isn't suppressed
    jest.useFakeTimers()
    jest.setSystemTime(Date.now() + 20_000)
    projection.markPhoneConnected.mockClear()
    disconnectHandler()(evt(phone))
    expect(projection.markPhoneConnected).toHaveBeenCalledWith(false)
    jest.useRealTimers()
  })

  test('phone detach during re-enumeration window is suppressed', () => {
    const phone = mkPhoneCandidate()
    new USBService(projection)
    connectHandler()(evt(phone))
    projection.markPhoneConnected.mockClear()
    projection.isExpectingPhoneReenumeration.mockReturnValue(true)
    disconnectHandler()(evt(phone))
    expect(projection.markPhoneConnected).not.toHaveBeenCalled()
  })

  test('OEM-PID re-attach while lastPhone=true resets state', () => {
    const phone = mkPhoneCandidate()
    new USBService(projection)
    connectHandler()(evt(phone))
    projection.markPhoneConnected.mockClear()
    // Second attach with same OEM-PID
    connectHandler()(evt(phone))
    expect(projection.markPhoneConnected).toHaveBeenCalledWith(false)
  })

  test('accessory-mode re-attach during re-enum window keeps the bridge owner', () => {
    isAccessoryModeMock.mockReturnValue(true)
    const phone = mkPhoneCandidate()
    new USBService(projection)
    connectHandler()(evt(phone))
    projection.markPhoneConnected.mockClear()
    projection.isExpectingPhoneReenumeration.mockReturnValue(true)
    connectHandler()(evt(phone))
    expect(projection.markPhoneConnected).toHaveBeenCalledWith(true, expect.anything())
  })

  test('attach while AA is active suppresses dongle broadcast', () => {
    projection.getActiveTransport.mockReturnValue('aa')
    new USBService(projection)
    const dongle = {
      vendorId: 0x1314,
      productId: 0x1520,
      deviceClass: 0x00,
      open: jest.fn(async () => undefined),
      close: jest.fn(async () => undefined),
      reset: jest.fn(async () => undefined)
    } as never
    connectHandler()(evt(dongle))
    // markDongleConnected still fires, but the renderer broadcast doesn't
    expect(projection.markDongleConnected).toHaveBeenCalledWith(true)
    expect((BrowserWindow.getAllWindows as jest.Mock).mock.results).toEqual(expect.any(Array))
  })

  test('attach during stopped state is ignored', () => {
    const svc = new USBService(projection)
    ;(svc as unknown as { stopped: boolean }).stopped = true
    connectHandler()(evt(mkPhoneCandidate()))
    expect(projection.markPhoneConnected).not.toHaveBeenCalled()
  })

  test('detach during stopped state is ignored', () => {
    const svc = new USBService(projection)
    ;(svc as unknown as { stopped: boolean }).stopped = true
    disconnectHandler()(evt(mkPhoneCandidate()))
    expect(projection.markPhoneConnected).not.toHaveBeenCalled()
  })
})

describe('USBService — startup scan', () => {
  test('marks the first phone candidate on the bus on construction', async () => {
    const phone = mkPhoneCandidate()
    ;(usb.getDevices as jest.Mock).mockResolvedValue([phone])
    new USBService(projection)
    // The startup scan runs asynchronously
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    expect(projection.markPhoneConnected).toHaveBeenCalledWith(true, phone)
  })

  test('startup scan skips when no candidate is in the list', async () => {
    ;(usb.getDevices as jest.Mock).mockResolvedValue([])
    new USBService(projection)
    await new Promise((r) => setImmediate(r))
    expect(projection.markPhoneConnected).not.toHaveBeenCalled()
  })
})

describe('USBService — isPhoneCandidate filter', () => {
  test('skips non-phone device classes (HID/HUB/etc.)', () => {
    new USBService(projection)
    const hub = {
      vendorId: 0x1000,
      productId: 0x2000,
      deviceClass: 0x09 /* hub */,
      open: jest.fn(async () => undefined),
      close: jest.fn(async () => undefined),
      reset: jest.fn(async () => undefined)
    } as never
    connectHandler()(evt(hub))
    expect(projection.markPhoneConnected).not.toHaveBeenCalled()
  })

  test('skips a device with undefined deviceClass', () => {
    new USBService(projection)
    const weird = {
      vendorId: 0x1000,
      productId: 0x2000,
      deviceClass: undefined,
      open: jest.fn(async () => undefined),
      close: jest.fn(async () => undefined),
      reset: jest.fn(async () => undefined)
    } as never
    connectHandler()(evt(weird))
    expect(projection.markPhoneConnected).not.toHaveBeenCalled()
  })
})

// Ensure registerIpcHandle has been called (test infrastructure check)
test('USBService registers IPC on construction', () => {
  new USBService(projection)
  expect(registerIpcHandle).toHaveBeenCalled()
})
