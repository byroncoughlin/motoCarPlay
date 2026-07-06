import { act, fireEvent, render, screen } from '@testing-library/react'
import { ClearDiagnosticsControl } from '../ClearDiagnosticsControl'

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, fb?: string) => fb ?? k })
}))

const clearDiagnosticsMock = jest.fn()

const renderControl = () =>
  render(
    <ClearDiagnosticsControl
      state={{} as never}
      node={{
        type: 'custom',
        label: 'Diagnostic Data',
        path: '',
        component: ClearDiagnosticsControl
      }}
      onChange={jest.fn()}
    />
  )

describe('ClearDiagnosticsControl', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    clearDiagnosticsMock.mockReset()
    ;(window as unknown as { projection: unknown }).projection = {
      ipc: { clearDiagnostics: clearDiagnosticsMock }
    }
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
    delete (window as unknown as { projection?: unknown }).projection
  })

  test('arm → confirm clears and reports the deleted count', async () => {
    clearDiagnosticsMock.mockResolvedValue({ ok: true, deleted: 91, remaining: 0 })
    renderControl()

    const button = screen.getByRole('button')
    expect(button).toHaveTextContent('Clear Data')

    fireEvent.click(button)
    expect(clearDiagnosticsMock).not.toHaveBeenCalled()
    expect(button).toHaveTextContent('Tap to Confirm')

    fireEvent.click(button)
    expect(clearDiagnosticsMock).toHaveBeenCalledTimes(1)
    await act(async () => {})
    expect(button).toHaveTextContent('Deleted 91 Files')

    act(() => {
      jest.advanceTimersByTime(4000)
    })
    expect(button).toHaveTextContent('Clear Data')
  })

  test('armed state never expires — confirm still works after a long pause', async () => {
    clearDiagnosticsMock.mockResolvedValue({ ok: true, deleted: 1, remaining: 0 })
    renderControl()

    const button = screen.getByRole('button')
    fireEvent.click(button)
    act(() => {
      jest.advanceTimersByTime(60_000)
    })
    expect(button).toHaveTextContent('Tap to Confirm')

    fireEvent.click(button)
    await act(async () => {})
    expect(button).toHaveTextContent('Deleted 1 File')
  })

  test('empty folder reports No Files Found', async () => {
    clearDiagnosticsMock.mockResolvedValue({ ok: true, deleted: 0, remaining: 0 })
    renderControl()

    const button = screen.getByRole('button')
    fireEvent.click(button)
    fireEvent.click(button)
    await act(async () => {})
    expect(button).toHaveTextContent('No Files Found')
  })

  test('surviving files report failure, not success', async () => {
    clearDiagnosticsMock.mockResolvedValue({ ok: false, deleted: 4, remaining: 2 })
    renderControl()

    const button = screen.getByRole('button')
    fireEvent.click(button)
    fireEvent.click(button)
    await act(async () => {})
    expect(button).toHaveTextContent('Clear Failed')
  })

  test('a rejected IPC reports failure', async () => {
    clearDiagnosticsMock.mockRejectedValue(new Error('ipc down'))
    renderControl()

    const button = screen.getByRole('button')
    fireEvent.click(button)
    fireEvent.click(button)
    await act(async () => {})
    expect(button).toHaveTextContent('Clear Failed')
  })
})
