import { fireEvent, render, screen, within } from '@testing-library/react'
import type { Config } from '@shared/types'
import { ProjectionResolutionControl } from '../ProjectionResolutionControl'

const saveSettings = jest.fn()

jest.mock('@store/store', () => ({
  useLiviStore: (selector: (s: { saveSettings: typeof saveSettings }) => unknown) =>
    selector({ saveSettings })
}))

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, fb?: string) => fb ?? k })
}))

const renderControl = (state: Partial<Config> = {}, requestRestart = jest.fn()) => {
  render(
    <ProjectionResolutionControl
      state={state as never}
      node={{
        type: 'custom',
        label: 'CarPlay Resolution',
        path: 'projectionWidth',
        component: ProjectionResolutionControl
      }}
      onChange={jest.fn()}
      requestRestart={requestRestart}
    />
  )
  return { requestRestart }
}

const openAndPick = (labelText: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox'))
  const listbox = within(screen.getByRole('listbox'))
  fireEvent.click(listbox.getByText(labelText))
}

describe('ProjectionResolutionControl', () => {
  beforeEach(() => {
    saveSettings.mockReset()
    saveSettings.mockResolvedValue(undefined)
  })

  test('maps a legacy 800×800 config to the closest (586) preset', () => {
    renderControl({ projectionWidth: 800, projectionHeight: 800, projectionViewAreaLeft: 107 })
    expect(screen.getByRole('combobox')).toHaveTextContent('586×586')
  })

  test('reflects a configured 320×320 stream', () => {
    renderControl({ projectionWidth: 320, projectionHeight: 320, projectionViewAreaLeft: 0 })
    expect(screen.getByRole('combobox')).toHaveTextContent('320×320')
  })

  test('offers all four contained presets', () => {
    renderControl({ projectionWidth: 586 })
    fireEvent.mouseDown(screen.getByRole('combobox'))
    const listbox = within(screen.getByRole('listbox'))
    for (const label of ['586×586', '480×480', '320×320', '300×300']) {
      expect(listbox.getByText(label)).toBeInTheDocument()
    }
    expect(listbox.queryByText('800×800')).not.toBeInTheDocument()
  })

  test('selecting a small preset writes width/height and zeroed view area, then requests restart', () => {
    const { requestRestart } = renderControl({
      projectionWidth: 586,
      projectionHeight: 586,
      projectionViewAreaLeft: 0
    })

    openAndPick('300×300')

    expect(saveSettings).toHaveBeenCalledTimes(1)
    expect(saveSettings).toHaveBeenCalledWith({
      projectionWidth: 300,
      projectionHeight: 300,
      projectionViewAreaTop: 0,
      projectionViewAreaBottom: 0,
      projectionViewAreaLeft: 0,
      projectionViewAreaRight: 0
    })
    expect(requestRestart).toHaveBeenCalledTimes(1)
  })

  test('every preset writes zeroed view-area insets (compositor handles containment)', () => {
    const { requestRestart } = renderControl({
      projectionWidth: 320,
      projectionHeight: 320,
      projectionViewAreaLeft: 0
    })

    openAndPick('480×480')

    expect(saveSettings).toHaveBeenCalledWith({
      projectionWidth: 480,
      projectionHeight: 480,
      projectionViewAreaTop: 0,
      projectionViewAreaBottom: 0,
      projectionViewAreaLeft: 0,
      projectionViewAreaRight: 0
    })
    expect(requestRestart).toHaveBeenCalledTimes(1)
  })

  test('re-selecting the current preset does nothing', () => {
    const { requestRestart } = renderControl({
      projectionWidth: 586,
      projectionHeight: 586,
      projectionViewAreaLeft: 0
    })

    openAndPick('586×586')

    expect(saveSettings).not.toHaveBeenCalled()
    expect(requestRestart).not.toHaveBeenCalled()
  })
})
