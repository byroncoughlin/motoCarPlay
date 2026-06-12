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
      'connection',
      'audio',
      'bindings',
      'motoDisplay',
      'projection',
      'system'
    ])
    expect(settingsRoutes?.path).toBe('new-settings')
    expect(Array.isArray(settingsRoutes?.children)).toBe(true)
  })

  test('moto connection settings expose Wi-Fi frequency like the round dashboard', () => {
    if (settingsSchema.type !== 'route') {
      throw new Error('settingsSchema must be a route node')
    }

    const connection = (settingsSchema.children as any[]).find(
      (child) => child.route === 'connection'
    )
    const wifi = connection.children.find((child: any) => child.path === 'wifiType')

    expect(wifi).toMatchObject({
      type: 'select',
      label: 'Wi-Fi Frequency',
      displayValue: true
    })
    expect(wifi.options.map((option: any) => option.value)).toEqual(['2.4ghz', '5ghz'])
  })

  test('moto settings expose the compact audio sliders from the round dashboard', () => {
    if (settingsSchema.type !== 'route') {
      throw new Error('settingsSchema must be a route node')
    }

    const audio = (settingsSchema.children as any[]).find((child) => child.route === 'audio')
    const sliders = audio.children.filter((child: any) => child.type === 'slider')

    expect(sliders.map((child: any) => child.path)).toEqual(['audioVolume', 'navVolume'])
    expect(sliders.map((child: any) => child.label)).toEqual(['Music', 'Navigation'])
    expect(sliders[0].valueTransform.toView(0.42)).toBe(42)
    expect(sliders[0].valueTransform.fromView(65, 1)).toBe(0.65)
  })

  test('moto settings expose the compact round dashboard key bindings', () => {
    if (settingsSchema.type !== 'route') {
      throw new Error('settingsSchema must be a route node')
    }

    const bindings = (settingsSchema.children as any[]).find(
      (child) => child.route === 'bindings'
    )

    expect(bindings.children.map((child: any) => child.bindingKey)).toEqual([
      'up',
      'down',
      'left',
      'right',
      'selectUp',
      'selectDown',
      'back',
      'home',
      'playPause',
      'pause',
      'next',
      'prev'
    ])
    expect(bindings.children.map((child: any) => child.defaultValue)).toEqual([
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'KeyB',
      'Space',
      'Backspace',
      'KeyH',
      'KeyP',
      'KeyO',
      'KeyN',
      'KeyB'
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
      'ambientFillEnabled',
      'ambientFillColor',
      '',
      ''
    ])
    expect(motoDisplay.children.map((child: any) => child.label)).toEqual([
      'Backdrop',
      'Ambient Fill',
      'Fill Color',
      'Tilt Calibration',
      'Graph History'
    ])
    expect(motoDisplay.children[2]).toMatchObject({
      type: 'color',
      displayValue: true
    })
  })

  test('active moto settings omit unused generic controls from the round dashboard', () => {
    const paths = collectPaths(settingsSchema)

    expect(paths).not.toEqual(
      expect.arrayContaining([
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
        'kiosk.main'
      ])
    )
  })
})
