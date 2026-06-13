import { PhoneType } from '@shared/types/Config'
import { AudioCommand, CommandMapping } from '@shared/types/ProjectionEnums'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Projection } from '../Projection'

const navigateMock = jest.fn()
let mockPathname = '/'

jest.mock('@worker/createProjectionWorker', () => ({
  createProjectionWorker: jest.fn()
}))

type AnyFn = (...args: any[]) => any

const statusState: Record<string, any> = {
  isStreaming: true,
  isDongleConnected: true,
  isAaActive: false,
  setStreaming: jest.fn(),
  setDongleConnected: jest.fn(),
  setAaActive: jest.fn()
}

const liviState: Record<string, any> = {
  negotiatedWidth: 0,
  negotiatedHeight: 0,
  dongleFwVersion: '',
  boxInfo: null,
  resetInfo: jest.fn(),
  setDeviceInfo: jest.fn(),
  setAudioInfo: jest.fn(),
  setPcmData: jest.fn(),
  setBluetoothPairedList: jest.fn()
}

jest.mock('react-router', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({ pathname: mockPathname })
}))

jest.mock('../../../../store/store', () => {
  const useStatusStore: any = (selector: AnyFn) => selector(statusState)
  useStatusStore.setState = (patch: Record<string, any>) => Object.assign(statusState, patch)

  const useLiviStore: any = (selector: AnyFn) => selector(liviState)
  useLiviStore.setState = (patch: Record<string, any> | AnyFn) => {
    if (typeof patch === 'function') {
      Object.assign(liviState, patch(liviState))
    } else {
      Object.assign(liviState, patch)
    }
  }

  return { useStatusStore, useLiviStore }
})

jest.mock('../hooks/useProjectionTouch', () => ({
  useProjectionMultiTouch: () => ({})
}))

class MockWorker {
  static instances: MockWorker[] = []
  public postMessage = jest.fn()
  public terminate = jest.fn()
  public onerror: AnyFn | null = null
  private listeners: Array<(ev: MessageEvent<any>) => void> = []

  constructor(public url: string) {
    MockWorker.instances.push(this)
  }

  addEventListener(type: string, cb: (ev: MessageEvent<any>) => void) {
    if (type === 'message') this.listeners.push(cb)
  }

  removeEventListener(type: string, cb: (ev: MessageEvent<any>) => void) {
    if (type === 'message') this.listeners = this.listeners.filter((x) => x !== cb)
  }

  emit(data: unknown) {
    this.listeners.forEach((cb) => cb({ data } as MessageEvent))
  }

  triggerError(ev: unknown) {
    this.onerror?.(ev)
  }
}

class MockMessageChannel {
  static instances: MockMessageChannel[] = []
  port1 = { postMessage: jest.fn() }
  port2 = {}
  constructor() {
    MockMessageChannel.instances.push(this)
  }
}

const transportState = (overrides: Record<string, unknown> = {}) => ({
  active: 'dongle',
  targetTransport: 'dongle',
  targetMode: 'wired',
  switchPending: false,
  dongleDetected: true,
  wiredPhoneDetected: false,
  wirelessPhoneDetected: false,
  wiredPhoneActive: false,
  wirelessPhoneActive: false,
  preference: 'dongle',
  ...overrides
})

