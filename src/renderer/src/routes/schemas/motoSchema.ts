import type { Config } from '@shared/types'
import { BackgroundModeControl } from '../../components/pages/settings/components/BackgroundModeControl'
import { ClearDiagnosticsControl } from '../../components/pages/settings/components/ClearDiagnosticsControl'
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

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => {
  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 === 0 ? 12 : h % 12
  return { label: `${display}:00 ${period}`, value: h }
})

// The current LIVI / CarPlay system settings, now reached via the "Advanced"
// button at the bottom of the moto landing instead of a top-level tab.
const advancedSchema: SettingsNode<Config> = {
  type: 'route',
  route: 'advanced',
  label: 'Advanced',
  labelKey: 'settings.advanced',
  path: '',
  children: [
    {
      type: 'checkbox',
      label: 'Settings Color Mode',
      labelKey: 'settings.settingsColorMode',
      path: 'darkMode'
    },
    {
      type: 'route',
      label: 'Settings Menu Colors',
      labelKey: 'settings.appearanceColors',
      route: 'appearanceColors',
      path: '',
      children: [
        { type: 'color', label: 'Primary Color Dark', path: 'primaryColorDark' },
        { type: 'color', label: 'Highlight Color Dark', path: 'highlightColorDark' },
        { type: 'color', label: 'Background Color Dark', path: 'backgroundColorDark' },
        { type: 'color', label: 'Primary Color Light', path: 'primaryColorLight' },
        { type: 'color', label: 'Highlight Color Light', path: 'highlightColorLight' },
        { type: 'color', label: 'Background Color Light', path: 'backgroundColorLight' }
      ]
    },
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
}

export const motoSettingsSchema: SettingsNode<Config> = {
  type: 'route',
  route: 'new-settings',
  label: 'Settings',
  labelKey: 'settings.settingsTitle',
  path: 'settings',
  children: [
    // ── Background ──────────────────────────────────────────────────────────
    {
      type: 'custom',
      label: 'Background',
      section: 'Background',
      sectionKey: 'settings.sectionBackground',
      path: '',
      component: BackgroundModeControl
    },
    {
      type: 'checkbox',
      label: 'Round Corners',
      section: 'Background',
      sectionKey: 'settings.sectionBackground',
      path: 'roundedCornerMaskEnabled'
    },
    // ── Phone Appearance (light / dark) ──────────────────────────────────────
    {
      type: 'select',
      label: 'Phone Appearance',
      labelKey: 'settings.phoneAppearance',
      section: 'Phone Display',
      sectionKey: 'settings.sectionPhoneDisplay',
      path: 'appearanceMode',
      displayValue: true,
      options: [
        { label: 'Scheduled', labelKey: 'settings.phoneAppearanceScheduled', value: 'scheduled' },
        { label: 'Day', labelKey: 'settings.phoneAppearanceDay', value: 'day' },
        { label: 'Night', labelKey: 'settings.phoneAppearanceNight', value: 'night' }
      ],
      page: {
        title: 'Phone Appearance',
        labelTitle: 'settings.phoneAppearance',
        description:
          'Light / dark appearance for the connected phone. Scheduled follows the local clock — light during the day window, dark otherwise. Android Auto switches live. CarPlay only reads this when the phone connects, and some iPhones follow their own CarPlay Appearance setting instead — set that to Automatic and reconnect if it does not match.',
        labelDescription: 'settings.phoneAppearanceDescription'
      }
    },
    {
      type: 'select',
      label: 'Day Starts (Scheduled)',
      labelKey: 'settings.appearanceDayStart',
      section: 'Phone Display',
      sectionKey: 'settings.sectionPhoneDisplay',
      hiddenWhen: (s) => (s as Config)?.appearanceMode !== 'scheduled',
      path: 'appearanceDayStartHour',
      displayValue: true,
      options: HOUR_OPTIONS
    },
    {
      type: 'select',
      label: 'Night Starts (Scheduled)',
      labelKey: 'settings.appearanceNightStart',
      section: 'Phone Display',
      sectionKey: 'settings.sectionPhoneDisplay',
      hiddenWhen: (s) => (s as Config)?.appearanceMode !== 'scheduled',
      path: 'appearanceNightStartHour',
      displayValue: true,
      options: HOUR_OPTIONS
    },
    // ── Tilt / orientation ───────────────────────────────────────────────────
    {
      type: 'custom',
      label: 'Tilt Calibration',
      section: 'Orientation',
      sectionKey: 'settings.sectionOrientation',
      path: '',
      component: TiltCalibrationControl
    },
    {
      type: 'checkbox',
      label: 'Reverse Tilt',
      section: 'Orientation',
      sectionKey: 'settings.sectionOrientation',
      path: 'reverseTilt'
    },
    {
      type: 'checkbox',
      label: 'Reverse Front/Back',
      section: 'Orientation',
      sectionKey: 'settings.sectionOrientation',
      path: 'reversePitch'
    },
    // ── Diagnostics ──────────────────────────────────────────────────────────
    {
      type: 'custom',
      label: 'Graph History',
      section: 'Diagnostics',
      sectionKey: 'settings.sectionDiagnostics',
      path: '',
      component: ClearGraphHistoryControl
    },
    {
      type: 'checkbox',
      label: 'Diagnostic Mode',
      labelKey: 'settings.diagnosticMode',
      section: 'Diagnostics',
      sectionKey: 'settings.sectionDiagnostics',
      path: 'diagnosticMode',
      page: {
        title: 'Diagnostic Mode',
        labelTitle: 'settings.diagnosticMode',
        description:
          'When on, LIVI saves graph history, sensor diagnostics, and raw telemetry to disk (~/.config/LIVI/diagnostics/) for later analysis. The folder is size-capped and prunes the oldest data automatically. Leave off for normal riding — logging has a small performance cost.',
        labelDescription: 'settings.diagnosticModeDescription'
      }
    },
    {
      type: 'custom',
      label: 'Diagnostic Data',
      section: 'Diagnostics',
      sectionKey: 'settings.sectionDiagnostics',
      path: '',
      component: ClearDiagnosticsControl
    },
    // ── Advanced (LIVI / CarPlay system settings) ────────────────────────────
    advancedSchema
  ]
}
