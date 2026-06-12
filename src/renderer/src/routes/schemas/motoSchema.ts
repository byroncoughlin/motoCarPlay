import type { Config } from '@shared/types'
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
      route: 'connection',
      label: 'Connection',
      path: '',
      children: [
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
