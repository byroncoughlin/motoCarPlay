import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TiltCalibrationControl } from '../TiltCalibrationControl'

const saveSettings = jest.fn()
const getTelemetrySnapshot = jest.fn()

jest.mock('@store/store', () => ({
  useLiviStore: (selector: (s: { saveSettings: typeof saveSettings }) => unknown) =>
    selector({ saveSettings })
}))

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, fb?: string) => fb ?? k })
}))

const renderControl = (state = {}) =>
  render(
    <TiltCalibrationControl
      state={state as never}
      node={{
        type: 'custom',
        label: 'Tilt Calibration',
        path: '',
        component: TiltCalibrationControl
      }}
      onChange={jest.fn()}
    />
  )

describe('TiltCalibrationControl', () => {
  beforeEach(() => {
    saveSettings.mockReset()
    saveSettings.mockResolvedValue(undefined)
    getTelemetrySnapshot.mockReset()

    Object.defineProperty(window, 'projection', {
      configurable: true,
      value: {
        ipc: {
          getTelemetrySnapshot
        }
      }
    })
  })

  test('shows current offsets compactly', () => {
    renderControl({ leanOffset: 1.25, pitchOffset: -2 })
    expect(screen.getByText('L 1.3° P -2.0°')).toBeInTheDocument()
  })

  test('set level saves current raw lean and pitch as offsets', async () => {
    getTelemetrySnapshot.mockResolvedValue({ leanDeg: 12.34, pitchDeg: -3.21 })
    renderControl()

    fireEvent.click(screen.getByRole('button', { name: 'Set Level' }))

    await waitFor(() => {
      expect(saveSettings).toHaveBeenCalledWith({ leanOffset: 12.34, pitchOffset: -3.21 })
    })
  })

  test('set level negates the lean offset when reverse tilt is on (zeroes the readout)', async () => {
    getTelemetrySnapshot.mockResolvedValue({ leanDeg: 12.34, pitchDeg: -3.21 })
    renderControl({ reverseTilt: true })

    fireEvent.click(screen.getByRole('button', { name: 'Set Level' }))

    await waitFor(() => {
      expect(saveSettings).toHaveBeenCalledWith({ leanOffset: -12.34, pitchOffset: -3.21 })
    })
  })

  test('set level negates the pitch offset when reverse front/back is on', async () => {
    getTelemetrySnapshot.mockResolvedValue({ leanDeg: 12.34, pitchDeg: -3.21 })
    renderControl({ reversePitch: true })

    fireEvent.click(screen.getByRole('button', { name: 'Set Level' }))

    await waitFor(() => {
      expect(saveSettings).toHaveBeenCalledWith({ leanOffset: 12.34, pitchOffset: 3.21 })
    })
  })

  test('set level negates both offsets when both reverses are on', async () => {
    getTelemetrySnapshot.mockResolvedValue({ leanDeg: 12.34, pitchDeg: -3.21 })
    renderControl({ reverseTilt: true, reversePitch: true })

    fireEvent.click(screen.getByRole('button', { name: 'Set Level' }))

    await waitFor(() => {
      expect(saveSettings).toHaveBeenCalledWith({ leanOffset: -12.34, pitchOffset: 3.21 })
    })
  })

  test('set level falls back to zero when no tilt snapshot is available', async () => {
    getTelemetrySnapshot.mockResolvedValue(null)
    renderControl()

    fireEvent.click(screen.getByRole('button', { name: 'Set Level' }))

    await waitFor(() => {
      expect(saveSettings).toHaveBeenCalledWith({ leanOffset: 0, pitchOffset: 0 })
    })
  })

  test('reset clears both offsets', async () => {
    renderControl({ leanOffset: 8, pitchOffset: -4 })

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))

    await waitFor(() => {
      expect(saveSettings).toHaveBeenCalledWith({ leanOffset: 0, pitchOffset: 0 })
    })
  })
})
