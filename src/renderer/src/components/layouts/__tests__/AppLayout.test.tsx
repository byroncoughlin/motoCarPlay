import { act, fireEvent, render } from '@testing-library/react'
import { createRef } from 'react'
import { AppLayout } from '../AppLayout'

let mockPathname = '/'
let mockHand = 0

jest.mock('react-router', () => ({
  useLocation: () => ({ pathname: mockPathname })
}))

jest.mock('../../navigation', () => ({
  Nav: () => <div data-testid="nav">Nav</div>
}))

let mockTabCount = 4
jest.mock('../../navigation/useTabsConfig', () => ({
  useTabsConfig: () =>
    Array.from({ length: mockTabCount }, (_, i) => ({ path: `/${i}`, label: `t${i}`, icon: null }))
}))

jest.mock('@store/store', () => ({
  useLiviStore: (selector: (s: any) => unknown) => selector({ settings: { hand: mockHand } }),
  useStatusStore: (selector: (s: any) => unknown) => selector({ isStreaming: false })
}))

jest.mock('../../../hooks/useBlinkingTime', () => ({
  useBlinkingTime: () => '12:34'
}))

jest.mock('../../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ type: 'wifi', online: true })
}))

jest.mock('@mui/material/styles', () => {
  const actual = jest.requireActual('@mui/material/styles')
  return {
    ...actual,
    useTheme: () => ({
      palette: { background: { paper: '#111' } }
    })
  }
})

