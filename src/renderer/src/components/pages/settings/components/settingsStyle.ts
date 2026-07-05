// Shared tokens + helpers for the Apple-style (iOS Settings) grouped list.
//
// Design goals baked in here:
//  - Grouped, rounded, translucent cards instead of separate black boxes.
//  - Rows have a FIXED height so the list never jumps as values/controls
//    change. Anything that would normally grow the row (confirm buttons,
//    swatch pickers) must occupy a stable, pre-sized slot.
//  - Every interactive control is a LARGE fingertip target on the 3.4" round
//    display (min 48px tall).

// Fixed row height — never let content reflow the list.
export const SETTINGS_ROW_HEIGHT = 60

// Section card + separator styling, theme-aware via rgba over the current bg.
export const settingsGroupSx = {
  borderRadius: '16px',
  overflow: 'hidden',
  border: '1px solid',
  borderColor: 'rgba(255,255,255,0.08)',
  backgroundColor: 'rgba(255,255,255,0.06)',
  'html[data-mui-color-scheme="light"] &': {
    borderColor: 'rgba(0,0,0,0.08)',
    backgroundColor: 'rgba(0,0,0,0.035)'
  }
} as const

export const settingsSectionHeaderSx = {
  px: '6px',
  pb: '6px',
  fontSize: '13px',
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'text.secondary',
  opacity: 0.75
} as const

// A large, pill-shaped trailing action button used inside rows (SET LEVEL,
// CLEAR, etc). 52px keeps a real gloved tap target inside the 60px row.
export const settingsActionButtonSx = {
  minWidth: 104,
  height: 52,
  px: 2,
  borderRadius: '14px',
  fontSize: '16px',
  fontWeight: 700,
  lineHeight: 1,
  whiteSpace: 'nowrap',
  textTransform: 'none'
} as const

// The row label typography.
export const settingsRowLabelSx = {
  fontSize: '17px',
  fontWeight: 500,
  lineHeight: 1.15,
  color: 'text.primary',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis'
} as const

// The gray trailing value (iOS detail text).
export const settingsRowValueSx = {
  fontSize: '16px',
  color: 'text.secondary',
  whiteSpace: 'nowrap'
} as const
