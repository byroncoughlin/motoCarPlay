import { act, renderHook } from '@testing-library/react'
import { useSmartSettings } from '../useSmartSettings'

const saveSettings = jest.fn()
const markRestartBaseline = jest.fn()
const restartApp = jest.fn()
let isDongleConnected = true

jest.mock('@store/store', () => ({
  useLiviStore: (selector: (s: any) => unknown) =>
    selector({
      saveSettings,
      restartBaseline: { projectionWidth: 800, bindings: { back: 'KeyB' } },
      markRestartBaseline
    }),
  useStatusStore: (selector: (s: any) => unknown) => selector({ isDongleConnected })
}))

describe('useSmartSettings', () => {
  beforeEach(() => {
    saveSettings.mockReset()
    markRestartBaseline.mockReset()
    restartApp.mockReset().mockResolvedValue(undefined)
    isDongleConnected = true
    ;(window as any).projection = { usb: { forceReset: jest.fn().mockResolvedValue(true) } }
    ;(window as any).app = { restartApp }
  })

  test('handleFieldChange updates state and persists settings', () => {
    const initial = { projectionWidth: 800, 'bindings.back': 'KeyB' } as any
    const settings = { projectionWidth: 800, bindings: { back: 'KeyB' } } as any
    const { result } = renderHook(() => useSmartSettings(initial, settings))

    act(() => {
      result.current.handleFieldChange('projectionWidth', 900)
    })

    expect(result.current.state.projectionWidth).toBe(900)
    expect(saveSettings).toHaveBeenCalled()
    expect(result.current.isDirty).toBe(true)
  })

  test('requestRestart ignores bindings paths but marks relevant paths', () => {
    const initial = { projectionWidth: 800, 'bindings.back': 'KeyB' } as any
    const settings = { projectionWidth: 800 } as any
    const { result } = renderHook(() => useSmartSettings(initial, settings))

    act(() => result.current.requestRestart('bindings.back'))
    expect(result.current.needsRestart).toBe(false)

    act(() => result.current.requestRestart('projectionWidth'))
    expect(result.current.needsRestart).toBe(true)
  })

  test('restart requires dongle connection and calls forceReset', async () => {
    const initial = { projectionWidth: 800 } as any
    const settings = { projectionWidth: 800 } as any
    const { result } = renderHook(() => useSmartSettings(initial, settings))
    act(() => result.current.requestRestart('projectionWidth'))
    await act(async () => {
      await result.current.restart()
    })
    expect((window as any).projection.usb.forceReset).toHaveBeenCalled()
    expect(markRestartBaseline).toHaveBeenCalled()

    isDongleConnected = false
    const h2 = renderHook(() => useSmartSettings(initial, settings))
    await act(async () => {
      expect(await h2.result.current.restart()).toBe(false)
    })
  })

  test('restart returns false when needsRestart is false', async () => {
    // line 88: if (!needsRestart) return false
    const initial = { projectionWidth: 800 } as any
    const settings = { projectionWidth: 800 } as any
    const { result } = renderHook(() => useSmartSettings(initial, settings))
    // needsRestart is false (no requestRestart called, no baseline diff)
    await act(async () => {
      expect(await result.current.restart()).toBe(false)
    })
    expect((window as any).projection.usb.forceReset).not.toHaveBeenCalled()
  })

  test('needsRestartFromConfig detects when settings differ from restartBaseline', () => {
    // lines 44-53: restartBaseline[key] !== settings[key] for a restart-relevant key
    // The store mock has restartBaseline.projectionWidth = 800, settings.projectionWidth = 900 would differ
    const initial = { projectionWidth: 900 } as any
    const settings = { projectionWidth: 900 } as any
    // restartBaseline from mock has projectionWidth: 800 → needsRestartFromConfig = true
    const { result } = renderHook(() => useSmartSettings(initial, settings))
    expect(result.current.needsRestart).toBe(true)
  })

  test('handleFieldChange with transform override applies transformation', () => {
    // lines 68-69: override?.transform is called
    const initial = { volume: 50 } as any
    const settings = { volume: 50 } as any
    const transform = jest.fn((v: unknown) => (v as number) * 2)
    const { result } = renderHook(() =>
      useSmartSettings(initial, settings, {
        overrides: { volume: { transform } }
      })
    )

    act(() => {
      result.current.handleFieldChange('volume', 10)
    })

    expect(transform).toHaveBeenCalledWith(10, 50)
    expect(result.current.state.volume).toBe(20)
  })

  test('backdrop changes require confirmation and restart the app', async () => {
    const initial = {
      backdropEnabled: false,
      ambientFillEnabled: true,
      roundedCornerMaskEnabled: false
    } as any
    const settings = {
      backdropEnabled: false,
      ambientFillEnabled: true,
      roundedCornerMaskEnabled: false
    } as any
    const { result } = renderHook(() => useSmartSettings(initial, settings))

    act(() => {
      result.current.handleFieldChange('backdropEnabled', true)
    })

    expect(result.current.state.backdropEnabled).toBe(false)
    expect(result.current.pendingAppRestartChange?.nextBackdropEnabled).toBe(true)
    expect(result.current.pendingAppRestartChange?.kind).toBe('enable')
    expect(saveSettings).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.confirmPendingAppRestartChange()
    })

    expect(result.current.state.backdropEnabled).toBe(true)
    expect(result.current.state.ambientFillEnabled).toBe(false)
    expect(result.current.state.roundedCornerMaskEnabled).toBe(true)
    expect(saveSettings).toHaveBeenLastCalledWith({
      backdropEnabled: true,
      ambientFillEnabled: false,
      roundedCornerMaskEnabled: true
    })
    expect(restartApp).toHaveBeenCalledTimes(1)
  })

  test('background fill disables backdrop through the restart confirmation path', async () => {
    const initial = {
      backdropEnabled: true,
      ambientFillEnabled: false,
      roundedCornerMaskEnabled: false
    } as any
    const settings = {
      backdropEnabled: true,
      ambientFillEnabled: false,
      roundedCornerMaskEnabled: false
    } as any
    const { result } = renderHook(() => useSmartSettings(initial, settings))

    act(() => {
      result.current.handleFieldChange('ambientFillEnabled', true)
    })

    expect(result.current.state.backdropEnabled).toBe(true)
    expect(result.current.pendingAppRestartChange?.nextBackdropEnabled).toBe(false)
    expect(result.current.pendingAppRestartChange?.kind).toBe('disable')
    expect(saveSettings).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.confirmPendingAppRestartChange()
    })

    expect(result.current.state.backdropEnabled).toBe(false)
    expect(result.current.state.ambientFillEnabled).toBe(true)
    expect(result.current.state.roundedCornerMaskEnabled).toBe(true)
    expect(saveSettings).toHaveBeenLastCalledWith({
      backdropEnabled: false,
      ambientFillEnabled: true,
      roundedCornerMaskEnabled: true
    })
    expect(restartApp).toHaveBeenCalledTimes(1)
  })

  test('corner mask can be turned back off after fill toggles enable it', () => {
    const initial = {
      backdropEnabled: false,
      ambientFillEnabled: true,
      roundedCornerMaskEnabled: true
    } as any
    const settings = {
      backdropEnabled: false,
      ambientFillEnabled: true,
      roundedCornerMaskEnabled: true
    } as any
    const { result } = renderHook(() => useSmartSettings(initial, settings))

    act(() => {
      result.current.handleFieldChange('roundedCornerMaskEnabled', false)
    })

    expect(result.current.state.ambientFillEnabled).toBe(true)
    expect(result.current.state.roundedCornerMaskEnabled).toBe(false)
    expect(saveSettings).toHaveBeenLastCalledWith({
      backdropEnabled: false,
      ambientFillEnabled: true,
      roundedCornerMaskEnabled: false
    })
  })

  test('turning off backdrop or background fill keeps the corner mask on', async () => {
    // Background-mode changes must never silently disable the rounded corners;
    // only the explicit "Round Corners" checkbox does.
    const backdropSettings = {
      backdropEnabled: true,
      ambientFillEnabled: false,
      roundedCornerMaskEnabled: true
    } as any
    const backdrop = renderHook(() => useSmartSettings(backdropSettings, backdropSettings))

    act(() => {
      backdrop.result.current.handleFieldChange('backdropEnabled', false)
    })

    expect(backdrop.result.current.state.backdropEnabled).toBe(true)
    expect(backdrop.result.current.pendingAppRestartChange?.nextBackdropEnabled).toBe(false)
    expect(backdrop.result.current.pendingAppRestartChange?.kind).toBe('disable')
    expect(saveSettings).not.toHaveBeenCalled()

    await act(async () => {
      await backdrop.result.current.confirmPendingAppRestartChange()
    })

    expect(backdrop.result.current.state.backdropEnabled).toBe(false)
    expect(backdrop.result.current.state.roundedCornerMaskEnabled).toBe(true)
    expect(saveSettings).toHaveBeenLastCalledWith({
      backdropEnabled: false,
      ambientFillEnabled: false,
      roundedCornerMaskEnabled: true
    })

    saveSettings.mockClear()
    restartApp.mockClear()

    const fillSettings = {
      backdropEnabled: false,
      ambientFillEnabled: true,
      roundedCornerMaskEnabled: true
    } as any
    const fill = renderHook(() => useSmartSettings(fillSettings, fillSettings))

    act(() => {
      fill.result.current.handleFieldChange('ambientFillEnabled', false)
    })

    expect(fill.result.current.state.ambientFillEnabled).toBe(false)
    expect(fill.result.current.state.roundedCornerMaskEnabled).toBe(true)
    expect(saveSettings).toHaveBeenLastCalledWith({
      backdropEnabled: false,
      ambientFillEnabled: false,
      roundedCornerMaskEnabled: true
    })
    expect(restartApp).not.toHaveBeenCalled()
  })

  test('active backdrop style changes require confirmation and restart the app', async () => {
    const initial = {
      backdropEnabled: true,
      backdropMode: 'color',
      ambientFillEnabled: false,
      roundedCornerMaskEnabled: true
    } as any
    const settings = { ...initial }
    const { result } = renderHook(() => useSmartSettings(initial, settings))

    act(() => {
      result.current.handleFieldChange('backdropMode', 'blur')
    })

    expect(result.current.state.backdropMode).toBe('color')
    expect(result.current.pendingAppRestartChange?.nextBackdropEnabled).toBe(true)
    expect(result.current.pendingAppRestartChange?.kind).toBe('mode')
    expect(saveSettings).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.confirmPendingAppRestartChange()
    })

    expect(result.current.state.backdropMode).toBe('blur')
    expect(saveSettings).toHaveBeenLastCalledWith({
      backdropEnabled: true,
      backdropMode: 'blur',
      ambientFillEnabled: false,
      roundedCornerMaskEnabled: true
    })
    expect(restartApp).toHaveBeenCalledTimes(1)
  })

  test('inactive backdrop style changes save without app restart', () => {
    const initial = {
      backdropEnabled: false,
      backdropMode: 'color',
      ambientFillEnabled: false,
      roundedCornerMaskEnabled: false
    } as any
    const settings = { ...initial }
    const { result } = renderHook(() => useSmartSettings(initial, settings))

    act(() => {
      result.current.handleFieldChange('backdropMode', 'blur')
    })

    expect(result.current.pendingAppRestartChange).toBeNull()
    expect(result.current.state.backdropMode).toBe('blur')
    expect(saveSettings).toHaveBeenLastCalledWith({
      backdropEnabled: false,
      backdropMode: 'blur',
      ambientFillEnabled: false,
      roundedCornerMaskEnabled: false
    })
    expect(restartApp).not.toHaveBeenCalled()
  })

  test('cancels a pending backdrop restart change without saving', () => {
    const initial = {
      backdropEnabled: false,
      ambientFillEnabled: false,
      roundedCornerMaskEnabled: false
    } as any
    const settings = { ...initial }
    const { result } = renderHook(() => useSmartSettings(initial, settings))

    act(() => {
      result.current.handleFieldChange('backdropEnabled', true)
    })
    expect(result.current.pendingAppRestartChange).not.toBeNull()

    act(() => {
      result.current.cancelPendingAppRestartChange()
    })

    expect(result.current.pendingAppRestartChange).toBeNull()
    expect(result.current.state.backdropEnabled).toBe(false)
    expect(saveSettings).not.toHaveBeenCalled()
    expect(restartApp).not.toHaveBeenCalled()
  })

  test('handleFieldChange with validate override blocks invalid values', () => {
    // line 69: override?.validate returning false → no state update
    const initial = { volume: 50 } as any
    const settings = { volume: 50 } as any
    const validate = jest.fn(() => false) // always reject
    const { result } = renderHook(() =>
      useSmartSettings(initial, settings, {
        overrides: { volume: { validate } }
      })
    )

    act(() => {
      result.current.handleFieldChange('volume', 999)
    })

    expect(validate).toHaveBeenCalled()
    expect(result.current.state.volume).toBe(50) // unchanged
  })
})
