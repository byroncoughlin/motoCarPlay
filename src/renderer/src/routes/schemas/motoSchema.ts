import type { Config } from '@shared/types'
import { TiltCalibrationControl } from '../../components/pages/settings/components/TiltCalibrationControl'
import {
  AREA_STEP,
  MAX_DPI,
  MAX_FPS,
  MIN_DPI,
  MIN_FPS,
  SAFE_AREA_MAX_HEIGHT,
  SAFE_AREA_MAX_WIDTH,
  SAFE_AREA_MIN
} from '../../components/pages/settings/constants'
import { About } from '../../components/pages/settings/pages/system/About'
import { PowerOff } from '../../components/pages/settings/pages/system/PowerOff'
import { Restart } from '../../components/pages/settings/pages/system/Restart'
import { USBDongle } from '../../components/pages/settings/pages/system/usbDongle/USBDongle'
import { SettingsNode, ValueTransform } from '../types'

const audioValueTransform: ValueTransform<number | undefined, number> = {
  toView: (v) => Math.round((v ?? 1) * 100),
  fromView: (v, prev) => {
    const next = v / 100
    if (!Number.isFinite(next)) return prev ?? 1
    return next
  },
  format: (v) => `${v} %`
}

export const motoSettingsSchema: SettingsNode<Config> = {
  type: 'route',
  route: 'new-settings',
  label: 'Settings',
  labelKey: 'settings.settingsTitle',
  path: 'settings',
  children: [
    {
      type: 'route',
      route: 'connection',
      label: 'Connection',
      path: '',
      children: [
        {
          type: 'select',
          label: 'Wi-Fi Frequency',
          labelKey: 'settings.wifiFrequency',
          path: 'wifiType',
          displayValue: true,
          options: [
            { label: '2.4 GHz', value: '2.4ghz' },
            { label: '5 GHz', value: '5ghz' }
          ],
          page: {
            title: 'Wi-Fi Frequency',
            labelTitle: 'settings.wifiFrequency',
            description: 'Wi-Fi frequency selection.',
            labelDescription: 'settings.wifiFrequencyDescription'
          }
        },
        {
          type: 'checkbox',
          label: 'Auto Connect',
          labelKey: 'settings.autoConnect',
          path: 'autoConn'
        },
        {
          type: 'select',
          label: 'Preferred Connection',
          labelKey: 'settings.preferredConnection',
          path: 'connectionPreference',
          displayValue: true,
          options: [
            { label: 'Dongle', labelKey: 'settings.preferredConnectionDongle', value: 'dongle' },
            { label: 'Auto', labelKey: 'settings.preferredConnectionAuto', value: 'auto' },
            { label: 'Native', labelKey: 'settings.preferredConnectionNative', value: 'native' }
          ],
          page: {
            title: 'Preferred Connection',
            labelTitle: 'settings.preferredConnection',
            description: 'Which transport to bring up when more than one transport is available.',
            labelDescription: 'settings.preferredConnectionDescription'
          }
        }
      ]
    },
    {
      type: 'route',
      route: 'audio',
      label: 'Audio',
      labelKey: 'settings.audio',
      path: '',
      children: [
        {
          type: 'slider',
          label: 'Music',
          labelKey: 'settings.music',
          path: 'audioVolume',
          displayValue: true,
          displayValueUnit: '%',
          valueTransform: audioValueTransform,
          page: {
            title: 'Music',
            labelTitle: 'settings.music',
            description: 'Music volume.',
            labelDescription: 'settings.musicDescription'
          }
        },
        {
          type: 'slider',
          label: 'Navigation',
          labelKey: 'settings.navigation',
          path: 'navVolume',
          displayValue: true,
          displayValueUnit: '%',
          valueTransform: audioValueTransform,
          page: {
            title: 'Navigation',
            labelTitle: 'settings.navigation',
            description: 'Navigation volume.',
            labelDescription: 'settings.navigationDescription'
          }
        }
      ]
    },
    {
      type: 'route',
      route: 'motoDisplay',
      label: 'Moto Display',
      path: '',
      children: [
        {
          type: 'checkbox',
          label: 'Backdrop',
          path: 'backdropEnabled'
        },
        {
          type: 'checkbox',
          label: 'Background Fill',
          path: 'ambientFillEnabled'
        },
        {
          type: 'color',
          label: 'Background Color',
          path: 'ambientFillColor',
          displayValue: true
        },
        {
          type: 'custom',
          label: 'Tilt Calibration',
          path: '',
          component: TiltCalibrationControl
        }
      ]
    },
    {
      type: 'route',
      route: 'projection',
      label: 'Projection',
      path: '',
      children: [
        {
          type: 'number',
          label: 'FPS',
          labelKey: 'settings.projectionFps',
          path: 'projectionFps',
          min: MIN_FPS,
          max: MAX_FPS,
          step: 1,
          displayValue: true,
          page: {
            title: 'FPS',
            labelTitle: 'settings.projectionFps',
            description: 'Stream FPS.',
            labelDescription: 'settings.projectionFpsDescription'
          }
        },
        {
          type: 'number',
          label: 'DPI',
          labelKey: 'settings.projectionDpi',
          path: 'projectionDpi',
          min: MIN_DPI,
          max: MAX_DPI,
          step: 1,
          displayValue: true,
          page: {
            title: 'DPI',
            labelTitle: 'settings.projectionDpi',
            description: 'Main stream DPI (0 = auto).',
            labelDescription: 'settings.projectionDpiDescription'
          }
        },
        {
          type: 'route',
          label: 'View Area',
          labelKey: 'settings.viewArea',
          route: 'viewArea',
          path: '',
          children: [
            {
              type: 'number',
              label: 'Top',
              labelKey: 'settings.top',
              path: 'projectionViewAreaTop',
              min: SAFE_AREA_MIN,
              max: SAFE_AREA_MAX_HEIGHT,
              step: AREA_STEP,
              displayValue: true
            },
            {
              type: 'number',
              label: 'Bottom',
              labelKey: 'settings.bottom',
              path: 'projectionViewAreaBottom',
              min: SAFE_AREA_MIN,
              max: SAFE_AREA_MAX_HEIGHT,
              step: AREA_STEP,
              displayValue: true
            },
            {
              type: 'number',
              label: 'Left',
              labelKey: 'settings.left',
              path: 'projectionViewAreaLeft',
              min: SAFE_AREA_MIN,
              max: SAFE_AREA_MAX_WIDTH,
              step: AREA_STEP,
              displayValue: true
            },
            {
              type: 'number',
              label: 'Right',
              labelKey: 'settings.right',
              path: 'projectionViewAreaRight',
              min: SAFE_AREA_MIN,
              max: SAFE_AREA_MAX_WIDTH,
              step: AREA_STEP,
              displayValue: true
            }
          ]
        },
        {
          type: 'route',
          label: 'Safe Area',
          labelKey: 'settings.safeArea',
          route: 'safeArea',
          path: '',
          children: [
            {
              type: 'number',
              label: 'Top',
              labelKey: 'settings.top',
              path: 'projectionSafeAreaTop',
              min: SAFE_AREA_MIN,
              max: SAFE_AREA_MAX_HEIGHT,
              step: AREA_STEP,
              displayValue: true
            },
            {
              type: 'number',
              label: 'Bottom',
              labelKey: 'settings.bottom',
              path: 'projectionSafeAreaBottom',
              min: SAFE_AREA_MIN,
              max: SAFE_AREA_MAX_HEIGHT,
              step: AREA_STEP,
              displayValue: true
            },
            {
              type: 'number',
              label: 'Left',
              labelKey: 'settings.left',
              path: 'projectionSafeAreaLeft',
              min: SAFE_AREA_MIN,
              max: SAFE_AREA_MAX_WIDTH,
              step: AREA_STEP,
              displayValue: true
            },
            {
              type: 'number',
              label: 'Right',
              labelKey: 'settings.right',
              path: 'projectionSafeAreaRight',
              min: SAFE_AREA_MIN,
              max: SAFE_AREA_MAX_WIDTH,
              step: AREA_STEP,
              displayValue: true
            },
            {
              type: 'checkbox',
              label: 'Draw Outside',
              labelKey: 'settings.drawOutside',
              path: 'projectionSafeAreaDrawOutside'
            }
          ]
        }
      ]
    },
    {
      type: 'route',
      route: 'system',
      label: 'System',
      labelKey: 'settings.system',
      path: '',
      children: [
        {
          type: 'route',
          label: 'USB Dongle',
          labelKey: 'settings.usbDongle',
          route: 'usbDongle',
          path: '',
          children: [
            {
              type: 'custom',
              label: 'USB Dongle',
              labelKey: 'settings.usbDongle',
              path: 'carName',
              component: USBDongle
            }
          ]
        },
        {
          type: 'route',
          label: 'Restart System',
          labelKey: 'settings.restartSystem',
          route: 'restart',
          path: '',
          children: [
            {
              type: 'custom',
              label: 'Restart System',
              labelKey: 'settings.restartSystem',
              path: 'carName',
              component: Restart
            }
          ]
        },
        {
          type: 'route',
          label: 'Power Off',
          labelKey: 'settings.powerOff',
          route: 'poweroff',
          path: '',
          children: [
            {
              type: 'custom',
              label: 'Power Off',
              labelKey: 'settings.powerOff',
              path: 'carName',
              component: PowerOff
            }
          ]
        },
        {
          type: 'route',
          label: 'About',
          labelKey: 'settings.about',
          route: 'about',
          path: '',
          children: [
            {
              type: 'custom',
              label: 'About',
              labelKey: 'settings.about',
              path: 'carName',
              component: About
            }
          ]
        }
      ]
    }
  ]
}