describe('AppLayout', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockPathname = '/'
    mockHand = 0
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    ;(window as any).app = { notifyUserActivity: jest.fn() }
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('removes nav on home so projection owns the full round surface', () => {
    const navRef = createRef<HTMLDivElement>()
    const mainRef = createRef<HTMLDivElement>()
    const { container } = render(
      <AppLayout navRef={navRef} mainRef={mainRef} receivingVideo={false}>
        <div>Content</div>
      </AppLayout>
    )
    expect(container.querySelector('#content-root')?.getAttribute('data-nav-hidden')).toBe('1')
    expect(container.querySelector('#nav-root')).not.toBeInTheDocument()
  })

  test('keeps visible nav above the cluster touch layer', () => {
    mockPathname = '/cluster'
    const navRef = createRef<HTMLDivElement>()
    const mainRef = createRef<HTMLDivElement>()
    const { container } = render(
      <AppLayout navRef={navRef} mainRef={mainRef} receivingVideo={false}>
        <div>Content</div>
      </AppLayout>
    )

    expect(container.querySelector<HTMLElement>('#nav-root')?.style.zIndex).toBe('1200')
  })

  test('centers host UI pages in a round-safe shell with nav included', () => {
    mockPathname = '/media'
    const navRef = createRef<HTMLDivElement>()
    const mainRef = createRef<HTMLDivElement>()
    const { container } = render(
      <AppLayout navRef={navRef} mainRef={mainRef} receivingVideo={false}>
        <div>Content</div>
      </AppLayout>
    )

    const root = container.querySelector<HTMLElement>('#main')
    const shell = container.querySelector<HTMLElement>('#round-host-shell')
    expect(root?.style.display).toBe('grid')
    expect(root?.style.gridTemplateColumns).toBe('1fr')
    expect(root?.style.gridTemplateRows).toBe('1fr')
    expect(shell).toBeInTheDocument()
    expect(shell).toHaveStyle({
      width: 'min(591px, calc(100vw - 16px))',
      height: 'min(536px, calc(100dvh - 16px))',
      display: 'flex',
      overflow: 'hidden'
    })
    expect(shell?.contains(container.querySelector('#nav-root'))).toBe(true)
    expect(shell?.contains(container.querySelector('#content-root'))).toBe(true)
  })

  test('removes nav on settings and gives settings the full safe square', () => {
    mockPathname = '/settings'
    const navRef = createRef<HTMLDivElement>()
    const mainRef = createRef<HTMLDivElement>()
    const { container } = render(
      <AppLayout navRef={navRef} mainRef={mainRef} receivingVideo={false}>
        <div>Content</div>
      </AppLayout>
    )

    expect(container.querySelector('#nav-root')).not.toBeInTheDocument()
    expect(container.querySelector('#content-root')?.getAttribute('data-nav-hidden')).toBe('1')
    expect(container.querySelector('#round-host-shell')).toHaveStyle({
      width: 'min(565px, calc(100vw - 16px))',
      height: 'min(565px, calc(100dvh - 16px))'
    })
  })

  test('does not wrap projection in the round host shell', () => {
    mockPathname = '/'
    const navRef = createRef<HTMLDivElement>()
    const mainRef = createRef<HTMLDivElement>()
    const { container } = render(
      <AppLayout navRef={navRef} mainRef={mainRef} receivingVideo={false}>
        <div>Content</div>
      </AppLayout>
    )

    expect(container.querySelector('#round-host-shell')).not.toBeInTheDocument()
    expect(container.querySelector<HTMLElement>('#main')?.style.display).toBe('flex')
  })

  test('auto-hides nav after inactivity on maps', () => {
    mockPathname = '/cluster'
    const navRef = createRef<HTMLDivElement>()
    const mainRef = createRef<HTMLDivElement>()
    const { container } = render(
      <AppLayout navRef={navRef} mainRef={mainRef} receivingVideo={false}>
        <div>Content</div>
      </AppLayout>
    )

    expect(container.querySelector('#content-root')?.getAttribute('data-nav-hidden')).toBe('0')
    act(() => {
      jest.advanceTimersByTime(3000)
    })
    expect(container.querySelector('#content-root')?.getAttribute('data-nav-hidden')).toBe('1')
  })

  test('forwards pointer activity to app notifier', () => {
    const navRef = createRef<HTMLDivElement>()
    const mainRef = createRef<HTMLDivElement>()
    const { container } = render(
      <AppLayout navRef={navRef} mainRef={mainRef} receivingVideo={false}>
        <div>Content</div>
      </AppLayout>
    )
    fireEvent.pointerDown(container.querySelector('#main') as HTMLElement)
    expect((window as any).app.notifyUserActivity).toHaveBeenCalled()
  })

  test('shows nav again and re-arms hide timer on mousemove in maps mode', () => {
    mockPathname = '/cluster'
    const navRef = createRef<HTMLDivElement>()
    const mainRef = createRef<HTMLDivElement>()

    const { container } = render(
      <AppLayout navRef={navRef} mainRef={mainRef} receivingVideo={false}>
        <div>Content</div>
      </AppLayout>
    )

    act(() => {
      jest.advanceTimersByTime(3000)
    })
    expect(container.querySelector('#content-root')?.getAttribute('data-nav-hidden')).toBe('1')

    fireEvent.mouseMove(document)

    expect(container.querySelector('#content-root')?.getAttribute('data-nav-hidden')).toBe('0')

    act(() => {
      jest.advanceTimersByTime(3000)
    })
    expect(container.querySelector('#content-root')?.getAttribute('data-nav-hidden')).toBe('1')
  })

  test('shows nav again when focus moves into nav area on cluster page', () => {
    mockPathname = '/cluster'
    const navRef = createRef<HTMLDivElement>()
    const mainRef = createRef<HTMLDivElement>()

    const { container, getByTestId } = render(
      <AppLayout navRef={navRef} mainRef={mainRef} receivingVideo={false}>
        <div>Content</div>
      </AppLayout>
    )

    act(() => {
      jest.advanceTimersByTime(3000)
    })
    expect(container.querySelector('#content-root')?.getAttribute('data-nav-hidden')).toBe('1')

    const navChild = getByTestId('nav')
    ;(navChild as HTMLElement).setAttribute('tabindex', '-1')
    act(() => {
      ;(navChild as HTMLElement).focus()
      fireEvent.focusIn(navChild)
    })

    expect(container.querySelector('#content-root')?.getAttribute('data-nav-hidden')).toBe('0')
    expect(container.querySelector('#nav-root')).toBeInTheDocument()
  })

  test('clears auto-hide timer and keeps nav visible when leaving auto-hide pages', () => {
    mockPathname = '/cluster'
    const navRef = createRef<HTMLDivElement>()
    const mainRef = createRef<HTMLDivElement>()

    const { container, rerender } = render(
      <AppLayout navRef={navRef} mainRef={mainRef} receivingVideo={false}>
        <div>Content</div>
      </AppLayout>
    )

    expect(container.querySelector('#content-root')?.getAttribute('data-nav-hidden')).toBe('0')

    mockPathname = '/settings'
    rerender(
      <AppLayout navRef={navRef} mainRef={mainRef} receivingVideo={false}>
        <div>Content</div>
      </AppLayout>
    )

    act(() => {
      jest.advanceTimersByTime(3000)
    })

    expect(container.querySelector('#content-root')?.getAttribute('data-nav-hidden')).toBe('1')
    expect(container.querySelector('#nav-root')).not.toBeInTheDocument()
  })

  test('removes wake listeners on unmount for auto-hide pages', () => {
    mockPathname = '/cluster'
    const navRef = createRef<HTMLDivElement>()
    const mainRef = createRef<HTMLDivElement>()

    const windowRemoveSpy = jest.spyOn(window, 'removeEventListener')
    const documentRemoveSpy = jest.spyOn(document, 'removeEventListener')

    const { unmount } = render(
      <AppLayout navRef={navRef} mainRef={mainRef} receivingVideo={false}>
        <div>Content</div>
      </AppLayout>
    )

    unmount()

    expect(windowRemoveSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    expect(documentRemoveSpy).toHaveBeenCalledWith('mousemove', expect.any(Function))
    expect(documentRemoveSpy).toHaveBeenCalledWith('wheel', expect.any(Function))
    expect(documentRemoveSpy).toHaveBeenCalledWith('focusin', expect.any(Function))
  })
})
