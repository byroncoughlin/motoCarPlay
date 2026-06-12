import { enforceRoundDashboardConfig } from '@main/config/roundDashboardConfig'
import { MicType } from '@shared/types/Config'

describe('enforceRoundDashboardConfig', () => {
  test('forces hidden round-dashboard settings back to their fixed values', () => {
    expect(
      enforceRoundDashboardConfig({
        darkMode: false,
        nightMode: false,
        disableAudioOutput: false,
        audioInputDevice: 'mic-1',
        audioInputDeviceLabel: 'USB Mic',
        micType: MicType.PhoneMic,
        cameraId: 'camera-1',
        cameraMirror: true,
        autoSwitchOnReverse: true,
        kiosk: { main: false, dash: false, aux: false },
        camera: { main: true, dash: true, aux: true },
        language: 'en'
      })
    ).toEqual({
      darkMode: true,
      nightMode: true,
      disableAudioOutput: true,
      audioInputDevice: '',
      audioInputDeviceLabel: '',
      micType: MicType.CarMic,
      cameraId: '',
      cameraMirror: false,
      autoSwitchOnReverse: false,
      kiosk: { main: true, dash: false, aux: false },
      camera: { main: false, dash: false, aux: false },
      language: 'en'
    })
  })

  test('auto-enables corner mask for legacy fill configs only when not explicitly saved', () => {
    expect(
      enforceRoundDashboardConfig(
        {
          ambientFillEnabled: true,
          roundedCornerMaskEnabled: false
        },
        {
          ambientFillEnabled: true
        }
      )
    ).toEqual({
      ambientFillEnabled: true,
      roundedCornerMaskEnabled: true
    })

    expect(
      enforceRoundDashboardConfig(
        {
          ambientFillEnabled: true,
          roundedCornerMaskEnabled: false
        },
        {
          ambientFillEnabled: true,
          roundedCornerMaskEnabled: false
        }
      )
    ).toEqual({
      ambientFillEnabled: true,
      roundedCornerMaskEnabled: false
    })
  })
})
