// Physical geometry of the 800×800 round display (shared by the renderer overlay
// and the main-process projection pipeline so the video plane, DOM mask, and touch
// mapping all agree on where the visible centre square is).
export const MOTO_DISPLAY_SIZE = 800
export const MOTO_CENTER_SQUARE_SIZE = 586

// Fraction of the output inset on each edge to reach the centre square:
// (800 − 586) / 2 / 800 = 0.13375. Used to contain a small CarPlay stream to the
// square instead of letting it fill the whole panel.
export const MOTO_SQUARE_INSET_FRAC =
  (MOTO_DISPLAY_SIZE - MOTO_CENTER_SQUARE_SIZE) / 2 / MOTO_DISPLAY_SIZE

// A projection stream smaller than the full 800×800 display is "square-contained":
// the phone renders it edge-to-edge (bigger buttons) and the compositor scales/masks
// it into the 586 centre square. All shipping CarPlay presets (586/480/320/300) are
// smaller than 800, so they are all contained; an exact-800 stream would be placed
// 1:1 and is not contained.
export function isSquareContainedProjection(width: number, height: number): boolean {
  return (
    width > 0 &&
    height > 0 &&
    (width < MOTO_DISPLAY_SIZE || height < MOTO_DISPLAY_SIZE)
  )
}
