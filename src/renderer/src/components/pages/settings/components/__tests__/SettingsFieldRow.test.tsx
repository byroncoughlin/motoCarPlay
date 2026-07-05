import { render, screen } from '@testing-library/react'
import { SettingsFieldRow } from '../SettingsFieldRow'

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, fb?: string) => `t:${k}:${fb ?? ''}` })
}))

jest.mock('../SettingsFieldControl', () => ({
  SettingsFieldControl: () => <div data-testid="field-control" />
}))
jest.mock('../SettingsFieldPage', () => ({
  SettingsFieldPage: () => <div data-testid="field-page" />
}))
jest.mock('../btDeviceList/BtDeviceList', () => ({
  BtDeviceList: () => <div data-testid="bt-list" />
}))
jest.mock('../stackItem', () => ({
  StackItem: ({ children, onClick }: any) => (
    <button data-testid="stack-item" onClick={onClick}>
      {children}
    </button>
  )
}))
jest.mock('../settingsItemRow', () => ({
  SettingsItemRow: ({ children, label }: any) => (
    <div data-testid="settings-item-row">
      {label}
      {children}
    </div>
  )
}))

describe('SettingsFieldRow', () => {
  test('renders BtDeviceList for btDeviceList node', () => {
    render(
      <SettingsFieldRow
        node={{ type: 'btDeviceList', path: 'bt', label: 'BT' } as any}
        value={null}
        state={{}}
        onChange={jest.fn()}
      />
    )
    expect(screen.getByTestId('bt-list')).toBeInTheDocument()
  })

  test('renders StackItem when onClick is provided', () => {
    const onClick = jest.fn()
    render(
      <SettingsFieldRow
        node={{ type: 'route', path: 'audio', route: 'audio', label: 'Audio', children: [] } as any}
        value={null}
        state={{}}
        onChange={jest.fn()}
        onClick={onClick}
      />
    )
    expect(screen.getByTestId('stack-item')).toBeInTheDocument()
    expect(screen.getByText('Audio')).toBeInTheDocument()
  })

  test('renders SettingsItemRow + SettingsFieldControl by default', () => {
    render(
      <SettingsFieldRow
        node={{ type: 'text', path: 'name', label: 'Name' } as any}
        value={'x'}
        state={{ name: 'x' }}
        onChange={jest.fn()}
      />
    )
    expect(screen.getByTestId('settings-item-row')).toBeInTheDocument()
    expect(screen.getByTestId('field-control')).toBeInTheDocument()
  })

  test('checkbox rows toggle from a tap anywhere on the row', () => {
    const onChange = jest.fn()
    render(
      <SettingsFieldRow
        node={{ type: 'checkbox', path: 'mute', label: 'Mute' } as any}
        value={false}
        state={{ mute: false }}
        onChange={onChange}
      />
    )
    const row = screen.getByTestId('stack-item')
    expect(screen.getByTestId('field-control')).toBeInTheDocument()
    row.click()
    expect(onChange).toHaveBeenCalledWith(true)
  })

  test('disabled checkbox rows do not toggle from a row tap', () => {
    const onChange = jest.fn()
    render(
      <SettingsFieldRow
        node={{ type: 'checkbox', path: 'mute', label: 'Mute', disabled: true } as any}
        value={false}
        state={{ mute: false }}
        onChange={onChange}
      />
    )
    screen.getByTestId('stack-item').click()
    expect(onChange).not.toHaveBeenCalled()
  })
})
