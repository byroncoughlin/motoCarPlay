const registerIpcOnMock = jest.fn()
const registerIpcHandleMock = jest.fn()
const configEvents = {
  on: jest.fn(),
  off: jest.fn(),
  emit: jest.fn()
}
const getAllRendererWebContentsMock = jest.fn(() => [])

jest.mock('@main/ipc/register', () => ({
  registerIpcOn: (...a: unknown[]) => registerIpcOnMock(...a),
  registerIpcHandle: (...a: unknown[]) => registerIpcHandleMock(...a)
}))

jest.mock('@main/ipc/utils', () => ({
  configEvents
}))

jest.mock('@main/window/broadcast', () => ({
  getAllRendererWebContents: () => getAllRendererWebContentsMock()
}))

const diagnosticWriteMock = jest.fn()
const diagnosticClearMock = jest.fn()
jest.mock('@main/services/diagnostics/DiagnosticLogger', () => ({
  DiagnosticLogger: jest.fn().mockImplementation(() => ({
    write: (...a: unknown[]) => diagnosticWriteMock(...a),
    clear: (...a: unknown[]) => diagnosticClearMock(...a)
  }))
}))

const removeAllListenersMock = jest.fn()
const removeHandlerMock = jest.fn()
jest.mock('electron', () => ({
  ipcMain: {
    removeAllListeners: (...a: unknown[]) => removeAllListenersMock(...a),
    removeHandler: (...a: unknown[]) => removeHandlerMock(...a)
  }
}))

import type { ProjectionService } from '@main/services/projection/services/ProjectionService'
import type { Config } from '@shared/types'
import { isDaytime, setupTelemetry } from '../setupTelemetry'
import { TelemetryStore } from '../TelemetryStore'

function fakeProjection(): ProjectionService {
  return {
    getAaDriver: jest.fn(() => null),
    getDongleDriver: jest.fn(() => null),
    addPluggedHook: jest.fn(() => () => {})
  } as unknown as ProjectionService
}