describe('Projection page', () => {
  let onEventCb: AnyFn | undefined
  let usbCb: AnyFn | undefined
  let telemetryCb: ((payload: unknown) => void) | undefined

  beforeEach(() => {
    MockWorker.instances = []
    MockMessageChannel.instances = []
    navigateMock.mockReset()
    mockPathname = '/'
    telemetryCb = undefined

    statusState.isStreaming = true
    statusState.isDongleConnected = true
    statusState.setStreaming.mockClear()
    statusState.setDongleConnected.mockClear()

    liviState.negotiatedWidth = 0
    liviState.negotiatedHeight = 0
    liviState.dongleFwVersion = ''
    liviState.boxInfo = null
    liviState.resetInfo.mockClear()
    liviState.setDeviceInfo.mockClear()
    liviState.setAudioInfo.mockClear()
    liviState.setPcmData.mockClear()
    liviState.setBluetoothPairedList.mockClear()

    liviState.resetInfo.mockClear()
    liviState.setDeviceInfo.mockClear()
    liviState.setAudioInfo.mockClear()
    liviState.setPcmData.mockClear()
    liviState.setBluetoothPairedList.mockClear()
    statusState.setStreaming.mockClear()
    statusState.setDongleConnected.mockClear()

    const { createProjectionWorker } = jest.requireMock('@worker/createProjectionWorker')

    createProjectionWorker.mockImplementation(() => new MockWorker('projection'))
    ;(global as any).Worker = MockWorker
    ;(global as any).MessageChannel = MockMessageChannel
    ;(global as any).ResizeObserver = jest.fn(() => ({
      observe: jest.fn(),
      disconnect: jest.fn()
    }))

    Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', {
      configurable: true,
      value: jest.fn(() => ({}))
    })
    ;(window as any).projection = {
      quit: jest.fn().mockResolvedValue(undefined),
      ipc: {
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
        sendFrame: jest.fn().mockResolvedValue(undefined),
        setVisible: jest.fn().mockResolvedValue(undefined),
        getTransportState: jest.fn().mockResolvedValue(transportState()),
        onAudioChunk: jest.fn(),
        offAudioChunk: jest.fn(),
        onEvent: jest.fn((cb: AnyFn) => (onEventCb = cb)),
        offEvent: jest.fn(),
        sendCommand: jest.fn(),
        getTelemetrySnapshot: jest.fn().mockResolvedValue({}),
        onTelemetry: jest.fn((cb: (payload: unknown) => void) => {
          telemetryCb = cb
        }),
        offTelemetry: jest.fn()
      },
      usb: {
        getDeviceInfo: jest.fn().mockResolvedValue({ device: true }),
        getLastEvent: jest.fn().mockResolvedValue(null),
        listenForEvents: jest.fn((cb: AnyFn) => (usbCb = cb)),
        unlistenForEvents: jest.fn()
      }
    }
    ;(window as any).app = {
      systemStats: jest.fn().mockResolvedValue({
        cpu: 12,
        cores: [10, 14],
        memUsedMb: 512,
        memTotalMb: 2048,
        memPct: 25,
        swapUsedMb: 0,
        tempC: 43.2,
        load: [0.1, 0.2, 0.3],
        uptime: 3600
      })
    }
  })

  test('usb plugged sets dongle-connected state (main owns session start)', async () => {
    render(<Projection {...baseProps()} />)

    await act(async () => {
      await usbCb?.(null, { type: 'plugged' })
    })

    expect((window as any).projection.ipc.start).not.toHaveBeenCalled()
    expect(statusState.setDongleConnected).toHaveBeenCalledWith(true)
  })

  test('renders cylinder head telemetry on the projection screen', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000)

    render(<Projection {...baseProps()} />)

    act(() => {
      telemetryCb?.({ chtLeftC: 151.2, chtRightC: 162.7 })
    })

    expect(screen.getByLabelText('L cylinder head temperature')).toHaveTextContent('151')
    expect(screen.getByLabelText('L cylinder head temperature')).toHaveTextContent('\u00b0C')
    expect(screen.getByLabelText('R cylinder head temperature')).toHaveTextContent('163')
    expect(screen.getByLabelText('R cylinder head temperature')).toHaveTextContent('\u00b0C')

    nowSpy.mockReturnValue(2000)
    act(() => {
      telemetryCb?.({ chtLeftC: 220.2, chtRightC: 162.7 })
    })

    expect(screen.getByLabelText('L cylinder head temperature')).toHaveTextContent('151')

    nowSpy.mockReturnValue(5200)
    act(() => {
      telemetryCb?.({ chtLeftC: 220.2, chtRightC: 162.7 })
    })

    expect(screen.getByLabelText('L cylinder head temperature')).toHaveTextContent('220')

    nowSpy.mockRestore()
  })

  test('renders GPS speed on the projection screen', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000)

    render(<Projection {...baseProps()} />)

    act(() => {
      telemetryCb?.({ gpsFix: true, speedKph: 88.5 })
    })

    expect(screen.getByLabelText('GPS speed')).toHaveTextContent('0')

    nowSpy.mockReturnValue(3000)
    act(() => {
      telemetryCb?.({ gpsFix: true, speedKph: 88.5 })
    })

    expect(screen.getByLabelText('GPS speed')).toHaveTextContent('55')
    expect(screen.getByLabelText('GPS speed')).toHaveTextContent('mph')

    act(() => {
      telemetryCb?.({ gpsFix: false })
    })

    expect(screen.getByLabelText('GPS speed')).toHaveTextContent('--')
    expect(screen.getByText('ACQUIRING')).toBeInTheDocument()
    expect(screen.getByTestId('projection-gps-status-dot')).toHaveClass('moto-gps-acquiring-dot')

    nowSpy.mockRestore()
  })

  test('opens graph in a rounded center pane and closes on short close press', async () => {
    render(<Projection {...baseProps()} />)

    act(() => {
      telemetryCb?.({ gpsFix: true, speedKph: 88.5 })
    })

    fireEvent.click(screen.getByLabelText('GPS speed'))

    const graph = screen.getByTestId('projection-metric-graph')
    expect(graph).toHaveStyle({
      top: '14.625%',
      left: '14.625%',
      width: '70.625%',
      height: '70.625%',
      borderRadius: '34px',
      overflow: 'hidden'
    })

    const close = screen.getByLabelText('Close graph')
    expect(close).toHaveTextContent('\u2715')

    fireEvent.pointerDown(close)
    fireEvent.pointerUp(close)

    expect(screen.queryByTestId('projection-metric-graph')).not.toBeInTheDocument()
  })

  test('keeps round dashboard controls active while waiting for phone video', () => {
    statusState.isStreaming = false

    render(<Projection {...baseProps({ receivingVideo: false })} />)

    expect(document.getElementById('projection-root')).toHaveStyle({ pointerEvents: 'auto' })
    expect(screen.getByTestId('projection-waiting-pane')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('GPS speed'))

    expect(screen.getByTestId('projection-metric-graph')).toBeInTheDocument()
  })

  test('clears an open metric graph when leaving the dashboard route', async () => {
    const { rerender } = render(<Projection {...baseProps()} />)

    act(() => {
      telemetryCb?.({ gpsFix: true, speedKph: 88.5 })
    })

    fireEvent.click(screen.getByLabelText('GPS speed'))
    expect(screen.getByTestId('projection-metric-graph')).toBeInTheDocument()

    mockPathname = '/settings'
    rerender(<Projection {...baseProps()} />)

    await waitFor(() => {
      expect(screen.queryByTestId('projection-metric-graph')).not.toBeInTheDocument()
    })
  })

  test('keeps graph history alive while the settings route is open', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000)
    const { rerender } = render(<Projection {...baseProps()} />)

    act(() => {
      telemetryCb?.({ gpsFix: true, speedKph: 88.5 })
    })

    mockPathname = '/settings'
    rerender(<Projection {...baseProps()} />)

    nowSpy.mockReturnValue(3000)
    act(() => {
      telemetryCb?.({ gpsFix: true, speedKph: 88.5 })
    })

    mockPathname = '/'
    rerender(<Projection {...baseProps()} />)

    fireEvent.click(screen.getByLabelText('GPS speed'))

    expect(screen.getByTestId('projection-metric-graph')).toHaveTextContent('55')
    expect(screen.getByTestId('projection-metric-graph')).toHaveTextContent('MAX 55')

    nowSpy.mockRestore()
  })

  test('clears all graph history from the moto settings clear event', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000)

    render(<Projection {...baseProps()} />)

    act(() => {
      telemetryCb?.({ gpsFix: true, speedKph: 88.5 })
    })

    nowSpy.mockReturnValue(3000)
    act(() => {
      telemetryCb?.({ gpsFix: true, speedKph: 88.5 })
    })

    fireEvent.click(screen.getByLabelText('GPS speed'))
    expect(screen.getByTestId('projection-metric-graph')).toHaveTextContent('55')
    expect(screen.getByTestId('projection-metric-graph')).toHaveTextContent('MAX 55')

    act(() => {
      window.dispatchEvent(new CustomEvent('moto:clear-graph-history'))
    })

    expect(screen.getByTestId('projection-metric-graph')).toHaveTextContent('NO DATA IN WINDOW')

    nowSpy.mockRestore()
  })

  test('renders GPS graph status details like the round dashboard', async () => {
    render(<Projection {...baseProps()} />)

    act(() => {
      telemetryCb?.({
        gpsFix: false,
        speedKph: 0,
        gpsSatellites: 3,
        gpsSky: {
          fixType: 0,
          satsUsed: 3,
          satsInView: 5,
          hdop: 1.7,
          pdop: 2.1,
          lat: null,
          lon: null,
          ttff: null,
          acquiring: 23,
          sats: [
            { prn: 3, el: null, az: null, snr: 38, used: true },
            { prn: 11, el: null, az: null, snr: 27, used: true },
            { prn: 18, el: null, az: null, snr: 12, used: false }
          ]
        }
      })
    })

    fireEvent.click(screen.getByLabelText('GPS speed'))

    const graph = screen.getByTestId('projection-metric-graph')
    expect(graph).toHaveTextContent('ACQUIRING')
    expect(graph).toHaveTextContent('23s')
    expect(graph).toHaveTextContent('3 used \u00b7 5 in view')
    expect(graph).toHaveTextContent('SEARCHING\u2026')
    expect(graph).toHaveTextContent('SIGNAL (dB-Hz)')
  })

  test('renders cylinder-head graphs as full single charts like the reference dashboard', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000)

    render(<Projection {...baseProps()} />)

    act(() => {
      telemetryCb?.({ chtLeftC: 151.2, chtRightC: 162.7 })
    })
    nowSpy.mockReturnValue(3000)
    act(() => {
      telemetryCb?.({ chtLeftC: 151.2, chtRightC: 162.7 })
    })

    fireEvent.click(screen.getByLabelText('L cylinder head temperature'))

    const graph = screen.getByTestId('projection-metric-graph')
    expect(graph).toHaveTextContent('CHT LEFT')
    expect(graph).toHaveTextContent('\u25cf LIVE')
    expect(graph).toHaveTextContent('151')
    expect(graph).toHaveTextContent('MAX 151')
    expect(graph).toHaveTextContent('MIN 151')
    expect(graph).toHaveTextContent('2 pts \u00b7 drag \u2190 \u2192')
    expect(graph).not.toHaveTextContent('L HEAD')
    expect(graph).not.toHaveTextContent('R HEAD')
    expect(graph).not.toHaveTextContent('\u25c4 BOXER \u25ba')

    nowSpy.mockRestore()
  })

  test('renders ambient split graph live labels like the round dashboard', async () => {
    render(<Projection {...baseProps()} />)

    act(() => {
      telemetryCb?.({ ambientC: 22.2, piCpuC: 50.4 })
    })

    fireEvent.click(screen.getByText('72\u00b0'))

    const graph = screen.getByTestId('projection-metric-graph')
    expect(graph).toHaveTextContent('AMBIENT')
    expect(graph).toHaveTextContent('PI CPU')
    expect(graph).toHaveTextContent('\u25cf LIVE')
  })

  test('resets only the selected pane in the ambient split graph', async () => {
    render(<Projection {...baseProps()} />)

    act(() => {
      telemetryCb?.({ ambientC: 22.2, piCpuC: 50.4 })
    })

    fireEvent.click(screen.getByText('72\u00b0'))

    const graph = screen.getByTestId('projection-metric-graph')
    expect(graph).toHaveTextContent('AMBIENT')
    expect(graph).toHaveTextContent('PI CPU')
    expect(graph).toHaveTextContent('72')
    expect(graph).toHaveTextContent('50')

    const graphScope = within(graph)
    fireEvent.click(graphScope.getAllByText('RESET')[0])
    fireEvent.click(graphScope.getByText('CONFIRM'))

    expect(graph).toHaveTextContent('AMBIENT')
    expect(graph).toHaveTextContent('PI CPU')
    expect(graph).toHaveTextContent('NO DATA IN WINDOW')
    expect(graphScope.queryAllByText('72')).toHaveLength(0)
    expect(graph).toHaveTextContent('50')
  })

  test('long-pressing graph close opens quit confirmation', async () => {
    jest.useFakeTimers()

    render(<Projection {...baseProps()} />)

    act(() => {
      telemetryCb?.({ gpsFix: true, speedKph: 88.5 })
    })

    fireEvent.click(screen.getByLabelText('GPS speed'))
    const close = screen.getByLabelText('Close graph')

    fireEvent.pointerDown(close)
    act(() => {
      jest.advanceTimersByTime(800)
    })
    fireEvent.pointerUp(close)

    expect(screen.getByText('Quit motoCarPlay?')).toBeInTheDocument()

    fireEvent.click(screen.getByText('QUIT'))

    expect((window as any).projection.quit).toHaveBeenCalledTimes(1)

    jest.useRealTimers()
  })

  test('renders waiting pane at the round dashboard center square while video is absent', () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-06-12T17:07:00'))
    statusState.isStreaming = false

    try {
      render(
        <Projection
          {...baseProps({
            settings: {
              ...baseProps().settings,
              projectionWidth: 800,
              projectionHeight: 800,
              projectionViewAreaTop: 118,
              projectionViewAreaBottom: 118,
              projectionViewAreaLeft: 118,
              projectionViewAreaRight: 118
            }
          })}
        />
      )

      const pane = screen.getByTestId('projection-waiting-pane')

      expect(pane).toHaveStyle({
        left: '14.625%',
        top: '14.625%',
        width: '70.625%',
        height: '70.625%',
        backgroundColor: '#02050a'
      })
      expect(screen.getByTestId('projection-waiting-clock')).toHaveTextContent('5:07')
      expect(screen.getByTestId('projection-waiting-status-pills')).toHaveTextContent(
        'Adapter found'
      )
      expect(screen.getByTestId('projection-waiting-status-pills')).toHaveTextContent(
        'Searching for iPhone'
      )
    } finally {
      jest.useRealTimers()
    }
  })

  test('renders adapter-offline standby status when the adapter is absent', () => {
    statusState.isStreaming = false
    statusState.isDongleConnected = false

    render(<Projection {...baseProps({ receivingVideo: false })} />)

    expect(screen.getByTestId('projection-waiting-status-pills')).toHaveTextContent(
      'Adapter missing'
    )
    expect(screen.getByTestId('projection-waiting-status-pills')).toHaveTextContent(
      'iPhone search paused'
    )
  })

  test('renders waiting pane from custom projection view area outside the round default', () => {
    statusState.isStreaming = false

    render(
      <Projection
        {...baseProps({
          settings: {
            ...baseProps().settings,
            projectionWidth: 800,
            projectionHeight: 480,
            projectionViewAreaTop: 20,
            projectionViewAreaBottom: 40,
            projectionViewAreaLeft: 80,
            projectionViewAreaRight: 120
          }
        })}
      />
    )

    expect(screen.getByTestId('projection-waiting-pane')).toHaveStyle({
      left: '10%',
      top: '4.166666666666666%',
      width: '75%',
      height: '87.5%'
    })
  })

  test('renders low-cost fill and corner masks while waiting for video', () => {
    statusState.isStreaming = false

    render(
      <Projection
        {...baseProps({
          settings: {
            ...baseProps().settings,
            projectionWidth: 800,
            projectionHeight: 800,
            projectionViewAreaTop: 118,
            projectionViewAreaBottom: 118,
            projectionViewAreaLeft: 118,
            projectionViewAreaRight: 118,
            ambientFillEnabled: true,
            ambientFillColor: '#20364a',
            roundedCornerMaskEnabled: true
          }
        })}
      />
    )

    expect(screen.getByTestId('projection-waiting-pane')).toBeInTheDocument()
    expect(screen.getByTestId('view-area-mask-top')).toHaveStyle({
      backgroundColor: '#20364a'
    })
    expect(screen.getByTestId('view-area-corner-mask-top-left')).toHaveStyle({
      top: '14.75%',
      left: '14.75%'
    })
    expect(screen.getByTestId('view-area-corner-mask-top-left').style.background).toContain(
      '#20364a'
    )
  })

  test('lets the dynamic backdrop show outside the view area while keeping corner masks', () => {
    render(
      <Projection
        {...baseProps({
          receivingVideo: true,
          settings: {
            ...baseProps().settings,
            projectionWidth: 800,
            projectionHeight: 800,
            projectionViewAreaTop: 118,
            projectionViewAreaBottom: 118,
            projectionViewAreaLeft: 118,
            projectionViewAreaRight: 118,
            backdropEnabled: true,
            roundedCornerMaskEnabled: true
          }
        })}
      />
    )

    expect(screen.queryByTestId('view-area-mask-top')).not.toBeInTheDocument()
    expect(screen.getByTestId('view-area-corner-mask-top-left')).toBeInTheDocument()
  })

  test('hides waiting pane when video frames are present', () => {
    render(<Projection {...baseProps()} receivingVideo />)

    expect(screen.queryByTestId('projection-waiting-pane')).not.toBeInTheDocument()
  })

  test('keeps standby pane visible while native streaming is live before video frames arrive', () => {
    render(<Projection {...baseProps({ receivingVideo: false })} />)

    expect(screen.getByTestId('projection-waiting-pane')).toBeInTheDocument()
    expect(screen.getByTestId('projection-waiting-status-pills')).toHaveTextContent('Adapter found')
    expect(screen.getByTestId('projection-waiting-status-pills')).toHaveTextContent('iPhone linked')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  test('keeps waiting pane hidden after dongle plugged event when video is present', () => {
    render(<Projection {...baseProps()} receivingVideo />)

    act(() => {
      onEventCb?.(null, { type: 'plugged' })
    })

    expect(screen.queryByTestId('projection-waiting-pane')).not.toBeInTheDocument()
  })

  test('keeps waiting pane hidden when dongle info only has a remembered phone mac', () => {
    const { rerender } = render(<Projection {...baseProps()} receivingVideo />)

    liviState.boxInfo = { btMacAddr: 'AA:BB:CC:DD:EE:FF' }
    rerender(<Projection {...baseProps()} receivingVideo />)

    expect(screen.queryByTestId('projection-waiting-pane')).not.toBeInTheDocument()
  })

  test('keeps waiting pane hidden when dongle video is active but no phone is linked', () => {
    render(<Projection {...baseProps()} receivingVideo />)

    act(() => {
      onEventCb?.(null, { type: 'projectionActive' })
    })

    expect(screen.queryByTestId('projection-waiting-pane')).not.toBeInTheDocument()
  })

  test('keeps standby pane visible after projection activity before video frames arrive', () => {
    statusState.isStreaming = false

    render(<Projection {...baseProps({ receivingVideo: false })} />)

    expect(screen.getByTestId('projection-waiting-pane')).toBeInTheDocument()

    act(() => {
      onEventCb?.(null, { type: 'projectionActive' })
    })

    expect(screen.getByTestId('projection-waiting-pane')).toBeInTheDocument()
    expect(screen.getByTestId('projection-waiting-status-pills')).toHaveTextContent('Adapter found')
    expect(screen.getByTestId('projection-waiting-status-pills')).toHaveTextContent(
      'Searching for iPhone'
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  test('keeps waiting pane hidden for unsupported dongle startup phone type once video is present', () => {
    render(<Projection {...baseProps()} receivingVideo />)

    act(() => {
      onEventCb?.(null, { type: 'plugged', phoneType: 0 })
      onEventCb?.(null, { type: 'projectionActive' })
    })

    expect(screen.queryByTestId('projection-waiting-pane')).not.toBeInTheDocument()
  })

  test('hides waiting pane when CarPlay phone and projection activity are confirmed', () => {
    ;(window as any).projection.ipc.getTransportState.mockReturnValue(new Promise(() => {}))

    render(<Projection {...baseProps()} receivingVideo />)

    act(() => {
      onEventCb?.(null, {
        type: 'transportState',
        payload: transportState({
          active: 'cp',
          wirelessPhoneDetected: true,
          wirelessPhoneActive: true
        })
      })
      onEventCb?.(null, { type: 'plugged', phoneType: PhoneType.CarPlay })
      onEventCb?.(null, { type: 'projectionActive' })
    })

    expect(screen.queryByTestId('projection-waiting-pane')).not.toBeInTheDocument()
  })

  test('projectionActive refresh does not restore waiting pane while video is present', async () => {
    render(<Projection {...baseProps()} receivingVideo />)

    act(() => {
      onEventCb?.(null, { type: 'plugged', phoneType: PhoneType.CarPlay })
      onEventCb?.(null, { type: 'projectionActive' })
    })

    await waitFor(() => {
      expect(screen.queryByTestId('projection-waiting-pane')).not.toBeInTheDocument()
    })
  })

  test('projectionInactive clears stale video state so waiting pane can replace a quiet stream', () => {
    const setReceivingVideo = jest.fn()
    const setNavVideoOverlayActive = jest.fn()

    render(
      <Projection
        {...baseProps({
          receivingVideo: true,
          setReceivingVideo,
          navVideoOverlayActive: true,
          setNavVideoOverlayActive
        })}
      />
    )

    act(() => {
      onEventCb?.(null, { type: 'projectionInactive', reason: 'main-video-timeout' })
    })

    expect(statusState.setStreaming).toHaveBeenCalledWith(false)
    expect(setReceivingVideo).toHaveBeenCalledWith(false)
    expect(setNavVideoOverlayActive).toHaveBeenCalledWith(false)
  })

  test('streaming event restores video visibility even when resolution is unchanged', () => {
    const setReceivingVideo = jest.fn()

    render(<Projection {...baseProps({ setReceivingVideo })} />)

    act(() => {
      onEventCb?.(null, { type: 'streaming', active: true, reason: 'main-video-frame' })
    })

    expect(statusState.setStreaming).toHaveBeenCalledWith(true)
    expect(setReceivingVideo).toHaveBeenCalledWith(true)
  })

  test('usb unplugged stops projection and clears streaming state', async () => {
    const setReceivingVideo = jest.fn()

    render(<Projection {...baseProps({ setReceivingVideo })} receivingVideo />)

    await act(async () => {
      await usbCb?.(null, { type: 'unplugged' })
    })

    expect((window as any).projection.ipc.stop).toHaveBeenCalled()
    expect(setReceivingVideo).toHaveBeenCalledWith(false)
    expect(statusState.setStreaming).toHaveBeenCalledWith(false)
    expect(statusState.setDongleConnected).toHaveBeenCalledWith(false)
    expect(liviState.resetInfo).toHaveBeenCalled()
  })

  test('forces video hidden when streaming becomes false', () => {
    const setReceivingVideo = jest.fn()

    const { rerender } = render(<Projection {...baseProps({ setReceivingVideo })} receivingVideo />)

    statusState.isStreaming = false

    rerender(<Projection {...baseProps({ setReceivingVideo })} receivingVideo />)

    expect(setReceivingVideo).toHaveBeenCalledWith(false)
  })

  test('handles worker failure and schedules retry timer', () => {
    jest.useFakeTimers()

    const setTimeoutSpy = jest.spyOn(window, 'setTimeout')

    render(<Projection {...baseProps()} />)

    const projectionWorker = MockWorker.instances[0]

    act(() => {
      projectionWorker.emit({ type: 'failure' })
    })

    expect(setTimeoutSpy).toHaveBeenCalled()

    const timeoutCall = setTimeoutSpy.mock.calls.find((call) => call[1] === 3000)
    expect(timeoutCall).toBeTruthy()
    expect(typeof timeoutCall?.[0]).toBe('function')

    setTimeoutSpy.mockRestore()
    jest.useRealTimers()
  })

  test('handles bluetoothPairedList event from payload string', () => {
    render(<Projection {...baseProps()} />)

    act(() => {
      onEventCb?.(null, {
        type: 'bluetoothPairedList',
        payload: 'device-a\ndevice-b'
      })
    })

    expect(liviState.setBluetoothPairedList).toHaveBeenCalledWith('device-a\ndevice-b')
  })

  test('handles dongleInfo event and merges box info', () => {
    liviState.boxInfo = { existing: 'keep', MDLinkType: 'CarPlay' }
    liviState.dongleFwVersion = 'old-fw'

    render(<Projection {...baseProps()} />)

    act(() => {
      onEventCb?.(null, {
        type: 'dongleInfo',
        payload: {
          dongleFwVersion: 'new-fw',
          boxInfo: { foo: 'bar', MDLinkType: 'AndroidAuto' }
        }
      })
    })

    expect(liviState.dongleFwVersion).toBe('new-fw')
    expect(liviState.boxInfo).toEqual({
      existing: 'keep',
      MDLinkType: 'AndroidAuto',
      foo: 'bar'
    })
  })

  test('handles audioInfo event', () => {
    render(<Projection {...baseProps()} />)

    act(() => {
      onEventCb?.(null, {
        type: 'audioInfo',
        payload: {
          codec: 'aac',
          sampleRate: 48000,
          channels: 2,
          bitDepth: 16
        }
      })
    })

    expect(liviState.setAudioInfo).toHaveBeenCalledWith({
      codec: 'aac',
      sampleRate: 48000,
      channels: 2,
      bitDepth: 16
    })
  })

  test('requestHostUI navigates to settings host UI', async () => {
    render(<Projection {...baseProps()} />)

    act(() => {
      onEventCb?.(null, {
        type: 'command',
        message: { value: CommandMapping.requestHostUI }
      })
    })

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/settings', { replace: true })
    })
  })

  test('handles bluetoothPairedList event', () => {
    render(<Projection {...baseProps()} />)

    act(() => {
      onEventCb?.(null, {
        type: 'bluetoothPairedList',
        payload: 'device-a\ndevice-b'
      })
    })

    expect(liviState.setBluetoothPairedList).toHaveBeenCalledWith('device-a\ndevice-b')
  })

  test('handles dongleInfo event', () => {
    render(<Projection {...baseProps()} />)

    act(() => {
      onEventCb?.(null, {
        type: 'dongleInfo',
        payload: {
          dongleFwVersion: '2025.02.01',
          boxInfo: { MDLinkType: 'AndroidAuto', foo: 'bar' }
        }
      })
    })

    expect(liviState.dongleFwVersion).toBe('2025.02.01')
    expect(liviState.boxInfo).toEqual({ MDLinkType: 'AndroidAuto', foo: 'bar' })
  })

  test('handles audioInfo event', () => {
    render(<Projection {...baseProps()} />)

    act(() => {
      onEventCb?.(null, {
        type: 'audioInfo',
        payload: {
          codec: 'aac',
          sampleRate: 48000,
          channels: 2,
          bitDepth: 16
        }
      })
    })

    expect(liviState.setAudioInfo).toHaveBeenCalledWith({
      codec: 'aac',
      sampleRate: 48000,
      channels: 2,
      bitDepth: 16
    })
  })

  test('requestVideoFocus navigates to projection', async () => {
    mockPathname = '/media'

    render(
      <Projection
        {...baseProps()}
        settings={
          {
            width: 800,
            height: 480,
            fps: 60,
            cluster: { main: false, dash: false, aux: false },
            autoSwitchOnStream: true
          } as any
        }
      />
    )

    act(() => {
      onEventCb?.(null, {
        type: 'command',
        message: { value: CommandMapping.requestVideoFocus }
      })
    })

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/', { replace: true })
    })
  })

  test('requestVideoFocus waits for resolution when stream is not active', async () => {
    mockPathname = '/media'
    statusState.isStreaming = false

    const setReceivingVideo = jest.fn()

    render(
      <Projection
        {...baseProps({ setReceivingVideo })}
        settings={
          {
            width: 800,
            height: 480,
            fps: 60,
            cluster: { main: false, dash: false, aux: false },
            autoSwitchOnStream: true
          } as any
        }
      />
    )

    act(() => {
      onEventCb?.(null, {
        type: 'command',
        message: { value: CommandMapping.requestVideoFocus }
      })
    })

    expect(navigateMock).not.toHaveBeenCalled()

    act(() => {
      onEventCb?.(null, {
        type: 'resolution',
        payload: { width: 1280, height: 720 }
      })
    })

    expect(setReceivingVideo).toHaveBeenCalledWith(true)

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/', { replace: true })
    })
  })

  test('releaseVideoFocus navigates back after auto switch', async () => {
    mockPathname = '/media'

    const { rerender } = render(
      <Projection
        {...baseProps()}
        settings={
          {
            width: 800,
            height: 480,
            fps: 60,
            cluster: { main: false, dash: false, aux: false },
            autoSwitchOnStream: true
          } as any
        }
      />
    )

    act(() => {
      onEventCb?.(null, {
        type: 'command',
        message: { value: CommandMapping.requestVideoFocus }
      })
    })

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/', { replace: true })
    })

    navigateMock.mockClear()
    mockPathname = '/'

    rerender(
      <Projection
        {...baseProps()}
        settings={
          {
            width: 800,
            height: 480,
            fps: 60,
            cluster: { main: false, dash: false, aux: false },
            autoSwitchOnStream: true
          } as any
        }
      />
    )

    act(() => {
      onEventCb?.(null, {
        type: 'command',
        message: { value: CommandMapping.releaseVideoFocus }
      })
    })

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/media', { replace: true })
    })
  })

  test('releaseVideoFocus does nothing when auto switch on stream is disabled', () => {
    mockPathname = '/'

    render(
      <Projection
        {...baseProps()}
        settings={
          {
            width: 800,
            height: 480,
            fps: 60,
            cluster: { main: false, dash: false, aux: false },
            autoSwitchOnStream: false
          } as any
        }
      />
    )

    act(() => {
      onEventCb?.(null, {
        type: 'command',
        message: { value: CommandMapping.releaseVideoFocus }
      })
    })

    expect(navigateMock).not.toHaveBeenCalled()
  })

  test('requestClusterFocus shows overlay when maps disabled', () => {
    mockPathname = '/media'

    const setNavVideoOverlayActive = jest.fn()

    render(
      <Projection
        {...baseProps({ setNavVideoOverlayActive })}
        settings={
          {
            width: 800,
            height: 480,
            fps: 60,
            cluster: { main: false, dash: false, aux: false },
            autoSwitchOnGuidance: true
          } as any
        }
      />
    )

    act(() => {
      onEventCb?.(null, {
        type: 'command',
        message: { value: CommandMapping.requestClusterFocus }
      })
    })

    expect(setNavVideoOverlayActive).toHaveBeenCalledWith(true)
  })

  test('releaseClusterFocus navigates back from maps when maps are enabled', async () => {
    mockPathname = '/media'

    const { rerender } = render(
      <Projection
        {...baseProps()}
        settings={
          {
            width: 800,
            height: 480,
            fps: 60,
            dashboards: { dash3: { main: true, dash: false, aux: false } },
            autoSwitchOnGuidance: true
          } as any
        }
      />
    )

    act(() => {
      onEventCb?.(null, {
        type: 'command',
        message: { value: CommandMapping.requestClusterFocus }
      })
    })

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/cluster', { replace: true })
    })

    navigateMock.mockClear()
    mockPathname = '/cluster'

    rerender(
      <Projection
        {...baseProps()}
        settings={
          {
            width: 800,
            height: 480,
            fps: 60,
            dashboards: { dash3: { main: true, dash: false, aux: false } },
            autoSwitchOnGuidance: true
          } as any
        }
      />
    )

    act(() => {
      onEventCb?.(null, {
        type: 'command',
        message: { value: CommandMapping.releaseClusterFocus }
      })
    })

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/media', { replace: true })
    })
  })

  test('releaseClusterFocus navigates back from maps when maps are enabled', async () => {
    mockPathname = '/media'

    const { rerender } = render(
      <Projection
        {...baseProps()}
        settings={
          {
            width: 800,
            height: 480,
            fps: 60,
            dashboards: { dash3: { main: true, dash: false, aux: false } },
            autoSwitchOnGuidance: true
          } as any
        }
      />
    )

    act(() => {
      onEventCb?.(null, {
        type: 'command',
        message: { value: CommandMapping.requestClusterFocus }
      })
    })

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/cluster', { replace: true })
    })

    navigateMock.mockClear()
    mockPathname = '/cluster'

    rerender(
      <Projection
        {...baseProps()}
        settings={
          {
            width: 800,
            height: 480,
            fps: 60,
            dashboards: { dash3: { main: true, dash: false, aux: false } },
            autoSwitchOnGuidance: true
          } as any
        }
      />
    )

    act(() => {
      onEventCb?.(null, {
        type: 'command',
        message: { value: CommandMapping.releaseClusterFocus }
      })
    })

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/media', { replace: true })
    })
  })

  test('releaseVideoFocus navigates back after auto switch', async () => {
    mockPathname = '/media'

    const { rerender } = render(
      <Projection
        {...baseProps()}
        settings={
          {
            width: 800,
            height: 480,
            fps: 60,
            cluster: { main: false, dash: false, aux: false },
            autoSwitchOnStream: true
          } as any
        }
      />
    )

    act(() => {
      onEventCb?.(null, {
        type: 'command',
        message: { value: CommandMapping.requestVideoFocus }
      })
    })

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/', { replace: true })
    })

    navigateMock.mockClear()
    mockPathname = '/'

    rerender(
      <Projection
        {...baseProps()}
        settings={
          {
            width: 800,
            height: 480,
            fps: 60,
            cluster: { main: false, dash: false, aux: false },
            autoSwitchOnStream: true
          } as any
        }
      />
    )

    act(() => {
      onEventCb?.(null, {
        type: 'command',
        message: { value: CommandMapping.releaseVideoFocus }
      })
    })

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/media', { replace: true })
    })
  })

  test('handles phone call start (auto switch)', async () => {
    mockPathname = '/media'

    render(
      <Projection
        {...baseProps()}
        settings={{ width: 800, height: 480, fps: 60, autoSwitchOnPhoneCall: true } as any}
      />
    )

    act(() => {
      onEventCb?.(null, {
        type: 'audio',
        payload: { command: AudioCommand.AudioPhonecallStart }
      })
    })

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/', { replace: true })
    })
  })

  test('sends key command when commandCounter changes and stream is active', () => {
    statusState.isStreaming = true

    render(<Projection {...baseProps()} command={'home' as any} commandCounter={1} />)

    expect((window as any).projection.ipc.sendCommand).toHaveBeenCalledWith('home')
  })

  test('does not re-send last key command on isStreaming flicker', () => {
    statusState.isStreaming = true

    const { rerender } = render(
      <Projection {...baseProps()} command={'home' as any} commandCounter={1} />
    )
    expect((window as any).projection.ipc.sendCommand).toHaveBeenCalledTimes(1)
    expect((window as any).projection.ipc.sendCommand).toHaveBeenCalledWith('home')

    statusState.isStreaming = false
    rerender(<Projection {...baseProps()} command={'home' as any} commandCounter={1} />)
    statusState.isStreaming = true
    rerender(<Projection {...baseProps()} command={'home' as any} commandCounter={1} />)

    expect((window as any).projection.ipc.sendCommand).toHaveBeenCalledTimes(1)
  })

  // ── IPC plugged / unplugged / failure events ──────────────────────────────

  test('IPC plugged event marks dongle connected', () => {
    render(<Projection {...baseProps()} />)

    act(() => {
      onEventCb?.(null, { type: 'plugged' })
    })

    expect(statusState.setDongleConnected).toHaveBeenCalledWith(true)
  })

  test('IPC unplugged event clears all streaming state', () => {
    const setReceivingVideo = jest.fn()
    const setNavVideoOverlayActive = jest.fn()

    render(<Projection {...baseProps({ setReceivingVideo, setNavVideoOverlayActive })} />)

    act(() => {
      onEventCb?.(null, { type: 'unplugged' })
    })

    expect(statusState.setStreaming).toHaveBeenCalledWith(false)
    expect(statusState.setDongleConnected).toHaveBeenCalledWith(false)
    expect(setReceivingVideo).toHaveBeenCalledWith(false)
    expect(setNavVideoOverlayActive).toHaveBeenCalledWith(false)
  })

  test('IPC failure event clears all streaming state', () => {
    const setReceivingVideo = jest.fn()
    const setNavVideoOverlayActive = jest.fn()

    render(<Projection {...baseProps({ setReceivingVideo, setNavVideoOverlayActive })} />)

    act(() => {
      onEventCb?.(null, { type: 'failure' })
    })

    expect(statusState.setStreaming).toHaveBeenCalledWith(false)
    expect(statusState.setDongleConnected).toHaveBeenCalledWith(false)
    expect(setReceivingVideo).toHaveBeenCalledWith(false)
    expect(setNavVideoOverlayActive).toHaveBeenCalledWith(false)
  })

  // ── Audio command events ──────────────────────────────────────────────────

  test('AudioPhonecallStop releases call attention and returns to previous route', async () => {
    mockPathname = '/media'

    const { rerender } = render(
      <Projection
        {...baseProps()}
        settings={{ width: 800, height: 480, fps: 60, autoSwitchOnPhoneCall: true } as any}
      />
    )

    // arm: switch to projection on call start
    act(() => {
      onEventCb?.(null, {
        type: 'audio',
        payload: { command: AudioCommand.AudioPhonecallStart }
      })
    })

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/', { replace: true }))

    navigateMock.mockClear()
    mockPathname = '/'

    rerender(
      <Projection
        {...baseProps()}
        settings={{ width: 800, height: 480, fps: 60, autoSwitchOnPhoneCall: true } as any}
      />
    )

    act(() => {
      onEventCb?.(null, {
        type: 'audio',
        payload: { command: AudioCommand.AudioPhonecallStop }
      })
    })

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/media', { replace: true }))
  })

  test('AudioAttentionRinging triggers call attention switch when autoSwitchOnPhoneCall', async () => {
    mockPathname = '/media'

    render(
      <Projection
        {...baseProps()}
        settings={{ width: 800, height: 480, fps: 60, autoSwitchOnPhoneCall: true } as any}
      />
    )

    act(() => {
      onEventCb?.(null, {
        type: 'audio',
        payload: { command: AudioCommand.AudioAttentionRinging }
      })
    })

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/', { replace: true }))
  })

  test('AudioVoiceAssistantStart triggers voiceAssistant attention switch', async () => {
    mockPathname = '/media'

    render(<Projection {...baseProps()} />)

    act(() => {
      onEventCb?.(null, {
        type: 'audio',
        payload: { command: AudioCommand.AudioVoiceAssistantStart }
      })
    })

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/', { replace: true }))
  })

  test('AudioVoiceAssistantStop returns to previous route via debounce timer', async () => {
    jest.useFakeTimers()
    mockPathname = '/media'

    const { rerender } = render(<Projection {...baseProps()} />)

    act(() => {
      onEventCb?.(null, {
        type: 'audio',
        payload: { command: AudioCommand.AudioVoiceAssistantStart }
      })
    })
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/', { replace: true }))

    navigateMock.mockClear()
    mockPathname = '/'
    rerender(<Projection {...baseProps()} />)

    act(() => {
      onEventCb?.(null, {
        type: 'audio',
        payload: { command: AudioCommand.AudioVoiceAssistantStop }
      })
    })

    // timer not yet fired
    expect(navigateMock).not.toHaveBeenCalled()

    act(() => {
      jest.advanceTimersByTime(200)
    })

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/media', { replace: true }))

    jest.useRealTimers()
  })

  // ── applyAttention: already on projection path ────────────────────────────

  test('applyAttention does nothing when already on projection route', () => {
    mockPathname = '/'

    render(
      <Projection
        {...baseProps()}
        settings={{ width: 800, height: 480, fps: 60, autoSwitchOnPhoneCall: true } as any}
      />
    )

    act(() => {
      onEventCb?.(null, {
        type: 'audio',
        payload: { command: AudioCommand.AudioPhonecallStart }
      })
    })

    expect(navigateMock).not.toHaveBeenCalled()
  })

  // ── clearVoiceAssistantReleaseTimer when timer is already set ─────────────

  test('clearVoiceAssistantReleaseTimer cancels pending debounce on second active', async () => {
    jest.useFakeTimers()
    mockPathname = '/media'

    const { rerender } = render(<Projection {...baseProps()} />)

    // First voiceAssistant start → switch to projection
    act(() => {
      onEventCb?.(null, {
        type: 'audio',
        payload: { command: AudioCommand.AudioVoiceAssistantStart }
      })
    })
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/', { replace: true }))

    navigateMock.mockClear()
    mockPathname = '/'
    rerender(<Projection {...baseProps()} />)

    // VoiceAssistant stop → sets debounce timer
    act(() => {
      onEventCb?.(null, {
        type: 'audio',
        payload: { command: AudioCommand.AudioVoiceAssistantStop }
      })
    })

    // VoiceAssistant start again before timer fires → clearVoiceAssistantReleaseTimer runs with timer set
    mockPathname = '/'
    act(() => {
      onEventCb?.(null, {
        type: 'audio',
        payload: { command: AudioCommand.AudioVoiceAssistantStart }
      })
    })

    // Timer should have been cancelled, so no navigation after advance
    act(() => jest.advanceTimersByTime(200))
    expect(navigateMock).not.toHaveBeenCalledWith('/media', expect.anything())

    jest.useRealTimers()
  })

  // ── mergeBoxInfo: string variants ────────────────────────────────────────

  test('mergeBoxInfo merges when boxInfo payload arrives as JSON string', () => {
    liviState.boxInfo = { existing: 'keep' }

    render(<Projection {...baseProps()} />)

    act(() => {
      onEventCb?.(null, {
        type: 'dongleInfo',
        payload: {
          dongleFwVersion: 'fw1',
          boxInfo: '{"MDLinkType":"CarPlay"}'
        }
      })
    })

    expect(liviState.boxInfo).toMatchObject({ existing: 'keep', MDLinkType: 'CarPlay' })
  })

  test('mergeBoxInfo merges when existing boxInfo is a JSON string', () => {
    liviState.boxInfo = '{"old":"data"}'

    render(<Projection {...baseProps()} />)

    act(() => {
      onEventCb?.(null, {
        type: 'dongleInfo',
        payload: {
          dongleFwVersion: 'fw2',
          boxInfo: { MDLinkType: 'AndroidAuto' }
        }
      })
    })

    expect(liviState.boxInfo).toMatchObject({ old: 'data', MDLinkType: 'AndroidAuto' })
  })

  test('mergeBoxInfo returns prev when boxInfo payload is an empty string', () => {
    liviState.boxInfo = { preserved: true }

    render(<Projection {...baseProps()} />)

    act(() => {
      onEventCb?.(null, {
        type: 'dongleInfo',
        payload: { dongleFwVersion: 'fw3', boxInfo: '   ' }
      })
    })

    expect(liviState.boxInfo).toMatchObject({ preserved: true })
  })

  // ── handleAudio: PCM conversion ───────────────────────────────────────────

  test('handleAudio converts int16 chunk to float32 and schedules setPcmData', () => {
    jest.useFakeTimers()

    render(<Projection {...baseProps()} />)

    const ipc = (window as any).projection.ipc
    const audioChunkFn: AnyFn = ipc.onAudioChunk.mock.calls[0]?.[0]

    const int16 = new Int16Array([0, 16384, -16384, 32767])
    const buf = int16.buffer

    act(() => {
      audioChunkFn?.({ chunk: { buffer: buf } })
      jest.runAllTimers()
    })

    expect(liviState.setPcmData).toHaveBeenCalledTimes(1)
    const f32: Float32Array = liviState.setPcmData.mock.calls[0][0]
    expect(f32).toBeInstanceOf(Float32Array)
    expect(f32.length).toBe(4)
    expect(f32[0]).toBeCloseTo(0)
    expect(f32[1]).toBeCloseTo(0.5, 1)

    jest.useRealTimers()
  })

  test('handleAudio cleanup clears pending timers on unmount', () => {
    jest.useFakeTimers()

    const { unmount } = render(<Projection {...baseProps()} />)

    const ipc = (window as any).projection.ipc
    const audioChunkFn: AnyFn = ipc.onAudioChunk.mock.calls[0]?.[0]

    const int16 = new Int16Array([1000])
    act(() => {
      audioChunkFn?.({ chunk: { buffer: int16.buffer } })
    })

    // Unmount before timer fires → cleanup cancels it
    unmount()

    act(() => {
      jest.runAllTimers()
    })

    expect(liviState.setPcmData).not.toHaveBeenCalled()

    jest.useRealTimers()
  })

  // ── projection worker: requestBuffer & audio messages ────────────────────

  test('projection worker requestBuffer message calls clearRetryTimeout', () => {
    jest.useFakeTimers()

    const clearTimeoutSpy = jest.spyOn(window, 'clearTimeout')

    render(<Projection {...baseProps()} />)

    const projectionWorker = MockWorker.instances[0]

    // Create pending retry timer via 'failure'
    act(() => {
      projectionWorker.emit({ type: 'failure' })
    })

    // requestBuffer clears it
    act(() => {
      projectionWorker.emit({ type: 'requestBuffer' })
    })

    expect(clearTimeoutSpy).toHaveBeenCalled()

    clearTimeoutSpy.mockRestore()
    jest.useRealTimers()
  })

  test('projection worker audio message calls clearRetryTimeout', () => {
    render(<Projection {...baseProps()} />)

    const projectionWorker = MockWorker.instances[0]

    // Should not throw when no retry timer is set
    act(() => {
      projectionWorker.emit({ type: 'audio' })
    })
  })

  // ── clearRetryTimeout with active timer ───────────────────────────────────

  test('clearRetryTimeout clears an active retry timeout', () => {
    jest.useFakeTimers()

    render(<Projection {...baseProps()} />)

    const projectionWorker = MockWorker.instances[0]

    act(() => {
      projectionWorker.emit({ type: 'failure' })
    })

    // USB unplug triggers clearRetryTimeout
    act(() => {
      usbCb?.(null, { type: 'unplugged' })
    })

    // Timer was cleared; reload should not fire
    act(() => jest.advanceTimersByTime(5000))

    jest.useRealTimers()
  })

  // ── requestVideoFocus blocked by attention ────────────────────────────────

  test('requestVideoFocus does not auto-switch while attention (voiceAssistant) is active', async () => {
    mockPathname = '/media'

    render(
      <Projection
        {...baseProps()}
        settings={{ width: 800, height: 480, fps: 60, autoSwitchOnStream: true } as any}
      />
    )

    // Arm voiceAssistant attention (switches to projection)
    act(() => {
      onEventCb?.(null, {
        type: 'audio',
        payload: { command: AudioCommand.AudioVoiceAssistantStart }
      })
    })
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/', { replace: true }))

    navigateMock.mockClear()

    // requestVideoFocus while voiceAssistant attention is active → blocked
    act(() => {
      onEventCb?.(null, {
        type: 'command',
        message: { value: CommandMapping.requestVideoFocus }
      })
    })

    expect(navigateMock).not.toHaveBeenCalled()
  })

  // ── releaseClusterFocus with no cluster display dismisses overlay ────────────

  test('releaseClusterFocus with no cluster display calls setNavVideoOverlayActive(false)', () => {
    mockPathname = '/media'
    const setNavVideoOverlayActive = jest.fn()

    render(
      <Projection
        {...baseProps({ setNavVideoOverlayActive })}
        settings={
          {
            width: 800,
            height: 480,
            fps: 60,
            cluster: { main: false, dash: false, aux: false },
            autoSwitchOnGuidance: true
          } as any
        }
      />
    )

    act(() => {
      onEventCb?.(null, {
        type: 'command',
        message: { value: CommandMapping.releaseClusterFocus }
      })
    })

    expect(setNavVideoOverlayActive).toHaveBeenCalledWith(false)
  })

  // ── releaseVideoFocus: maps back-navigation ───────────────────────────────

  test('releaseVideoFocus with cluster display navigates back from maps via lastNonClusterPathRef', async () => {
    mockPathname = '/media'

    const { rerender } = render(
      <Projection
        {...baseProps()}
        settings={
          {
            width: 800,
            height: 480,
            fps: 60,
            dashboards: { dash3: { main: true, dash: false, aux: false } },
            autoSwitchOnGuidance: true,
            autoSwitchOnStream: true
          } as any
        }
      />
    )

    // requestClusterFocus stores lastNonClusterPathRef = '/media' and navigates to '/cluster'
    act(() => {
      onEventCb?.(null, {
        type: 'command',
        message: { value: CommandMapping.requestClusterFocus }
      })
    })
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/cluster', { replace: true }))

    navigateMock.mockClear()
    mockPathname = '/cluster'

    rerender(
      <Projection
        {...baseProps()}
        settings={
          {
            width: 800,
            height: 480,
            fps: 60,
            dashboards: { dash3: { main: true, dash: false, aux: false } },
            autoSwitchOnGuidance: true,
            autoSwitchOnStream: true
          } as any
        }
      />
    )

    act(() => {
      onEventCb?.(null, {
        type: 'command',
        message: { value: CommandMapping.releaseVideoFocus }
      })
    })

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/media', { replace: true }))
  })

  // ── releaseVideoFocus: blocked by attention ───────────────────────────────

  test('releaseVideoFocus does not navigate when attention switch is active', async () => {
    mockPathname = '/media'

    const { rerender } = render(
      <Projection
        {...baseProps()}
        settings={
          {
            width: 800,
            height: 480,
            fps: 60,
            cluster: { main: false, dash: false, aux: false },
            autoSwitchOnStream: true,
            autoSwitchOnPhoneCall: true
          } as any
        }
      />
    )

    // requestVideoFocus: auto-switch
    act(() => {
      onEventCb?.(null, {
        type: 'command',
        message: { value: CommandMapping.requestVideoFocus }
      })
    })
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/', { replace: true }))

    // call attention fires on top of that
    act(() => {
      onEventCb?.(null, { type: 'audio', payload: { command: AudioCommand.AudioPhonecallStart } })
    })

    navigateMock.mockClear()
    mockPathname = '/'
    rerender(
      <Projection
        {...baseProps()}
        settings={
          {
            width: 800,
            height: 480,
            fps: 60,
            cluster: { main: false, dash: false, aux: false },
            autoSwitchOnStream: true,
            autoSwitchOnPhoneCall: true
          } as any
        }
      />
    )

    act(() => {
      onEventCb?.(null, {
        type: 'command',
        message: { value: CommandMapping.releaseVideoFocus }
      })
    })

    expect(navigateMock).not.toHaveBeenCalledWith('/media', expect.anything())
  })

  // ── projection worker: audioInfo / pcmData / command / unknown ───────────

  test('projection worker audioInfo message calls setAudioInfo', () => {
    render(<Projection {...baseProps()} />)

    const projectionWorker = MockWorker.instances[0]

    act(() => {
      projectionWorker.emit({
        type: 'audioInfo',
        payload: { codec: 'pcm', sampleRate: 44100, channels: 1, bitDepth: 16 }
      })
    })

    expect(liviState.setAudioInfo).toHaveBeenCalledWith({
      codec: 'pcm',
      sampleRate: 44100,
      channels: 1,
      bitDepth: 16
    })
  })

  test('projection worker pcmData message calls setPcmData', () => {
    render(<Projection {...baseProps()} />)

    const projectionWorker = MockWorker.instances[0]
    const buf = new Float32Array([0.1, 0.2]).buffer

    act(() => {
      projectionWorker.emit({ type: 'pcmData', payload: buf })
    })

    expect(liviState.setPcmData).toHaveBeenCalled()
  })

  test('projection worker command requestHostUI is a no-op when already in settings', async () => {
    mockPathname = '/settings'

    render(<Projection {...baseProps()} />)

    const projectionWorker = MockWorker.instances[0]

    act(() => {
      projectionWorker.emit({
        type: 'command',
        message: { value: CommandMapping.requestHostUI }
      })
    })

    expect(navigateMock).not.toHaveBeenCalledWith('/settings', expect.anything())
  })

  test('IPC command with unrecognized value hits final break', () => {
    render(<Projection {...baseProps()} />)

    act(() => {
      onEventCb?.(null, {
        type: 'command',
        message: { value: 9999 }
      })
    })

    // No throw, no navigation
    expect(navigateMock).not.toHaveBeenCalled()
  })

  // ── USB getDeviceInfo failure ─────────────────────────────────────────────

  test('USB connect logs warning when getDeviceInfo throws', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    ;(window as any).projection.usb.getDeviceInfo = jest
      .fn()
      .mockRejectedValue(new Error('no device'))

    render(<Projection {...baseProps()} />)

    await act(async () => {
      await usbCb?.(null, { type: 'plugged' })
    })

    expect(warnSpy).toHaveBeenCalledWith(
      '[PROJECTION] usb.getDeviceInfo() failed',
      expect.any(Error)
    )

    warnSpy.mockRestore()
  })

  // ── mergeBoxInfo edge cases ───────────────────────────────────────────────

  test('mergeBoxInfo returns prev when boxInfo is an invalid JSON string', () => {
    liviState.boxInfo = { preserved: true }

    render(<Projection {...baseProps()} />)

    act(() => {
      onEventCb?.(null, {
        type: 'dongleInfo',
        payload: { dongleFwVersion: 'fw', boxInfo: '{invalid json' }
      })
    })

    expect(liviState.boxInfo).toMatchObject({ preserved: true })
  })

  test('mergeBoxInfo sets prev to null when existing boxInfo is invalid JSON string', () => {
    liviState.boxInfo = '{bad json'

    render(<Projection {...baseProps()} />)

    act(() => {
      onEventCb?.(null, {
        type: 'dongleInfo',
        payload: { dongleFwVersion: 'fw', boxInfo: { MDLinkType: 'CarPlay' } }
      })
    })

    expect(liviState.boxInfo).toMatchObject({ MDLinkType: 'CarPlay' })
  })

  test('mergeBoxInfo sets prev to null when existing boxInfo is an empty string', () => {
    liviState.boxInfo = '   '

    render(<Projection {...baseProps()} />)

    act(() => {
      onEventCb?.(null, {
        type: 'dongleInfo',
        payload: { dongleFwVersion: 'fw', boxInfo: { MDLinkType: 'CarPlay' } }
      })
    })

    // prev was empty string → prev=null → result is next object
    expect(liviState.boxInfo).toMatchObject({ MDLinkType: 'CarPlay' })
  })

  // ── projection worker: dongleInfo no-op case ─────────────────────────────

  test('projection worker dongleInfo message is silently ignored', () => {
    render(<Projection {...baseProps()} />)

    // Should not throw
    act(() => {
      MockWorker.instances[0]?.emit({ type: 'dongleInfo', payload: {} })
    })
  })

  // ── attention back-path cleared when user navigates manually ─────────────

  test('pathname change while attention is armed clears attentionSwitchedByRef', async () => {
    mockPathname = '/media'

    const { rerender } = render(<Projection {...baseProps()} />)

    // Arm voiceAssistant attention
    act(() => {
      onEventCb?.(null, {
        type: 'audio',
        payload: { command: AudioCommand.AudioVoiceAssistantStart }
      })
    })
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/', { replace: true }))

    // User manually navigates to '/settings' while voiceAssistant is active
    // → the pathname effect clears attentionSwitchedByRef
    mockPathname = '/settings'
    rerender(<Projection {...baseProps()} />)

    navigateMock.mockClear()

    // VoiceAssistant inactive now: attentionSwitchedByRef is already null → no navigation back
    act(() => {
      onEventCb?.(null, {
        type: 'audio',
        payload: { command: AudioCommand.AudioVoiceAssistantStop }
      })
    })

    // No back-navigation since attentionSwitchedByRef was cleared
    expect(navigateMock).not.toHaveBeenCalledWith('/media', expect.anything())
  })

  // ── projection worker onerror handler ────────────────────────────────────

  test('projection worker onerror logs to console.error', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    render(<Projection {...baseProps()} />)

    const projectionWorker = MockWorker.instances[0]
    projectionWorker.triggerError(new ErrorEvent('error', { message: 'worker crash' }))

    expect(errorSpy).toHaveBeenCalledWith('Worker error:', expect.anything())

    errorSpy.mockRestore()
  })

  // ── recalc runs when content-root element is present ─────────────────────

  test('overlay offset recalc runs when content-root is in the DOM', () => {
    const anchor = document.createElement('div')
    anchor.id = 'content-root'
    document.body.appendChild(anchor)

    // No throw; recalc should execute the full body with a zero DOMRect
    expect(() => {
      render(<Projection {...baseProps()} />)
    }).not.toThrow()

    document.body.removeChild(anchor)
  })

  // ── navVideoOverlayActive pointerdown dismiss ─────────────────────────────

  test('navVideoOverlayActive pointerdown dismisses overlay', () => {
    mockPathname = '/media'
    const setNavVideoOverlayActive = jest.fn()

    render(<Projection {...baseProps({ setNavVideoOverlayActive })} navVideoOverlayActive={true} />)

    act(() => {
      const evt = document.createEvent('Event')
      evt.initEvent('pointerdown', true, true)
      window.dispatchEvent(evt)
    })

    expect(setNavVideoOverlayActive).toHaveBeenCalledWith(false)
  })

  test('hidden system monitor opens on two-finger hold and polls only while open', async () => {
    jest.useFakeTimers()
    const dispatchPointer = (
      type: string,
      pointerId: number,
      target: EventTarget = window
    ): void => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'pointerId', { value: pointerId })
      target.dispatchEvent(event)
    }
    const systemStats = jest.fn().mockResolvedValue({
      cpu: 42,
      cores: [20, 40],
      memUsedMb: 1000,
      memTotalMb: 2000,
      memPct: 50,
      swapUsedMb: 0,
      tempC: 45.7,
      load: [1, 0.5, 0.25],
      uptime: 1235
    })
    ;(window as any).app.systemStats = systemStats

    render(<Projection {...baseProps()} />)

    expect(screen.queryByTestId('projection-system-monitor')).not.toBeInTheDocument()
    expect(systemStats).not.toHaveBeenCalled()

    dispatchPointer('pointerdown', 1)
    dispatchPointer('pointerdown', 2)
    act(() => {
      jest.advanceTimersByTime(999)
    })

    expect(screen.queryByTestId('projection-system-monitor')).not.toBeInTheDocument()
    expect(systemStats).not.toHaveBeenCalled()

    await act(async () => {
      jest.advanceTimersByTime(1)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByTestId('projection-system-monitor')).toBeInTheDocument()
    expect(systemStats).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('projection-system-monitor')).toHaveTextContent('42')

    dispatchPointer('pointerup', 1)
    dispatchPointer('pointerup', 2)

    await act(async () => {
      jest.advanceTimersByTime(1000)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(systemStats).toHaveBeenCalledTimes(2)

    act(() => {
      dispatchPointer('pointerdown', 3, screen.getByTestId('projection-system-monitor-backdrop'))
    })
    expect(screen.queryByTestId('projection-system-monitor')).not.toBeInTheDocument()

    act(() => {
      jest.advanceTimersByTime(3000)
    })

    expect(systemStats).toHaveBeenCalledTimes(2)
    jest.useRealTimers()
  })

  test('hidden system monitor opens from the settings action event', async () => {
    const systemStats = jest.fn().mockResolvedValue({
      cpu: 31,
      cores: [30, 32],
      memUsedMb: 900,
      memTotalMb: 2000,
      memPct: 45,
      swapUsedMb: 0,
      tempC: 41,
      load: [0.8, 0.4, 0.2],
      uptime: 100
    })
    ;(window as any).app.systemStats = systemStats

    render(<Projection {...baseProps()} />)
    expect(screen.queryByTestId('projection-system-monitor')).not.toBeInTheDocument()

    await act(async () => {
      window.dispatchEvent(new CustomEvent('livi:open-system-monitor'))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByTestId('projection-system-monitor')).toBeInTheDocument()
    expect(systemStats).toHaveBeenCalledTimes(1)
  })
})

function baseProps(overrides: any = {}) {
  return {
    receivingVideo: false,
    setReceivingVideo: jest.fn(),
    settings: {
      width: 800,
      height: 480,
      fps: 60,
      cluster: { main: false, dash: false, aux: false }
    },
    command: '' as any,
    commandCounter: 0,
    navVideoOverlayActive: false,
    setNavVideoOverlayActive: jest.fn(),
    ...overrides
  }
}
