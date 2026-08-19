import type { Config } from '@shared/types'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ProjectionResolutionControl, resolutionPatch } from '../ProjectionResolutionControl'

const saveSettings = jest.fn()

jest.mock('@store/store', () => ({
  useLiviStore: (selector: (s: { saveSettings: typeof saveSettings }) => unknown) =>
    selector({ saveSettings })
}))

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, fb?: string) => fb ?? k })
}))

const restart = jest.fn()

const renderControl = (cfg: Partial<Config>) =>
  render(
    <ProjectionResolutionControl
      state={cfg as never}
      node={{
        type: 'custom',
        label: 'CarPlay Resolution',
        path: '',
        component: ProjectionResolutionControl
      }}
      onChange={jest.fn()}
    />
  )

const openSelect = () => {
  fireEvent.mouseDown(screen.getByRole('combobox'))
  return screen.getByRole('listbox')
}

describe('ProjectionResolutionControl', () => {
  beforeEach(() => {
    saveSettings.mockReset()
    saveSettings.mockResolvedValue(undefined)
    restart.mockReset()
    restart.mockResolvedValue(undefined)
    ;(window as unknown as { projection: unknown }).projection = { ipc: { restart } }
  })

  test('resolutionPatch writes the coherent group with scaled even insets', () => {
    // 107/800 = 13.375%; the lower tiers keep the square within a third of a
    // screen pixel of native (96/720, 72/540, 64/480 all map to 106.67px).
    expect(resolutionPatch(800)).toEqual({
      projectionWidth: 800,
      projectionHeight: 800,
      projectionViewAreaTop: 107,
      projectionViewAreaBottom: 107,
      projectionViewAreaLeft: 107,
      projectionViewAreaRight: 107
    })
    for (const [size, inset] of [
      [720, 96],
      [540, 72],
      [480, 64]
    ] as const) {
      const patch = resolutionPatch(size)
      expect(patch.projectionWidth).toBe(size)
      expect(patch.projectionHeight).toBe(size)
      expect(patch.projectionViewAreaTop).toBe(inset)
      expect(patch.projectionViewAreaBottom).toBe(inset)
      expect(patch.projectionViewAreaLeft).toBe(inset)
      expect(patch.projectionViewAreaRight).toBe(inset)
      // Even, so SendViewArea's toEven never shifts the square off-center.
      expect(inset % 2).toBe(0)
      // Same fraction of the frame as the native square, within rounding.
      expect(Math.abs(inset / size - 107 / 800)).toBeLessThan(0.002)
    }
  })

  test('shows the saved resolution and confirms before changing anything', () => {
    renderControl({ projectionWidth: 800, projectionHeight: 800 })
    expect(screen.getByRole('combobox')).toHaveTextContent('800 × 800 (native)')

    const listbox = openSelect()
    fireEvent.click(within(listbox).getByText('720 × 720'))

    // Nothing is written until the dialog is confirmed.
    expect(saveSettings).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveTextContent('Switch to 720 × 720?')
  })

  test('confirm saves the full patch then restarts the projection session', async () => {
    renderControl({ projectionWidth: 800, projectionHeight: 800 })
    fireEvent.click(within(openSelect()).getByText('540 × 540'))
    fireEvent.click(screen.getByText('Save & Reconnect'))

    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1))
    expect(saveSettings).toHaveBeenCalledWith(resolutionPatch(540))
    await waitFor(() => expect(restart).toHaveBeenCalledTimes(1))
  })

  test('cancel discards the pending change', () => {
    renderControl({ projectionWidth: 800, projectionHeight: 800 })
    fireEvent.click(within(openSelect()).getByText('480 × 480'))
    fireEvent.click(screen.getByText('Cancel'))

    expect(saveSettings).not.toHaveBeenCalled()
    expect(restart).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('re-selecting the current resolution is a no-op', () => {
    renderControl({ projectionWidth: 720, projectionHeight: 720 })
    fireEvent.click(within(openSelect()).getByText('720 × 720'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(saveSettings).not.toHaveBeenCalled()
  })

  test('a hand-edited non-square config renders as Custom', () => {
    renderControl({ projectionWidth: 1280, projectionHeight: 720 })
    expect(screen.getByRole('combobox')).toHaveTextContent('Custom (1280 × 720)')
  })
})
