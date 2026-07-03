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

import { appearanceSchema } from '../appearanceSchema'
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
    for (const s of [generalSchema, audioSchema, videoSchema, appearanceSchema, systemSchema]) {
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

  test('settings schema aggregates major sections and generates routes', () => {
    expect(settingsSchema.type).toBe('route')
    if (settingsSchema.type !== 'route') {
      throw new Error('settingsSchema must be a route node')
    }
    expect((settingsSchema.children as any[]).map((child) => child.route)).toEqual([
      'system',
      'motoDisplay'
    ])
    expect(settingsRoutes?.path).toBe('new-settings')
    expect(Array.isArray(settingsRoutes?.children)).toBe(true)
  })

  test('moto system settings flatten connection controls into the system list', () => {
    if (settingsSchema.type !== 'route') {
      throw new Error('settingsSchema must be a route node')
    }

    const system = (settingsSchema.children as any[]).find((child) => child.route === 'system')
    const wifi = system.children.find((child: any) => child.path === 'wifiType')
    const autoConnect = system.children.find((child: any) => child.path === 'autoConn')
    const preferredConnection = system.children.find(
      (child: any) => child.path === 'connectionPreference'
    )

    expect(wifi).toMatchObject({
      type: 'select',
      label: 'Wi-Fi Frequency',
      displayValue: true
    })
    expect(wifi.options.map((option: any) => option.value)).toEqual(['2.4ghz', '5ghz'])
    expect(autoConnect).toMatchObject({
      type: 'checkbox',
      label: 'Auto Connect'
    })
    expect(preferredConnection.options.map((option: any) => option.value)).toEqual([
      'dongle',
      'auto',
      'native'
    ])
  })

  test('moto display settings expose the cheap backdrop/fill controls and tilt calibration', () => {
    if (settingsSchema.type !== 'route') {
      throw new Error('settingsSchema must be a route node')
    }

    const motoDisplay = (settingsSchema.children as any[]).find(
      (child) => child.route === 'motoDisplay'
    )

    expect(motoDisplay.children.map((child: any) => child.path)).toEqual([
      'backdropEnabled',
      'backdropMode',
      'ambientFillEnabled',
      'ambientFillColor',
      'roundedCornerMaskEnabled',
      '',
      'reverseTilt',
      'reversePitch',
      '',
      'diagnosticMode',
      ''
    ])
    expect(motoDisplay.children.map((child: any) => child.label)).toEqual([
      'Backdrop',
      'Backdrop Style',
      'Ambient Fill',
      'Fill Color',
      'Round Corners',
      'Tilt Calibration',
      'Reverse Tilt',
      'Reverse Front/Back',
      'Graph History',
      'Diagnostic Mode',
      'Diagnostic Data'
    ])
    expect(motoDisplay.children[1]).toMatchObject({
      type: 'select',
      displayValue: true,
      options: [
        { label: 'Average Color', value: 'color' },
        { label: 'Blur Glow', value: 'blur' }
      ]
    })
    expect(motoDisplay.children[3]).toMatchObject({
      type: 'color',
      displayValue: true
    })
  })

  test('moto system settings flatten projection controls and keep detail pages', () => {
    if (settingsSchema.type !== 'route') {
      throw new Error('settingsSchema must be a route node')
    }

    const system = (settingsSchema.children as any[]).find((child) => child.route === 'system')
    const projectionControls = system.children.filter((child: any) =>
      ['projectionFps', 'projectionDpi', 'viewArea'].includes(child.path || child.route)
    )

    expect(projectionControls.map((child: any) => child.label)).toEqual(['FPS', 'DPI', 'View Area'])
    expect(projectionControls.map((child: any) => child.path)).toEqual([
      'projectionFps',
      'projectionDpi',
      ''
    ])
    expect(projectionControls.map((child: any) => child.route)).toEqual([
      undefined,
      undefined,
      'viewArea'
    ])
  })

  test('moto system settings keep only active system pages', () => {
    if (settingsSchema.type !== 'route') {
      throw new Error('settingsSchema must be a route node')
    }

    const system = (settingsSchema.children as any[]).find((child) => child.route === 'system')

    expect(system.children.map((child: any) => child.label)).toEqual([
      'Wi-Fi Frequency',
      'Auto Connect',
      'Preferred Connection',
      'FPS',
      'DPI',
      'View Area',
      'USB Dongle Info',
      'About'
    ])
    expect(system.children.map((child: any) => child.route).filter(Boolean)).toEqual([
      'viewArea',
      'usbDongle',
      'about'
    ])
    expect(system.children.map((child: any) => child.route)).not.toEqual(
      expect.arrayContaining(['restart', 'poweroff'])
    )
    expect(
      system.children.find((child: any) => child.route === 'usbDongle').children[0].label
    ).toBe('USB Dongle Info')
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
        'darkMode',
        'disableAudioOutput',
        'audioInputDevice',
        'audioInputDeviceLabel',
        'micType',
        'kiosk.main',
        'projectionSafeAreaTop',
        'projectionSafeAreaBottom',
        'projectionSafeAreaLeft',
        'projectionSafeAreaRight',
        'projectionSafeAreaDrawOutside'
      ])
    )
  })
})
