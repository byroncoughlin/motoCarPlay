import type { Config } from '@shared/types'
import { IconUploader } from '../../components/pages/settings/pages/system/iconUploader/IconUploader'
import { SettingsNode } from '../types'

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => {
  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 === 0 ? 12 : h % 12
  return { label: `${display}:00 ${period}`, value: h }
})

export const appearanceSchema: SettingsNode<Config> = {
  type: 'route',
  route: 'appearance',
  label: 'Appearance',
  labelKey: 'settings.appearance',
  path: '',
  children: [
    {
      type: 'checkbox',
      label: 'Dark Mode',
      labelKey: 'settings.darkMode',
      path: 'darkMode'
    },
    {
      type: 'select',
      label: 'Phone Appearance',
      labelKey: 'settings.phoneAppearance',
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
          'Light / dark appearance for the connected phone (Android Auto / CarPlay). Scheduled follows the local clock — light during the day window, dark otherwise. Day or Night force the corresponding appearance whenever the phone is connected.',
        labelDescription: 'settings.phoneAppearanceDescription'
      }
    },
    {
      type: 'select',
      label: 'Day Starts (Scheduled)',
      labelKey: 'settings.appearanceDayStart',
      path: 'appearanceDayStartHour',
      displayValue: true,
      options: HOUR_OPTIONS
    },
    {
      type: 'select',
      label: 'Night Starts (Scheduled)',
      labelKey: 'settings.appearanceNightStart',
      path: 'appearanceNightStartHour',
      displayValue: true,
      options: HOUR_OPTIONS
    },
    {
      type: 'color',
      label: 'Primary Color Dark',
      labelKey: 'settings.primaryColorDark',
      path: 'primaryColorDark'
    },
    {
      type: 'color',
      label: 'Highlight Color Dark',
      labelKey: 'settings.highlightColorDark',
      path: 'highlightColorDark'
    },
    {
      type: 'color',
      label: 'Background Color Dark',
      labelKey: 'settings.backgroundColorDark',
      path: 'backgroundColorDark'
    },
    {
      type: 'color',
      label: 'Primary Color Light',
      labelKey: 'settings.primaryColorLight',
      path: 'primaryColorLight'
    },
    {
      type: 'color',
      label: 'Highlight Color Light',
      labelKey: 'settings.highlightColorLight',
      path: 'highlightColorLight'
    },
    {
      type: 'color',
      label: 'Background Color Light',
      labelKey: 'settings.backgroundColorLight',
      path: 'backgroundColorLight'
    },
    {
      type: 'route',
      label: 'UI Icon',
      labelKey: 'settings.uiIcon',
      route: 'ui-icon',
      path: '',
      children: [
        {
          type: 'custom',
          label: 'UI Icon',
          labelKey: 'settings.uiIcon',
          path: 'dongleIcon180',
          component: IconUploader
        }
      ]
    }
  ]
}
