import { fireEvent, render, screen } from '@testing-library/react'
import { SettingsLayout } from '../SettingsLayout'

const navigateMock = jest.fn()
let mockPathname = '/settings/system'

jest.mock('react-router', () => {
  const actual = jest.requireActual('react-router')
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useLocation: () => ({ pathname: mockPathname })
  }
})

describe('SettingsLayout', () => {
  beforeEach(() => {
    navigateMock.mockReset()
    mockPathname = '/settings/system'
    ;(window as any).app = {
      quitApp: jest.fn().mockResolvedValue(undefined),
      rebootSystem: jest.fn().mockResolvedValue({ ok: true })
    }
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 1
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('shows Back button outside root settings page and navigates back on click', () => {
    render(
      <SettingsLayout title="System" showRestart={false}>
        <div>Body</div>
      </SettingsLayout>
    )

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    expect(document.activeElement).toBe(input)

    fireEvent.click(screen.getByLabelText('Back'))

    expect(navigateMock).toHaveBeenCalledWith(-1)
    expect(document.activeElement).not.toBe(input)
  })

  test('hides Back button on root settings page', () => {
    mockPathname = '/settings'
    render(
      <SettingsLayout title="Settings" showRestart={false}>
        <div>Body</div>
      </SettingsLayout>
    )

    expect(screen.queryByLabelText('Back')).toBeNull()
  })

  test('closes root settings page back to projection', () => {
    mockPathname = '/settings'
    render(
      <SettingsLayout title="Settings" showRestart={false}>
        <div>Body</div>
      </SettingsLayout>
    )

    fireEvent.click(screen.getByLabelText('Close settings'))

    expect(navigateMock).toHaveBeenCalledWith('/', { replace: true })
  })

  test('renders Apply action and calls restart handler', () => {
    const onRestart = jest.fn()
    render(
      <SettingsLayout title="System" showRestart onRestart={onRestart}>
        <div>Body</div>
      </SettingsLayout>
    )

    fireEvent.click(screen.getByLabelText('Apply'))
    expect(onRestart).toHaveBeenCalledTimes(1)
  })

  test('blurs the active element before navigating back when it is not the body', () => {
    render(
      <SettingsLayout title="System" showRestart={false}>
        <div>Body</div>
      </SettingsLayout>
    )

    const input = document.createElement('input')
    document.body.appendChild(input)

    const blurSpy = jest.spyOn(input, 'blur')
    input.focus()

    fireEvent.click(screen.getByLabelText('Back'))

    expect(blurSpy).toHaveBeenCalledTimes(1)
    expect(navigateMock).toHaveBeenCalledWith(-1)
  })

  test('does not blur when the active element is the body', () => {
    render(
      <SettingsLayout title="System" showRestart={false}>
        <div>Body</div>
      </SettingsLayout>
    )

    const blurSpy = jest.spyOn(document.body, 'blur')
    document.body.focus()

    fireEvent.click(screen.getByLabelText('Back'))

    expect(blurSpy).not.toHaveBeenCalled()
    expect(navigateMock).toHaveBeenCalledWith(-1)
  })

  test('renders the settings clock in 12-hour time', () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-06-12T17:07:00'))
    mockPathname = '/settings'

    try {
      render(
        <SettingsLayout title="Settings" showRestart={false}>
          <div>Body</div>
        </SettingsLayout>
      )

      expect(screen.getByTestId('settings-clock')).toHaveTextContent('5:07')
    } finally {
      jest.useRealTimers()
    }
  })

  test('opens the Pi monitor via a window event', () => {
    const listener = jest.fn()
    window.addEventListener('livi:open-system-monitor', listener)
    render(
      <SettingsLayout title="System" showRestart={false}>
        <div>Body</div>
      </SettingsLayout>
    )

    fireEvent.click(screen.getByLabelText('Open Pi monitor'))
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener('livi:open-system-monitor', listener)
  })

  test('confirms exit to desktop before quitting the app', () => {
    render(
      <SettingsLayout title="System" showRestart={false}>
        <div>Body</div>
      </SettingsLayout>
    )

    fireEvent.click(screen.getByLabelText('Exit to desktop'))
    expect(screen.getByRole('dialog', { name: 'Exit to desktop?' })).toBeInTheDocument()
    expect((window as any).app.quitApp).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Exit'))
    expect((window as any).app.quitApp).toHaveBeenCalledTimes(1)
  })

  test('confirms Pi reboot before invoking rebootSystem', () => {
    render(
      <SettingsLayout title="System" showRestart={false}>
        <div>Body</div>
      </SettingsLayout>
    )

    fireEvent.click(screen.getByLabelText('Reboot Pi'))
    expect(screen.getByRole('dialog', { name: 'Reboot Pi?' })).toBeInTheDocument()
    expect((window as any).app.rebootSystem).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Reboot' }))
    expect((window as any).app.rebootSystem).toHaveBeenCalledTimes(1)
  })
})
