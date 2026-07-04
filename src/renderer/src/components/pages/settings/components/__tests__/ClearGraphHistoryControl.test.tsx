import { MOTO_CLEAR_GRAPH_HISTORY_EVENT } from '@renderer/components/pages/projection/motoGraphEvents'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ClearGraphHistoryControl } from '../ClearGraphHistoryControl'

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, fb?: string) => fb ?? k })
}))

const renderControl = () =>
  render(
    <ClearGraphHistoryControl
      state={{} as never}
      node={{
        type: 'custom',
        label: 'Graph History',
        path: '',
        component: ClearGraphHistoryControl
      }}
      onChange={jest.fn()}
    />
  )

describe('ClearGraphHistoryControl', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  test('arms then dispatches graph history clear on second tap', () => {
    const handler = jest.fn()
    window.addEventListener(MOTO_CLEAR_GRAPH_HISTORY_EVENT, handler)

    try {
      renderControl()

      const button = screen.getByRole('button')
      expect(button).toHaveTextContent('CLEAR LOG')

      fireEvent.click(button)
      expect(handler).not.toHaveBeenCalled()
      expect(button).toHaveTextContent('TAP TO CONFIRM')

      fireEvent.click(button)
      expect(handler).toHaveBeenCalledTimes(1)
      expect(button).toHaveTextContent('CLEAR LOG')
    } finally {
      window.removeEventListener(MOTO_CLEAR_GRAPH_HISTORY_EVENT, handler)
    }
  })

  test('arming reverts after timeout without dispatching', () => {
    const handler = jest.fn()
    window.addEventListener(MOTO_CLEAR_GRAPH_HISTORY_EVENT, handler)

    try {
      renderControl()

      const button = screen.getByRole('button')
      fireEvent.click(button)
      expect(button).toHaveTextContent('TAP TO CONFIRM')

      act(() => {
        jest.advanceTimersByTime(3000)
      })

      expect(handler).not.toHaveBeenCalled()
      expect(button).toHaveTextContent('CLEAR LOG')
    } finally {
      window.removeEventListener(MOTO_CLEAR_GRAPH_HISTORY_EVENT, handler)
    }
  })
})
