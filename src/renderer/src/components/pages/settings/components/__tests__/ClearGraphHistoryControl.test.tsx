import { fireEvent, render, screen } from '@testing-library/react'
import { MOTO_CLEAR_GRAPH_HISTORY_EVENT } from '@renderer/components/pages/projection/motoGraphEvents'
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
  test('confirms before dispatching graph history clear event', () => {
    const handler = jest.fn()
    window.addEventListener(MOTO_CLEAR_GRAPH_HISTORY_EVENT, handler)

    try {
      renderControl()

      fireEvent.click(screen.getByRole('button', { name: 'CLEAR LOG' }))
      expect(handler).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'CANCEL' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'CONFIRM' })).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'CONFIRM' }))
      expect(handler).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('button', { name: 'CLEAR LOG' })).toBeInTheDocument()
    } finally {
      window.removeEventListener(MOTO_CLEAR_GRAPH_HISTORY_EVENT, handler)
    }
  })

  test('cancel returns to the clear button without dispatching', () => {
    const handler = jest.fn()
    window.addEventListener(MOTO_CLEAR_GRAPH_HISTORY_EVENT, handler)

    try {
      renderControl()

      fireEvent.click(screen.getByRole('button', { name: 'CLEAR LOG' }))
      fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }))

      expect(handler).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'CLEAR LOG' })).toBeInTheDocument()
    } finally {
      window.removeEventListener(MOTO_CLEAR_GRAPH_HISTORY_EVENT, handler)
    }
  })
})