beforeEach(() => {
  registerIpcOnMock.mockReset()
  registerIpcHandleMock.mockReset()
  configEvents.on.mockReset()
  configEvents.off.mockReset()
  removeAllListenersMock.mockReset()
  removeHandlerMock.mockReset()
  diagnosticWriteMock.mockReset()
  diagnosticClearMock.mockReset()
  getAllRendererWebContentsMock.mockReturnValue([])
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('setupTelemetry', () => {
  test('registers telemetry:push and telemetry:snapshot IPC', () => {
    const store = new TelemetryStore()
    setupTelemetry({ store })
    expect(registerIpcOnMock).toHaveBeenCalledWith('telemetry:push', expect.any(Function))
    expect(registerIpcHandleMock).toHaveBeenCalledWith('telemetry:snapshot', expect.any(Function))
  })

  test('telemetry:push routes into store.merge', () => {
    const store = new TelemetryStore()
    setupTelemetry({ store })
    const cb = registerIpcOnMock.mock.calls[0][1] as (
      _evt: unknown,
      payload: Record<string, unknown>
    ) => void
    cb(null, { speedKph: 42 })
    expect(store.snapshot().speedKph).toBe(42)
  })

  test('telemetry:snapshot returns the current snapshot', () => {
    const store = new TelemetryStore()
    store.merge({ speedKph: 50 })
    setupTelemetry({ store })
    const handler = registerIpcHandleMock.mock.calls[0][1] as () => unknown
    expect(handler()).toEqual(expect.objectContaining({ speedKph: 50 }))
  })

  test('appearanceMode "night" seeds nightMode=true', () => {
    const store = new TelemetryStore()
    setupTelemetry({ store, initialConfig: { appearanceMode: 'night' } as Config })
    expect(store.snapshot().nightMode).toBe(true)
  })

  test('appearanceMode "day" seeds nightMode=false', () => {
    const store = new TelemetryStore()
    setupTelemetry({ store, initialConfig: { appearanceMode: 'day' } as Config })
    expect(store.snapshot().nightMode).toBe(false)
  })

  test('appearanceMode change is forwarded to the store', () => {
    const store = new TelemetryStore()
    setupTelemetry({ store, initialConfig: { appearanceMode: 'day' } as Config })
    const onChange = configEvents.on.mock.calls.find((c) => c[0] === 'changed')![1] as (
      cfg: Config
    ) => void
    onChange({ appearanceMode: 'night' } as Config)
    expect(store.snapshot().nightMode).toBe(true)
  })

  test('isDaytime: default 6..18 window', () => {
    expect(isDaytime(5, 6, 18)).toBe(false) // before day
    expect(isDaytime(6, 6, 18)).toBe(true) // day starts (inclusive)
    expect(isDaytime(12, 6, 18)).toBe(true)
    expect(isDaytime(17, 6, 18)).toBe(true)
    expect(isDaytime(18, 6, 18)).toBe(false) // night starts (exclusive)
    expect(isDaytime(23, 6, 18)).toBe(false)
    expect(isDaytime(0, 6, 18)).toBe(false)
  })

  test('isDaytime: day window that wraps midnight (18..6)', () => {
    expect(isDaytime(20, 18, 6)).toBe(true)
    expect(isDaytime(3, 18, 6)).toBe(true)
    expect(isDaytime(6, 18, 6)).toBe(false)
    expect(isDaytime(12, 18, 6)).toBe(false)
  })

  test('appearanceMode "scheduled" seeds nightMode from the clock', () => {
    const store = new TelemetryStore()
    const spy = jest.spyOn(Date.prototype, 'getHours').mockReturnValue(2) // 2am → night
    setupTelemetry({
      store,
      initialConfig: {
        appearanceMode: 'scheduled',
        appearanceDayStartHour: 6,
        appearanceNightStartHour: 18
      } as Config
    })
    expect(store.snapshot().nightMode).toBe(true)
    spy.mockReturnValue(10) // 10am → day
    const onChange = configEvents.on.mock.calls.find((c) => c[0] === 'changed')![1] as (
      cfg: Config
    ) => void
    onChange({
      appearanceMode: 'scheduled',
      appearanceDayStartHour: 6,
      appearanceNightStartHour: 18
    } as Config)
    expect(store.snapshot().nightMode).toBe(false)
    spy.mockRestore()
  })

  test('diagnostics:snapshot is dropped when diagnosticMode is off', () => {
    const store = new TelemetryStore()
    setupTelemetry({ store, initialConfig: { diagnosticMode: false } as Config })
    const handler = registerIpcOnMock.mock.calls.find(
      (c) => c[0] === 'diagnostics:snapshot'
    )![1] as (evt: unknown, snap: unknown) => void
    handler({}, { ts: 1, graphs: {} })
    expect(diagnosticWriteMock).not.toHaveBeenCalled()
  })

  test('diagnostics:snapshot is written when diagnosticMode is on', () => {
    const store = new TelemetryStore()
    setupTelemetry({ store, initialConfig: { diagnosticMode: true } as Config })
    const handler = registerIpcOnMock.mock.calls.find(
      (c) => c[0] === 'diagnostics:snapshot'
    )![1] as (evt: unknown, snap: unknown) => void
    handler({}, { ts: 1, graphs: {} })
    expect(diagnosticWriteMock).toHaveBeenCalledWith({ ts: 1, graphs: {} })
  })

  test('diagnostics:snapshot follows a live config change', () => {
    const store = new TelemetryStore()
    setupTelemetry({ store, initialConfig: { diagnosticMode: false } as Config })
    const onChange = configEvents.on.mock.calls.find((c) => c[0] === 'changed')![1] as (
      cfg: Config
    ) => void
    const handler = registerIpcOnMock.mock.calls.find(
      (c) => c[0] === 'diagnostics:snapshot'
    )![1] as (evt: unknown, snap: unknown) => void
    handler({}, { ts: 1 })
    expect(diagnosticWriteMock).not.toHaveBeenCalled()
    onChange({ diagnosticMode: true } as Config)
    handler({}, { ts: 2 })
    expect(diagnosticWriteMock).toHaveBeenCalledTimes(1)
  })

  test('diagnostics:clear invokes the logger clear', () => {
    const store = new TelemetryStore()
    setupTelemetry({ store, initialConfig: {} as Config })
    const handler = registerIpcHandleMock.mock.calls.find(
      (c) => c[0] === 'diagnostics:clear'
    )![1] as () => unknown
    const res = handler()
    expect(diagnosticClearMock).toHaveBeenCalled()
    expect(res).toEqual({ ok: true })
  })

  test('initialConfig.lastKnownGps hydrates the store', () => {
    const store = new TelemetryStore()
    setupTelemetry({
      store,
      initialConfig: {
        lastKnownGps: { lat: 52, lng: 13, ts: 1_700_000_000 }
      } as unknown as Config
    })
    expect(store.snapshot().gps).toMatchObject({ lat: 52, lng: 13 })
  })

  test('with a projectionService, plugged hook fires hydrate calls', () => {
    const store = new TelemetryStore()
    const proj = fakeProjection()
    setupTelemetry({ store, projectionService: proj })
    expect(proj.addPluggedHook).toHaveBeenCalled()
    // Calling the hook should not throw
    const hook = (proj.addPluggedHook as jest.Mock).mock.calls[0][0] as () => void
    expect(() => hook()).not.toThrow()
  })

  test('dispose removes all IPC + listeners', () => {
    const store = new TelemetryStore()
    const handle = setupTelemetry({ store })
    handle.dispose()
    expect(removeAllListenersMock).toHaveBeenCalledWith('telemetry:push')
    expect(removeHandlerMock).toHaveBeenCalledWith('telemetry:snapshot')
    expect(configEvents.off).toHaveBeenCalled()
  })
})
