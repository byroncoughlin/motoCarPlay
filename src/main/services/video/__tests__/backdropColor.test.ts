import { backdropHex, motoBackdropHex, type BackdropColorConfig } from '../backdropColor'

function config(overrides: Partial<BackdropColorConfig> = {}): BackdropColorConfig {
  return {
    darkMode: true,
    backgroundColorDark: '',
    backgroundColorLight: '',
    backdropEnabled: false,
    ambientFillEnabled: false,
    ambientFillColor: '#142321',
    ...overrides
  }
}

describe('backdrop color resolution', () => {
  test('uses the configured dark/light theme color when moto fill toggles are off', () => {
    expect(backdropHex(true, '#010203', '#fefefe')).toBe('#010203')
    expect(backdropHex(false, '#010203', '#fefefe')).toBe('#fefefe')
    expect(motoBackdropHex(config({ backgroundColorDark: '#111111' }))).toBe('#111111')
  })

  test('falls back to stock theme backdrop colors when theme overrides are blank', () => {
    expect(motoBackdropHex(config({ darkMode: true }))).toBe('#000000')
    expect(motoBackdropHex(config({ darkMode: false }))).toBe('#d4d4d4')
  })

  test('uses the static moto fill color when backdrop is enabled', () => {
    expect(
      motoBackdropHex(
        config({
          backdropEnabled: true,
          backgroundColorDark: '#000000',
          ambientFillColor: '#2f473c'
        })
      )
    ).toBe('#2f473c')
  })

  test('uses the static moto fill color when background fill is enabled', () => {
    expect(
      motoBackdropHex(
        config({
          ambientFillEnabled: true,
          backgroundColorDark: '#000000',
          ambientFillColor: '#20364a'
        })
      )
    ).toBe('#20364a')
  })

  test('uses the moto default when fill is enabled with a malformed color', () => {
    expect(
      motoBackdropHex(
        config({
          ambientFillEnabled: true,
          ambientFillColor: 'not-a-color'
        })
      )
    ).toBe('#142321')
  })
})
