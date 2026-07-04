import { useTheme } from '@mui/material'
import type { CSSProperties } from 'react'
import { MOTO_CENTER_CORNER_RADIUS_PX } from './motoLayout'

export type ViewAreaInsets = { top: number; bottom: number; left: number; right: number }

const CORNER_RADIUS_PX = MOTO_CENTER_CORNER_RADIUS_PX
const BAR_Z_INDEX = 5
const CORNER_Z_INDEX = 12
// The video plane and the DOM mask meet exactly at the view-area boundary. On
// the device compositor that seam leaves a 1px dark column uncovered on the
// right edge (sub-pixel rounding between the waylandsink plane and the mask).
// Bleed each mask bar 1px inward over the boundary so no seam shows; 1px of a
// ~586px view area is imperceptible on content.
const BAR_BLEED_PX = 1

// Passepartout between the LIVI UI and the video plane: paints the configured view-area margins
// with the theme background, leaving the view area itself transparent so the video shows through.
// Platform-independent, the video always sits below the React UI (mac NSView, Linux compositor plane).
export function ViewAreaMask({
  insets,
  displayWidth,
  displayHeight,
  visible,
  color,
  cornerMask,
  barsVisible = true
}: {
  insets: ViewAreaInsets
  displayWidth: number
  displayHeight: number
  visible: boolean
  color?: string
  cornerMask?: boolean
  barsVisible?: boolean
}) {
  const theme = useTheme()
  if (
    !visible ||
    typeof displayWidth !== 'number' ||
    typeof displayHeight !== 'number' ||
    !Number.isFinite(displayWidth) ||
    !Number.isFinite(displayHeight) ||
    displayWidth <= 0 ||
    displayHeight <= 0
  ) {
    return null
  }

  const pct = (v: number, total: number): string => `${(Math.max(0, v) / total) * 100}%`
  const maskColor = color ?? theme.palette.background.default
  const bar: CSSProperties = {
    position: 'absolute',
    backgroundColor: maskColor,
    pointerEvents: 'none',
    zIndex: BAR_Z_INDEX
  }
  const centerTop = pct(insets.top, displayHeight)
  const centerBottom = pct(insets.bottom, displayHeight)
  const centerLeft = pct(insets.left, displayWidth)
  const centerRight = pct(insets.right, displayWidth)
  // Bar sizes bled 1px past the view-area edge to hide the compositor seam.
  const barTop = `calc(${centerTop} + ${BAR_BLEED_PX}px)`
  const barBottom = `calc(${centerBottom} + ${BAR_BLEED_PX}px)`
  const barLeft = `calc(${centerLeft} + ${BAR_BLEED_PX}px)`
  const barRight = `calc(${centerRight} + ${BAR_BLEED_PX}px)`
  const radius = Math.max(0, Math.min(CORNER_RADIUS_PX, displayWidth / 8, displayHeight / 8))
  const radiusX = pct(radius, displayWidth)
  const radiusY = pct(radius, displayHeight)
  const cornerBase: CSSProperties = {
    position: 'absolute',
    width: radiusX,
    height: radiusY,
    pointerEvents: 'none',
    zIndex: CORNER_Z_INDEX
  }
  const roundedStop = '70%'
  const hardStop = '71%'
  const cornerGradient = (at: string): string =>
    `radial-gradient(circle at ${at}, transparent 0 ${roundedStop}, ${maskColor} ${hardStop})`

  return (
    <>
      {barsVisible && (
        <>
          <div
            data-testid="view-area-mask-top"
            style={{ ...bar, top: 0, left: 0, right: 0, height: barTop }}
          />
          <div
            data-testid="view-area-mask-bottom"
            style={{ ...bar, bottom: 0, left: 0, right: 0, height: barBottom }}
          />
          <div
            data-testid="view-area-mask-left"
            style={{ ...bar, top: 0, bottom: 0, left: 0, width: barLeft }}
          />
          <div
            data-testid="view-area-mask-right"
            style={{ ...bar, top: 0, bottom: 0, right: 0, width: barRight }}
          />
        </>
      )}
      {cornerMask && radius > 0 && (
        <>
          <div
            data-testid="view-area-corner-mask-top-left"
            style={{
              ...cornerBase,
              top: centerTop,
              left: centerLeft,
              background: cornerGradient('100% 100%')
            }}
          />
          <div
            data-testid="view-area-corner-mask-top-right"
            style={{
              ...cornerBase,
              top: centerTop,
              right: centerRight,
              background: cornerGradient('0 100%')
            }}
          />
          <div
            data-testid="view-area-corner-mask-bottom-left"
            style={{
              ...cornerBase,
              bottom: centerBottom,
              left: centerLeft,
              background: cornerGradient('100% 0')
            }}
          />
          <div
            data-testid="view-area-corner-mask-bottom-right"
            style={{
              ...cornerBase,
              bottom: centerBottom,
              right: centerRight,
              background: cornerGradient('0 0')
            }}
          />
        </>
      )}
    </>
  )
}
