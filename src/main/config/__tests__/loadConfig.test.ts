import { loadConfig } from '@main/config/loadConfig'
import { existsSync, readFileSync, writeFileSync } from 'fs'

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn()
}))

jest.mock('@main/config/paths', () => ({
  CONFIG_PATH: '/tmp/config.json'
}))

jest.mock('@shared/types', () => ({
  DEFAULT_CONFIG: {
    width: 800,
    height: 480,
    kiosk: true,
    backdropEnabled: false,
    ambientFillEnabled: false,
    roundedCornerMaskEnabled: false,
    bindings: {}
  }
}))

const defaultConfig = {
  width: 800,
  height: 480,
  kiosk: true,
  backdropEnabled: false,
  ambientFillEnabled: false,
  roundedCornerMaskEnabled: false,
  bindings: {}
}

describe('loadConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('returns defaults and writes config when file does not exist', () => {
    ;(existsSync as jest.Mock).mockReturnValue(false)

    const result = loadConfig()

    expect(result).toEqual(defaultConfig)
    expect(writeFileSync).toHaveBeenCalledWith('/tmp/config.json', JSON.stringify(result, null, 2))
  })

  test('reads and returns merged config from file', () => {
    ;(existsSync as jest.Mock).mockReturnValue(true)
    ;(readFileSync as jest.Mock).mockReturnValue(
      JSON.stringify({
        ...defaultConfig,
        width: 1024,
        height: 600,
        kiosk: false
      })
    )

    const result = loadConfig()

    expect(readFileSync).toHaveBeenCalledWith('/tmp/config.json', 'utf8')
    expect(result).toEqual({
      ...defaultConfig,
      width: 1024,
      height: 600,
      kiosk: false
    })
    expect(writeFileSync).not.toHaveBeenCalled()
  })

  test('falls back to defaults and rewrites file when json is invalid', () => {
    ;(existsSync as jest.Mock).mockReturnValue(true)
    ;(readFileSync as jest.Mock).mockReturnValue('{bad-json')

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

    const result = loadConfig()

    expect(result).toEqual(defaultConfig)
    expect(warnSpy).toHaveBeenCalled()
    expect(writeFileSync).toHaveBeenCalledWith('/tmp/config.json', JSON.stringify(result, null, 2))

    warnSpy.mockRestore()
  })

  test('auto-enables the corner mask for legacy backdrop configs without overriding explicit off', () => {
    ;(existsSync as jest.Mock).mockReturnValue(true)
    const legacyConfig = {
      ...defaultConfig,
      backdropEnabled: true
    }
    delete (legacyConfig as Partial<typeof legacyConfig>).roundedCornerMaskEnabled
    ;(readFileSync as jest.Mock).mockReturnValue(JSON.stringify(legacyConfig))

    const result = loadConfig()

    expect(result).toEqual({
      ...defaultConfig,
      backdropEnabled: true,
      roundedCornerMaskEnabled: true
    })
    expect(writeFileSync).toHaveBeenCalledWith('/tmp/config.json', JSON.stringify(result, null, 2))
  })

  test('preserves an explicit corner mask off setting when fill is enabled', () => {
    ;(existsSync as jest.Mock).mockReturnValue(true)
    const savedConfig = {
      ...defaultConfig,
      ambientFillEnabled: true,
      roundedCornerMaskEnabled: false
    }
    ;(readFileSync as jest.Mock).mockReturnValue(JSON.stringify(savedConfig))

    const result = loadConfig()

    expect(result).toEqual(savedConfig)
    expect(writeFileSync).not.toHaveBeenCalled()
  })
})
