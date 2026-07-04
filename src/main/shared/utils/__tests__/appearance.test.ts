import type { Config } from '@shared/types'
import { isDaytime, resolveNightMode } from '@shared/utils'

describe('isDaytime', () => {
  test('non-wrapping day window (6..18)', () => {
    expect(isDaytime(6, 6, 18)).toBe(true)
    expect(isDaytime(12, 6, 18)).toBe(true)
    expect(isDaytime(17, 6, 18)).toBe(true)
    expect(isDaytime(18, 6, 18)).toBe(false)
    expect(isDaytime(5, 6, 18)).toBe(false)
    expect(isDaytime(23, 6, 18)).toBe(false)
  })

  test('wrapping day window (18..6) — day spans midnight', () => {
    expect(isDaytime(20, 18, 6)).toBe(true)
    expect(isDaytime(0, 18, 6)).toBe(true)
    expect(isDaytime(5, 18, 6)).toBe(true)
    expect(isDaytime(6, 18, 6)).toBe(false)
    expect(isDaytime(12, 18, 6)).toBe(false)
  })

  test('degenerate equal bounds → always day', () => {
    expect(isDaytime(3, 8, 8)).toBe(true)
    expect(isDaytime(20, 8, 8)).toBe(true)
  })

  test('normalizes out-of-range / negative hours', () => {
    expect(isDaytime(30, 6, 18)).toBe(true) // 30 → 6
    expect(isDaytime(-1, 6, 18)).toBe(false) // -1 → 23
  })
})

describe('resolveNightMode', () => {
  test('forced day / night', () => {
    expect(resolveNightMode({ appearanceMode: 'day' } as Config)).toBe(false)
    expect(resolveNightMode({ appearanceMode: 'night' } as Config)).toBe(true)
  })

  test('undefined for unknown / missing mode', () => {
    expect(resolveNightMode(undefined)).toBeUndefined()
    expect(resolveNightMode({} as Config)).toBeUndefined()
    expect(resolveNightMode({ appearanceMode: 'weird' } as unknown as Config)).toBeUndefined()
  })

  test('scheduled derives from clock and configured hours', () => {
    const realGetHours = Date.prototype.getHours
    try {
      Date.prototype.getHours = () => 12
      expect(
        resolveNightMode({
          appearanceMode: 'scheduled',
          appearanceDayStartHour: 6,
          appearanceNightStartHour: 18
        } as Config)
      ).toBe(false) // noon → day → nightMode false

      Date.prototype.getHours = () => 23
      expect(
        resolveNightMode({
          appearanceMode: 'scheduled',
          appearanceDayStartHour: 6,
          appearanceNightStartHour: 18
        } as Config)
      ).toBe(true) // 11pm → night → nightMode true
    } finally {
      Date.prototype.getHours = realGetHours
    }
  })

  test('scheduled falls back to 6/18 default hours', () => {
    const realGetHours = Date.prototype.getHours
    try {
      Date.prototype.getHours = () => 3
      expect(resolveNightMode({ appearanceMode: 'scheduled' } as Config)).toBe(true)
    } finally {
      Date.prototype.getHours = realGetHours
    }
  })
})
