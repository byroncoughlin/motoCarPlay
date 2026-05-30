import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { bootstrapCompositor } from '../compositorBootstrap'

jest.mock('node:child_process', () => ({ spawn: jest.fn() }))
jest.mock('node:fs', () => ({ existsSync: jest.fn() }))

const mockedSpawn = spawn as jest.Mock
const mockedExistsSync = existsSync as jest.Mock

describe('bootstrapCompositor', () => {
  const originalPlatform = process.platform
  const originalEnv = process.env
  const originalResourcesPath = process.resourcesPath

  const setPlatform = (value: string) => {
    Object.defineProperty(process, 'platform', { value, configurable: true })
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockedSpawn.mockReturnValue({ unref: jest.fn() })
    mockedExistsSync.mockReturnValue(true)
    process.env = { ...originalEnv }
    delete process.env.LIVI_COMPOSITOR
    delete process.env.LIVI_NO_COMPOSITOR
    process.env.APPIMAGE = '/home/user/LIVI.AppImage'
    ;(process as { resourcesPath: string }).resourcesPath = '/opt/livi/resources'
    setPlatform('linux')
  })

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    process.env = originalEnv
    ;(process as { resourcesPath?: string }).resourcesPath = originalResourcesPath
  })

  test('returns false and does not spawn on non-linux', () => {
    setPlatform('darwin')
    expect(bootstrapCompositor()).toBe(false)
    expect(mockedSpawn).not.toHaveBeenCalled()
  })

  test('returns false when already inside the compositor', () => {
    process.env.LIVI_COMPOSITOR = '1'
    expect(bootstrapCompositor()).toBe(false)
    expect(mockedSpawn).not.toHaveBeenCalled()
  })

  test('returns false when opted out', () => {
    process.env.LIVI_NO_COMPOSITOR = '1'
    expect(bootstrapCompositor()).toBe(false)
    expect(mockedSpawn).not.toHaveBeenCalled()
  })

  test('returns false when not an AppImage', () => {
    delete process.env.APPIMAGE
    expect(bootstrapCompositor()).toBe(false)
    expect(mockedSpawn).not.toHaveBeenCalled()
  })

  test('returns false when the compositor launcher is missing', () => {
    mockedExistsSync.mockReturnValue(false)
    expect(bootstrapCompositor()).toBe(false)
    expect(mockedSpawn).not.toHaveBeenCalled()
  })

  test('spawns the compositor and re-execs the AppImage inside it', () => {
    expect(bootstrapCompositor()).toBe(true)

    expect(mockedSpawn).toHaveBeenCalledTimes(1)
    const [launcher, argv, opts] = mockedSpawn.mock.calls[0]
    expect(launcher).toBe('/opt/livi/resources/compositor/livi-compositor')
    expect(argv[0]).toBe('-s')
    expect(argv[1]).toContain('LIVI_COMPOSITOR=1')
    expect(argv[1]).toContain('/home/user/LIVI.AppImage')
    expect(argv[1]).toContain('--ozone-platform=wayland')
    expect(opts.detached).toBe(true)
    expect(opts.env.LIVI_UI_APP_ID).toBe('livi')
    expect(opts.env.APPIMAGE).toBeUndefined()
  })
})
