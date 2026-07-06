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
      expect(button).toHaveTextContent('Clear Log')

      fireEvent.click(button)
      expect(handler).not.toHaveBeenCalled()
      expect(button).toHaveTextContent('Tap to Confirm')

      fireEvent.click(button)
      expect(handler).toHaveBeenCalledTimes(1)
      expect(button).toHaveTextContent('Cleared')

      act(() => {
        jest.advanceTimersByTime(4000)
      })
      expect(button).toHaveTextContent('Clear Log')
    } finally {
      window.removeEventListener(MOTO_CLEAR_GRAPH_HISTORY_EVENT, handler)
    }
  })

  test('armed state never expires — confirm still works after a long pause', () => {
    const handler = jest.fn()
    window.addEventListener(MOTO_CLEAR_GRAPH_HISTORY_EVENT, handler)

    try {
      renderControl()

      const button = screen.getByRole('button')
      fireEvent.click(button)
      expect(button).toHaveTextContent('Tap to Confirm')

      act(() => {
        jest.advanceTimersByTime(60_000)
      })

      expect(handler).not.toHaveBeenCalled()
      expect(button).toHaveTextContent('Tap to Confirm')

      fireEvent.click(button)
      expect(handler).toHaveBeenCalledTimes(1)
      expect(button).toHaveTextContent('Cleared')
    } finally {
      window.removeEventListener(MOTO_CLEAR_GRAPH_HISTORY_EVENT, handler)
    }
  })
})
