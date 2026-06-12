import {
  DEFAULT_MOTO_FILL_COLOR,
  motoFillEnabled,
  motoFillHex,
  normalizeMotoFillColor
} from '../motoFill'

describe('moto fill helpers', () => {
  test('normalizes saved fill colors', () => {
    expect(normalizeMotoFillColor('#20364a')).toBe('#20364a')
    expect(normalizeMotoFillColor('#ABCDEF')).toBe('#ABCDEF')
    expect(normalizeMotoFillColor('20364a')).toBe(DEFAULT_MOTO_FILL_COLOR)
    expect(normalizeMotoFillColor('')).toBe(DEFAULT_MOTO_FILL_COLOR)
  })

  test('enables the static fill when either moto fill toggle is active', () => {
    expect(motoFillEnabled({ backdropEnabled: true, ambientFillEnabled: false })).toBe(true)
    expect(motoFillEnabled({ backdropEnabled: false, ambientFillEnabled: true })).toBe(true)
    expect(motoFillEnabled({ backdropEnabled: false, ambientFillEnabled: false })).toBe(false)
  })

  test('returns a static fill color only when enabled', () => {
    expect(motoFillHex({ backdropEnabled: true, ambientFillColor: '#142321' })).toBe('#142321')
    expect(motoFillHex({ ambientFillEnabled: true, ambientFillColor: '#2f473c' })).toBe('#2f473c')
    expect(motoFillHex({ ambientFillEnabled: true, ambientFillColor: 'nope' })).toBe(
      DEFAULT_MOTO_FILL_COLOR
    )
    expect(motoFillHex({ ambientFillColor: '#2f473c' })).toBeUndefined()
  })
})
