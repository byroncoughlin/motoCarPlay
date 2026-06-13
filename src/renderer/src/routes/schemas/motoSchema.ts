import type { Config } from '@shared/types'
import { ClearGraphHistoryControl } from '../../components/pages/settings/components/ClearGraphHistoryControl'
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
import { USBDongle } from '../../components/pages/settings/pages/system/usbDongle/USBDongle'
import { SettingsNode } from '../types'

export const motoSettingsSchema: SettingsNode<Config> = {
  type: 'route',
  route: 'new-settings',
  label: 'Settings',
  labelKey: 'settings.settingsTitle',
  path: 'settings',
  children: [
    {
      type: 'route',
      route: 'system',
      label: 'System',
      labelKey: 'settings.system',
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
        },
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
          label: 'USB Dongle Info',
          route: 'usbDongle',
          path: '',
          children: [
            {
              type: 'custom',
              label: 'USB Dongle Info',
              path: 'carName',
              component: USBDongle
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
          type: 'select',
          label: 'Backdrop Style',
          path: 'backdropMode',
          displayValue: true,
          options: [
            { label: 'Average Color', value: 'color' },
            { label: 'Blur Glow', value: 'blur' }
          ],
          page: {
            title: 'Backdrop Style',
            description: 'Choose how the optional CarPlay backdrop is rendered.'
          }
        },
        {
          type: 'checkbox',
          label: 'Ambient Fill',
          path: 'ambientFillEnabled'
        },
        {
          type: 'color',
          label: 'Fill Color',
          path: 'ambientFillColor',
          displayValue: true
        },
        {
          type: 'checkbox',
          label: 'Round Corners',
          path: 'roundedCornerMaskEnabled'
        },
        {
          type: 'custom',
          label: 'Tilt Calibration',
          path: '',
          component: TiltCalibrationControl
        },
        {
          type: 'custom',
          label: 'Graph History',
          path: '',
          component: ClearGraphHistoryControl
        }
      ]
    }
  ]
}
