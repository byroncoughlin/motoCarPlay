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

// A projection stream smaller than the full display is "square-contained": the
// phone renders it edge-to-edge (bigger buttons) and LIVI scales/masks it into the
// centre square. The full-size stream (800) uses view-area insets instead and is
// placed 1:1, so it is not square-contained.
export function isSquareContainedProjection(width: number, height: number): boolean {
  return (
    width > 0 &&
    height > 0 &&
    (width < MOTO_DISPLAY_SIZE || height < MOTO_DISPLAY_SIZE)
  )
}
