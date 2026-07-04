import {
  MOTO_CENTER_SQUARE_SIZE,
  MOTO_DISPLAY_SIZE,
  MOTO_SQUARE_INSET_FRAC,
  isSquareContainedProjection
} from '../motoGeometry'

describe('motoGeometry', () => {
  test('square inset fraction matches the 800/586 centre square', () => {
    expect(MOTO_DISPLAY_SIZE).toBe(800)
    expect(MOTO_CENTER_SQUARE_SIZE).toBe(586)
    expect(MOTO_SQUARE_INSET_FRAC).toBeCloseTo(107 / 800, 6)
    // inset px at the 800 output resolves to exactly 107 on each edge
    expect(Math.round(MOTO_SQUARE_INSET_FRAC * MOTO_DISPLAY_SIZE)).toBe(107)
  })

  test('the full 800 stream is not square-contained', () => {
    expect(isSquareContainedProjection(800, 800)).toBe(false)
  })

  test('sub-display streams are square-contained', () => {
    expect(isSquareContainedProjection(586, 586)).toBe(true)
    expect(isSquareContainedProjection(480, 480)).toBe(true)
    expect(isSquareContainedProjection(320, 320)).toBe(true)
    expect(isSquareContainedProjection(300, 300)).toBe(true)
  })

  test('invalid sizes are not square-contained', () => {
    expect(isSquareContainedProjection(0, 0)).toBe(false)
    expect(isSquareContainedProjection(-1, 320)).toBe(false)
    expect(isSquareContainedProjection(320, 0)).toBe(false)
  })
})
