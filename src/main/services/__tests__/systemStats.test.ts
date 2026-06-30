import {
  cpuPct,
  parseCpuSnapshot,
  parsePmicVolts,
  parseThrottled,
  parseVolts,
  pickIpAddresses,
  readPowerStatus,
  readSystemStats
} from '../systemStats'

describe('systemStats', () => {
  test('parseCpuSnapshot reads aggregate and per-core lines', () => {
    expect(
      parseCpuSnapshot('cpu  100 0 100 700 100 0 0 0\ncpu0 10 0 10 80 0 0 0 0\nintr 1\n')
    ).toEqual({
      cpu: [100, 0, 100, 700, 100, 0, 0, 0],
      cpu0: [10, 0, 10, 80, 0, 0, 0, 0]
    })
  })

  test('cpuPct calculates active CPU percentage from two snapshots', () => {
    expect(cpuPct([100, 0, 100, 700, 100], [150, 0, 150, 800, 100])).toBe(50)
    expect(cpuPct([1, 1, 1, 1], [1, 1, 1, 1])).toBe(0)
    expect(cpuPct(undefined, [1, 1, 1, 1])).toBe(0)
  })

  test('parseThrottled extracts the hex bitmask', () => {
    expect(parseThrottled('throttled=0x50005')).toBe(0x50005)
    expect(parseThrottled('throttled=0x0')).toBe(0)
    expect(parseThrottled('garbage')).toBeNull()
  })

  test('parseVolts reads the core voltage', () => {
    expect(parseVolts('volt=0.8563V')).toBe(0.86)
    expect(parseVolts('nope')).toBeNull()
  })

  test('parsePmicVolts reads the labeled input rail voltage', () => {
    expect(parsePmicVolts('EXT5V_V volt(24)=4.95781250V', 'EXT5V_V')).toBe(4.96)
    expect(parsePmicVolts('OTHER volt(1)=5.0V', 'EXT5V_V')).toBeNull()
  })

  test('readPowerStatus decodes throttle bits and voltages', () => {
    const execText = jest.fn((cmd: string) => {
      if (cmd === 'vcgencmd get_throttled') return 'throttled=0x50005'
      if (cmd === 'vcgencmd measure_volts') return 'volt=0.8500V'
      if (cmd === 'vcgencmd pmic_read_adc EXT5V_V') return 'EXT5V_V volt(24)=4.80V'
      throw new Error(`unexpected ${cmd}`)
    })
    expect(readPowerStatus(execText)).toEqual({
      throttledRaw: 0x50005,
      underVoltageNow: true,
      freqCappedNow: false,
      throttledNow: true,
      underVoltageOccurred: true,
      throttledOccurred: true,
      coreVolts: 0.85,
      inputVolts: 4.8
    })
  })

  test('readPowerStatus returns null when vcgencmd is unavailable', () => {
    const execText = jest.fn(() => {
      throw new Error('not a pi')
    })
    expect(readPowerStatus(execText)).toBeNull()
  })

  test('pickIpAddresses separates wired and wireless IPv4, skipping loopback / link-local', () => {
    expect(
      pickIpAddresses({
        lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
        wlan0: [{ address: '10.0.0.50', family: 'IPv4', internal: false }],
        eth0: [
          { address: 'fe80::1', family: 'IPv6', internal: false },
          { address: '192.168.4.25', family: 'IPv4', internal: false }
        ]
      })
    ).toEqual({ wired: '192.168.4.25', wireless: '10.0.0.50' })
  })

  test('pickIpAddresses reports wireless only when no wired interface', () => {
    expect(
      pickIpAddresses({
        wlan0: [{ address: '10.0.0.50', family: 4, internal: false }]
      })
    ).toEqual({ wired: null, wireless: '10.0.0.50' })
  })

  test('pickIpAddresses treats unknown interface names as wired', () => {
    expect(
      pickIpAddresses({
        usb0: [{ address: '172.16.0.9', family: 'IPv4', internal: false }]
      })
    ).toEqual({ wired: '172.16.0.9', wireless: null })
  })

  test('pickIpAddresses returns nulls when only loopback / link-local are present', () => {
    expect(
      pickIpAddresses({
        lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
        eth0: [{ address: '169.254.1.2', family: 'IPv4', internal: false }]
      })
    ).toEqual({ wired: null, wireless: null })
  })

  test('readSystemStats reads cpu, memory, temperature, load, and uptime', async () => {
    const statSnapshots = [
      'cpu  100 0 100 700 100\ncpu0 10 0 10 80 0\ncpu1 20 0 20 60 0\n',
      'cpu  150 0 150 800 100\ncpu0 20 0 20 120 0\ncpu1 25 0 25 100 0\n'
    ]
    const readText = jest.fn((path: string) => {
      if (path === '/proc/stat') return statSnapshots.shift() ?? ''
      if (path === '/proc/meminfo') {
        return [
          'MemTotal:       2048000 kB',
          'MemAvailable:   1024000 kB',
          'SwapTotal:       524288 kB',
          'SwapFree:        262144 kB'
        ].join('\n')
      }
      if (path === '/sys/class/thermal/thermal_zone0/temp') return '45678\n'
      if (path === '/proc/loadavg') return '1.00 0.50 0.25 1/2 3\n'
      if (path === '/proc/uptime') return '1234.5 99.0\n'
      throw new Error(`unexpected path ${path}`)
    })
    const statfs = jest.fn().mockReturnValue({
      bsize: 4096,
      blocks: 1024000,
      bavail: 256000
    })
    const sleep = jest.fn().mockResolvedValue(undefined)
    const execText = jest.fn(() => {
      throw new Error('vcgencmd unavailable')
    })
    const readNetInterfaces = jest.fn(() => ({
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      eth0: [{ address: '192.168.4.25', family: 'IPv4', internal: false }],
      wlan0: [{ address: '10.0.0.50', family: 'IPv4', internal: false }]
    }))

    await expect(
      readSystemStats({ readText, statfs, sleep, execText, readNetInterfaces, sampleMs: 0 })
    ).resolves.toEqual({
      cpu: 50,
      cores: [33, 20],
      memUsedMb: 1000,
      memTotalMb: 2000,
      memPct: 50,
      diskFreeMb: 1000,
      diskTotalMb: 4000,
      diskPct: 75,
      swapUsedMb: 256,
      tempC: 45.7,
      load: [1, 0.5, 0.25],
      uptime: 1235,
      power: null,
      wiredIp: '192.168.4.25',
      wirelessIp: '10.0.0.50'
    })
    expect(statfs).toHaveBeenCalledWith('/')
    expect(sleep).toHaveBeenCalledWith(0)
  })

  test('readSystemStats tolerates optional sensor files being unavailable', async () => {
    const readText = jest.fn((path: string) => {
      if (path === '/proc/stat') return 'cpu  0 0 0 10 0\n'
      if (path === '/proc/meminfo') return 'MemTotal: 1024 kB\n'
      throw new Error(`missing ${path}`)
    })

    await expect(
      readSystemStats({
        readText,
        statfs: jest.fn(() => {
          throw new Error('missing statfs')
        }),
        sleep: jest.fn().mockResolvedValue(undefined),
        sampleMs: 0
      })
    ).resolves.toMatchObject({
      cpu: 0,
      cores: [],
      memUsedMb: null,
      memTotalMb: 1,
      memPct: null,
      diskFreeMb: null,
      diskTotalMb: null,
      diskPct: null,
      swapUsedMb: null,
      tempC: null,
      load: null,
      uptime: null
    })
  })
})
