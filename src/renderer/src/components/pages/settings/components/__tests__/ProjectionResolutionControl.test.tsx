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

const NATIVE: Partial<Config> = {
  projectionWidth: 800,
  projectionHeight: 800,
  projectionViewAreaTop: 107,
  projectionViewAreaBottom: 107,
  projectionViewAreaLeft: 107,
  projectionViewAreaRight: 107
}

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

  test('options are named by the content square; streams derived backwards', () => {
    // safe = stream − 2·inset must hold EXACTLY — that is the whole point of
    // the reverse derivation. Streams and insets even (SendViewArea toEven,
    // H.264); 736 and 656 are even multiples of 16 (macroblock aligned).
    for (const [safe, stream, inset] of [
      [586, 800, 107],
      [540, 736, 98],
      [480, 656, 88]
    ] as const) {
      const patch = resolutionPatch(safe)
      expect(patch.projectionWidth).toBe(stream)
      expect(patch.projectionHeight).toBe(stream)
      expect(patch.projectionViewAreaTop).toBe(inset)
      expect(patch.projectionViewAreaBottom).toBe(inset)
      expect(patch.projectionViewAreaLeft).toBe(inset)
      expect(patch.projectionViewAreaRight).toBe(inset)
      expect(stream - 2 * inset).toBe(safe)
      expect(stream % 2).toBe(0)
      if (safe !== 586) {
        expect(inset % 2).toBe(0)
        expect(stream % 16).toBe(0)
        // The upscaled square stays within ~1px of the native 586 on glass.
        expect(Math.abs(safe * (800 / stream) - 586)).toBeLessThan(1.1)
      }
    }
    expect(resolutionPatch(720)).toEqual({})
  })

  test('shows the saved content square and confirms before changing anything', () => {
    renderControl(NATIVE)
    expect(screen.getByRole('combobox')).toHaveTextContent('586 × 586 (native)')

    fireEvent.click(within(openSelect()).getByText('540 × 540'))

    expect(saveSettings).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveTextContent('Switch to 540 × 540?')
  })

  test('confirm saves the derived stream patch then restarts projection', async () => {
    renderControl(NATIVE)
    fireEvent.click(within(openSelect()).getByText('540 × 540'))
    fireEvent.click(screen.getByText('Save & Reconnect'))

    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1))
    expect(saveSettings).toHaveBeenCalledWith(resolutionPatch(540))
    expect(saveSettings.mock.calls[0][0].projectionWidth).toBe(736)
    await waitFor(() => expect(restart).toHaveBeenCalledTimes(1))
  })

  test('cancel discards the pending change', () => {
    renderControl(NATIVE)
    fireEvent.click(within(openSelect()).getByText('480 × 480'))
    fireEvent.click(screen.getByText('Cancel'))

    expect(saveSettings).not.toHaveBeenCalled()
    expect(restart).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('re-selecting the current option is a no-op', () => {
    renderControl({
      projectionWidth: 736,
      projectionHeight: 736,
      projectionViewAreaTop: 98,
      projectionViewAreaBottom: 98,
      projectionViewAreaLeft: 98,
      projectionViewAreaRight: 98
    })
    expect(screen.getByRole('combobox')).toHaveTextContent('540 × 540')
    fireEvent.click(within(openSelect()).getByText('540 × 540'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(saveSettings).not.toHaveBeenCalled()
  })

  test('a hand-edited config renders as Custom with its content square', () => {
    // The old 720-stream option (insets 96): content square 528×528.
    renderControl({
      projectionWidth: 720,
      projectionHeight: 720,
      projectionViewAreaTop: 96,
      projectionViewAreaBottom: 96,
      projectionViewAreaLeft: 96,
      projectionViewAreaRight: 96
    })
    expect(screen.getByRole('combobox')).toHaveTextContent('Custom (528 × 528)')
  })
})
