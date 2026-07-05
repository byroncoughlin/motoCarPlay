import { Typography } from '@mui/material'
import type { Config } from '@shared/types'
import { useTranslation } from 'react-i18next'
import { SettingsNode } from '../../../../routes'
import { getValueByPath } from '../utils'
import { BtDeviceList } from './btDeviceList/BtDeviceList'
import { PosSensitiveList } from './posSensitiveList/PosSensitiveList'
import { SettingsFieldControl } from './SettingsFieldControl'
import { SettingsItemRow } from './settingsItemRow'
import { StackItem } from './stackItem'

type Props<T, K> = {
  node: SettingsNode<Config>
  value: T
  state: K
  onChange: (v: T) => void
  onClick?: () => void
  onItemNavigate?: (segment: string) => void
  savedLabel?: string
  onLabelChange?: (label: string) => void
}

export const SettingsFieldRow = <T, K>({
  node,
  value,
  state,
  onChange,
  onClick,
  onItemNavigate,
  savedLabel,
  onLabelChange
}: Props<T, K>) => {
  const { t } = useTranslation()
  const label = node.labelKey ? t(node.labelKey, node.label) : node.label

  if (node.type === 'posList') {
    return (
      <PosSensitiveList
        node={node}
        value={value}
        onChange={(v) => onChange(v as unknown as T)}
        onItemClick={onItemNavigate}
      />
    )
  }

  if (node.type === 'btDeviceList') {
    return <BtDeviceList />
  }

  if (onClick) {
    return (
      <StackItem
        withForwardIcon
        onClick={onClick}
        node={node}
        value={getValueByPath(state, node.path)}
        savedLabel={savedLabel}
        showValue={node.displayValue}
      >
        <Typography>{label}</Typography>
      </StackItem>
    )
  }

  // Checkbox rows: the ENTIRE row is the tap target (iOS Settings behavior),
  // not just the 62px switch — a gloved fingertip anywhere on the 60px row
  // toggles it. The switch itself stops propagation so it doesn't double-fire.
  if (node.type === 'checkbox') {
    const toggle =
      node.disabled === true
        ? undefined
        : () => onChange(!(value as unknown as boolean) as unknown as T)
    return (
      <StackItem onClick={toggle} node={node}>
        <Typography>{label}</Typography>
        <span
          role="presentation"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          style={{ display: 'inline-flex', flexShrink: 0 }}
        >
          <SettingsFieldControl node={node} value={value} onChange={onChange} />
        </span>
      </StackItem>
    )
  }

  return (
    <SettingsItemRow label={label}>
      <SettingsFieldControl
        node={node}
        value={value}
        onChange={onChange}
        savedLabel={savedLabel}
        onLabelChange={onLabelChange}
      />
    </SettingsItemRow>
  )
}
