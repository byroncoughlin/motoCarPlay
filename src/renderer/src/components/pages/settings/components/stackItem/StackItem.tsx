import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import Box from '@mui/material/Box'
import { styled } from '@mui/material/styles'
import { useLiviStore } from '@renderer/store/store'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SelectNode } from '../../../../../routes/types'
import { StackItemProps } from '../../type'
import { findOptionForValue, withGhostOption } from '../ghostOption'
import { getCachedOptions, resolveOptions } from '../selectOptionsCache'
import { SETTINGS_ROW_HEIGHT, settingsRowLabelSx } from '../settingsStyle'

// iOS Settings–style list row: fixed height (never reflows the list), label on
// the left, control/value/chevron on the right, hairline separator between
// rows within a group (drawn by the parent group; we only draw an inset
// bottom border which the last row hides).
const Row = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'interactive'
})<{ interactive?: boolean }>(({ theme, interactive }) => {
  const activeColor = theme.palette.primary.main

  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'clamp(8px, 2vw, 16px)',
    minHeight: SETTINGS_ROW_HEIGHT,
    paddingLeft: '16px',
    paddingRight: '12px',
    boxSizing: 'border-box',
    position: 'relative',
    cursor: interactive ? 'pointer' : 'default',
    outline: 'none',
    WebkitTapHighlightColor: 'transparent',
    userSelect: 'none',

    // Inset hairline separator (hidden on the last row by the group).
    '&:not(:last-of-type)::after': {
      content: '""',
      position: 'absolute',
      left: '16px',
      right: 0,
      bottom: 0,
      height: '1px',
      backgroundColor: 'rgba(255,255,255,0.09)'
    },
    'html[data-mui-color-scheme="light"] &:not(:last-of-type)::after': {
      backgroundColor: 'rgba(0,0,0,0.1)'
    },

    // Press feedback only for interactive rows (mouse + touch + keyboard).
    ...(interactive
      ? {
          'html[data-input="mouse"] &:hover': {
            backgroundColor: 'rgba(255,255,255,0.06)'
          },
          '&:active': { backgroundColor: 'rgba(255,255,255,0.1)' },
          '&:focus-visible': {
            backgroundColor: 'rgba(255,255,255,0.1)',
            boxShadow: `inset 3px 0 0 ${activeColor}`
          }
        }
      : {})
  }
})

export const StackItem = ({
  children,
  value,
  node,
  showValue,
  withForwardIcon,
  onClick,
  savedLabel
}: StackItemProps) => {
  const { t } = useTranslation()

  const viewValue = node?.valueTransform?.toView ? node?.valueTransform.toView(value) : value

  let displayValue = node?.valueTransform?.format
    ? node.valueTransform.format(viewValue)
    : `${viewValue}${node?.displayValueUnit ?? ''}`

  // gst-device-monitor follow mode bumps this on every device add/remove
  const audioDevicesRevision = useLiviStore((s) => s.audioDevicesRevision)
  const [dynamicOpts, setDynamicOpts] = useState(() =>
    node?.type === 'select' ? getCachedOptions(node as SelectNode) : undefined
  )
  useEffect(() => {
    if (node?.type !== 'select') return
    const sel = node as SelectNode
    if (!sel.loadOptions) return
    let alive = true
    void resolveOptions(sel, { force: true }).then((opts) => {
      if (alive) setDynamicOpts(opts)
    })
    return () => {
      alive = false
    }
  }, [node, audioDevicesRevision])

  if (node?.type === 'select') {
    const sel = node as SelectNode
    const cachedOrFresh = dynamicOpts ?? getCachedOptions(sel)
    const formatOffline = (name: string): string => t('settings.audioDeviceOffline', { name })
    const pickValue = value as string | number | undefined | null

    if (sel.loadOptions && cachedOrFresh === undefined) {
      // Pre-fetch: resolve from static options, else fall back to savedLabel
      const staticHit = sel.options.find((o) => o.value === pickValue)
      if (staticHit) {
        displayValue = staticHit.labelKey ? t(staticHit.labelKey, staticHit.label) : staticHit.label
      } else {
        displayValue = savedLabel ?? ''
      }
    } else {
      const pool = cachedOrFresh ?? sel.options
      const augmented = withGhostOption(pool, pickValue, savedLabel, formatOffline)
      const option = findOptionForValue(augmented, pickValue)
      if (option) {
        const rawLabel = option.labelKey ? t(option.labelKey, option.label) : option.label
        displayValue = option.offline ? formatOffline(rawLabel) : rawLabel
      } else {
        displayValue = ''
      }
    }
  }

  if (displayValue === 'null' || displayValue === 'undefined') {
    displayValue = '---'
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!onClick) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      e.stopPropagation()
      onClick()
    }
  }

  return (
    <Row
      interactive={Boolean(onClick)}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      tabIndex={onClick ? 0 : -1}
      role={onClick ? 'button' : undefined}
      sx={{
        // First child is the label (<p> or <Typography>); style it as the
        // iOS row label. Trailing control keeps its own styling.
        '& > p': { ...settingsRowLabelSx, flex: '1 1 auto', margin: 0 }
      }}
    >
      {children}
      {showValue && value != null && (
        <Box
          component="span"
          sx={{
            whiteSpace: 'nowrap',
            fontSize: '16px',
            color: 'text.secondary',
            maxWidth: '55%',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {displayValue}
        </Box>
      )}
      {withForwardIcon && (
        <ChevronRightRoundedIcon
          sx={{ color: 'text.secondary', opacity: 0.55, fontSize: 26, flexShrink: 0 }}
        />
      )}
    </Row>
  )
}
