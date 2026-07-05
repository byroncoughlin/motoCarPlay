jest.mock('@renderer/components/pages/settings/pages/camera', () => ({
  Camera: () => null
}))
jest.mock('@renderer/components/pages/settings/pages/system/iconUploader/IconUploader', () => ({
  IconUploader: () => null
}))
jest.mock('@renderer/components/pages/settings/pages/system/softwareUpdate/SoftwareUpdate', () => ({
  SoftwareUpdate: () => null
}))
jest.mock('@renderer/components/pages/settings/pages/system/usbDongle/USBDongle', () => ({
  USBDongle: () => null
}))
jest.mock('@renderer/components/pages/settings/pages/system/debug/Debug', () => ({
  Debug: () => null
}))
jest.mock('@renderer/components/pages/settings/pages/system/About', () => ({
  About: () => null
}))
jest.mock('@renderer/components/pages/settings/pages/system/Restart', () => ({
  Restart: () => null
}))
jest.mock('@renderer/components/pages/settings/pages/system/PowerOff', () => ({
  PowerOff: () => null
}))
jest.mock('@renderer/components/pages/settings/SettingsPage', () => ({
  SettingsPage: () => null
}))
jest.mock('@renderer/components/pages/settings/components/BackgroundModeControl', () => ({
  BackgroundModeControl: () => null
}))
jest.mock('@renderer/components/pages/settings/components/TiltCalibrationControl', () => ({
  TiltCalibrationControl: () => null
}))
jest.mock('@renderer/components/pages/settings/components/ClearGraphHistoryControl', () => ({
  ClearGraphHistoryControl: () => null
}))
jest.mock('@renderer/components/pages/settings/components/ClearDiagnosticsControl', () => ({
  ClearDiagnosticsControl: () => null
}))

import { audioSchema } from '../audioSchema'
import { generalSchema } from '../generalSchema'
import { settingsRoutes, settingsSchema } from '../schema'
import { systemSchema } from '../systemSchema'
import { videoSchema } from '../videoSchema'

function collectPaths(node: any): string[] {
  const own = typeof node?.path === 'string' && node.path !== '' ? [node.path] : []
  const childPaths = Array.isArray(node?.children) ? node.children.flatMap(collectPaths) : []
  return [...own, ...childPaths]
}

describe('settings schemas', () => {
  test('root schemas have route type and children', () => {
    for (const s of [generalSchema, audioSchema, videoSchema, systemSchema]) {
      expect(s.type).toBe('route')
      expect(Array.isArray((s as any).children)).toBe(true)
      expect((s as any).children.length).toBeGreaterThan(0)
    }
  })

  test('audio value transform handles invalid and valid values', () => {
    if (audioSchema.type !== 'route') {
      throw new Error('audioSchema must be a route node')
    }
    const slider = (audioSchema.children as any[]).find((x) => x.path === 'audioVolume')
    expect(slider.valueTransform.toView(0.45)).toBe(45)
    expect(slider.valueTransform.fromView(25, 1)).toBe(0.25)
    expect(slider.valueTransform.fromView(Number.NaN, 0.8)).toBe(0.8)
    expect(slider.valueTransform.format(50)).toBe('50 %')
  })

  test('settings landing goes straight to the moto controls with an Advanced route', () => {
    expect(settingsSchema.type).toBe('route')
    if (settingsSchema.type !== 'route') {
      throw new Error('settingsSchema must be a route node')
    }
    const children = settingsSchema.children as any[]
    // Landing exposes the most-used moto controls directly (no more two tabs).
    expect(children[0]).toMatchObject({ type: 'custom', label: 'Background' })
    // Light/dark mode lives on the landing.
    expect(children.some((c) => c.path === 'appearanceMode')).toBe(true)
    expect(children.some((c) => c.path === 'diagnosticMode')).toBe(true)
    // The old System settings are now behind a single "Advanced" route at the end.
    const advanced = children.find((c) => c.route === 'advanced')
    expect(advanced).toBeTruthy()
    expect(children[children.length - 1].route).toBe('advanced')
    expect(settingsRoutes?.path).toBe('new-settings')
    expect(Array.isArray(settingsRoutes?.children)).toBe(true)
  })

  test('landing exposes phone light/dark controls up top', () => {
    if (settingsSchema.type !== 'route') {
      throw new Error('settingsSchema must be a route node')
    }
    const children = settingsSchema.children as any[]
    const appearance = children.find((c) => c.path === 'appearanceMode')
    expect(appearance).toMatchObject({ type: 'select' })
    expect(appearance.options.map((o: any) => o.value)).toEqual(['scheduled', 'day', 'night'])
    expect(children.some((c) => c.path === 'appearanceDayStartHour')).toBe(true)
    expect(children.some((c) => c.path === 'appearanceNightStartHour')).toBe(true)
    // The light/dark menu color pickers and the menu color-mode toggle live in
    // Advanced now (they only affect the settings menu theme, adjusted rarely).
    expect(children.some((c) => c.route === 'appearanceColors')).toBe(false)
    expect(children.some((c) => c.path === 'darkMode')).toBe(false)
  })

  test('Advanced route keeps the LIVI/CarPlay system pages', () => {
    if (settingsSchema.type !== 'route') {
      throw new Error('settingsSchema must be a route node')
    }
    const advanced = (settingsSchema.children as any[]).find((c) => c.route === 'advanced')
    expect(advanced.children.map((child: any) => child.label)).toEqual([
      'Settings Color Mode',
      'Round Corners',
      'Settings Menu Colors',
      'Wi-Fi Frequency',
      'Auto Connect',
      'Preferred Connection',
      'FPS',
      'View Area',
      'USB Dongle Info',
      'About'
    ])
    expect(advanced.children.map((child: any) => child.route).filter(Boolean)).toEqual([
      'appearanceColors',
      'viewArea',
      'usbDongle',
      'about'
    ])
    const preferredConnection = advanced.children.find(
      (child: any) => child.path === 'connectionPreference'
    )
    expect(preferredConnection.options.map((option: any) => option.value)).toEqual([
      'dongle',
      'auto',
      'native'
    ])
  })

  test('active moto settings omit unused generic controls from the round dashboard', () => {
    const paths = collectPaths(settingsSchema)
    const rootRoutes =
      settingsSchema.type === 'route' ? settingsSchema.children.map((c) => c.route) : []

    expect(rootRoutes).not.toEqual(
      expect.arrayContaining(['connection', 'audio', 'bindings', 'projection'])
    )
    expect(paths).not.toEqual(
      expect.arrayContaining([
        'audioVolume',
        'navVolume',
        'bindings.up',
        'bindings.down',
        'camera.main',
        'camera.dash',
        'camera.aux',
        'cameraId',
        'cameraMirror',
        'disableAudioOutput',
        'audioInputDevice',
        'audioInputDeviceLabel',
        'micType',
        'kiosk.main',
        'projectionSafeAreaTop',
        'projectionSafeAreaBottom',
        'projectionSafeAreaLeft',
        'projectionSafeAreaRight'
      ])
    )
  })

  test('Background section is driven by the custom BackgroundModeControl (no standalone draw-outside checkbox)', () => {
    const children = (settingsSchema as any).children as any[]
    // Extend/draw-outside is now one of the mutually-exclusive Background modes
    // inside the custom control, not a separate checkbox field.
    const standaloneToggle = children.find(
      (c) => c.path === 'projectionSafeAreaDrawOutside' && c.section === 'Background'
    )
    expect(standaloneToggle).toBeUndefined()
    const custom = children.find((c) => c.section === 'Background' && c.type === 'custom')
    expect(custom).toBeDefined()
  })
})
