import { linuxPresetAngleVulkan } from '@main/utils'
import { app } from 'electron'

jest.mock('electron', () => ({
  app: {
    commandLine: {
      appendSwitch: jest.fn()
    }
  }
}))

jest.mock('@main/utils', () => ({
  linuxPresetAngleVulkan: jest.fn(),
  setFeatureFlags: jest.fn()
}))

const mockedAppendSwitch = app.commandLine.appendSwitch as jest.Mock
const mockedLinuxPresetAngleVulkan = linuxPresetAngleVulkan as jest.Mock

describe('gpu module', () => {
  const originalPlatform = process.platform
  const originalArch = process.arch

  const loadGpuModule = () => {
    jest.isolateModules(() => {
      require('@main/app/gpu')
    })
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    Object.defineProperty(process, 'arch', { value: originalArch })
  })

  test('commonGpuToggles applies expected chromium gpu flags', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    Object.defineProperty(process, 'arch', { value: 'x64' })

    let commonGpuToggles: () => void

    jest.isolateModules(() => {
      ;({ commonGpuToggles } = require('@main/app/gpu'))
    })

    mockedAppendSwitch.mockClear()
    commonGpuToggles()

    expect(mockedAppendSwitch).toHaveBeenCalledWith('ignore-gpu-blocklist')
    expect(mockedAppendSwitch).toHaveBeenCalledWith('enable-gpu-rasterization')
  })

  test('on linux x64 import applies gpu toggles and linux preset', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    Object.defineProperty(process, 'arch', { value: 'x64' })

    loadGpuModule()

    expect(mockedAppendSwitch).toHaveBeenCalledWith('ignore-gpu-blocklist')
    expect(mockedAppendSwitch).toHaveBeenCalledWith('enable-gpu-rasterization')
    expect(mockedLinuxPresetAngleVulkan).toHaveBeenCalledTimes(1)
  })

  test('on linux non-x64 import applies gpu toggles but not the vulkan preset', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    Object.defineProperty(process, 'arch', { value: 'arm64' })

    loadGpuModule()

    expect(mockedAppendSwitch).toHaveBeenCalledWith('ignore-gpu-blocklist')
    expect(mockedAppendSwitch).toHaveBeenCalledWith('enable-gpu-rasterization')
    expect(mockedLinuxPresetAngleVulkan).not.toHaveBeenCalled()
  })

  test('on darwin import applies no startup gpu side effects', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    Object.defineProperty(process, 'arch', { value: 'arm64' })

    loadGpuModule()

    expect(mockedLinuxPresetAngleVulkan).not.toHaveBeenCalled()
    expect(mockedAppendSwitch).not.toHaveBeenCalled()
  })

  test('on unsupported platform import does not apply startup gpu side effects', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    Object.defineProperty(process, 'arch', { value: 'x64' })

    loadGpuModule()

    expect(mockedLinuxPresetAngleVulkan).not.toHaveBeenCalled()
    expect(mockedAppendSwitch).not.toHaveBeenCalled()
  })
})
