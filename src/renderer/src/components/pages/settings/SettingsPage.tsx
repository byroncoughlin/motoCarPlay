import { Box, Button, Typography } from '@mui/material'
import type { SettingsNode } from '@renderer/routes/types'
import type { Config } from '@shared/types'
import { useLiviStore, useStatusStore } from '@store/store'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { ROUTES } from '../../../constants'
import { settingsSchema } from '../../../routes/schemas/schema'
import { SettingsLayout } from '../../layouts'
import { KeyBindingRow, StackItem } from './components'
import { SettingsFieldPage } from './components/SettingsFieldPage'
import { SettingsFieldRow } from './components/SettingsFieldRow'
import { settingsGroupSx, settingsSectionHeaderSx } from './components/settingsStyle'
import { useSmartSettingsFromSchema } from './hooks/useSmartSettingsFromSchema'
import { getNodeByPath, getValueByPath } from './utils'

function BackdropRestartDialog({
  kind,
  onCancel,
  onConfirm
}: {
  kind: 'enable' | 'disable' | 'mode'
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Box
      role="dialog"
      aria-modal="true"
      aria-label="Restart LIVI for backdrop change"
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 5000,
        display: 'grid',
        placeItems: 'center',
        p: '24px',
        background: 'rgba(0,0,0,0.9)'
      }}
    >
      <Box
        sx={{
          width: 'min(390px, 100%)',
          borderRadius: '8px',
          border: '1px solid rgba(255,255,255,0.14)',
          background: '#101316',
          p: '24px',
          textAlign: 'center',
          boxShadow: '0 18px 50px rgba(0,0,0,0.55)'
        }}
      >
        <Typography sx={{ fontSize: 28, fontWeight: 900, lineHeight: 1.05 }}>
          Restart LIVI?
        </Typography>
        <Typography sx={{ mt: 1, color: 'rgba(255,255,255,0.68)', fontSize: 15, lineHeight: 1.25 }}>
          {kind === 'enable'
            ? 'Backdrop needs a clean restart before it can attach to live CarPlay video.'
            : kind === 'mode'
              ? 'Changing Backdrop Style needs a clean restart to swap the native video path.'
              : 'Turning Backdrop off needs a clean restart to remove the live backdrop path.'}
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', mt: '24px' }}>
          <Button
            variant="outlined"
            onClick={onCancel}
            sx={{ minHeight: 54, borderRadius: '8px', fontWeight: 900 }}
          >
            Cancel
          </Button>
          <Button
            variant="outlined"
            onClick={onConfirm}
            sx={{
              minHeight: 54,
              borderRadius: '8px',
              fontWeight: 900,
              color: '#ffca28',
              borderColor: 'rgba(255,202,40,0.5)'
            }}
          >
            Save & Restart
          </Button>
        </Box>
      </Box>
    </Box>
  )
}

/** One iOS-style grouped section: optional header + a rounded card of rows. */
function SettingsGroup({ header, children }: { header?: string; children: ReactNode }) {
  return (
    <Box>
      {header ? <Typography sx={settingsSectionHeaderSx}>{header}</Typography> : null}
      <Box sx={settingsGroupSx}>{children}</Box>
    </Box>
  )
}

export function SettingsPage() {
  const navigate = useNavigate()
  const { '*': splat } = useParams()
  const { t } = useTranslation()

  const isDongleConnected = useStatusStore((s) => s.isDongleConnected || s.isAaActive)

  const path = splat ? splat.split('/') : []
  const node = getNodeByPath(settingsSchema, path)

  const settings = useLiviStore((s) => s.settings) as Config

  const {
    state,
    handleFieldChange,
    needsRestart,
    restart,
    requestRestart,
    pendingAppRestartChange,
    cancelPendingAppRestartChange,
    confirmPendingAppRestartChange
  } = useSmartSettingsFromSchema(settingsSchema, settings)

  const btDirty = useLiviStore((s) => s.bluetoothPairedDirty)
  const applyBtList = useLiviStore((s) => s.applyBluetoothPairedList)

  const wirelessAaEnabled = Boolean(settings?.wirelessAaEnabled)
  const restartAvailable = isDongleConnected || wirelessAaEnabled

  const handleRestart = async () => {
    if (!restartAvailable) return

    if (needsRestart) {
      await restart()
      return
    }

    if (btDirty && typeof applyBtList === 'function') {
      await applyBtList()
    }
  }

  if (!node) return null

  const title = node.labelKey ? t(node.labelKey) : node.label
  const showRestart = restartAvailable && (Boolean(needsRestart) || Boolean(btDirty))
  const restartDialog = pendingAppRestartChange ? (
    <BackdropRestartDialog
      kind={pendingAppRestartChange.kind}
      onCancel={cancelPendingAppRestartChange}
      onConfirm={() => {
        const restartPromise = confirmPendingAppRestartChange()
        navigate(ROUTES.HOME, { replace: true })
        void restartPromise
      }}
    />
  ) : null

  if ('path' in node && node.page) {
    const labelPath = node.type === 'select' ? node.labelPath : undefined
    const savedLabel = labelPath
      ? (getValueByPath(state, labelPath) as string | undefined)
      : undefined
    const onLabelChange = labelPath
      ? (label: string) => handleFieldChange(labelPath, label)
      : undefined

    return (
      <SettingsLayout title={title} showRestart={showRestart} onRestart={handleRestart}>
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start'
          }}
        >
          <SettingsFieldPage
            node={node}
            value={getValueByPath(state, node.path)}
            onChange={(v) => handleFieldChange(node.path, v)}
            savedLabel={savedLabel}
            onLabelChange={onLabelChange}
          />
          {restartDialog}
        </Box>
      </SettingsLayout>
    )
  }

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  const children = 'children' in node ? (node.children ?? []) : []

  const renderChild = (child: SettingsNode<Config>): ReactNode => {
    const _path = child.path as string

    if (child.type === 'route') {
      if (child.hidden) return null
      return (
        <StackItem
          key={`route:${child.route}`}
          withForwardIcon
          node={child}
          onClick={() => navigate(child.route)}
        >
          <Typography>{child.labelKey ? t(child.labelKey) : child.label}</Typography>
        </StackItem>
      )
    }

    if (child.type === 'custom') {
      return (
        <child.component
          key={`custom:${child.label}`}
          state={settings}
          node={child}
          onChange={(v) => handleFieldChange(_path, v)}
          requestRestart={requestRestart}
        />
      )
    }

    if (child.type === 'keybinding') {
      return <KeyBindingRow key={`kb:${_path}:${child.label}`} node={child} />
    }

    const childLabelPath = child.type === 'select' ? child.labelPath : undefined
    const childSavedLabel = childLabelPath
      ? (getValueByPath(state, childLabelPath) as string | undefined)
      : undefined
    const childOnLabelChange = childLabelPath
      ? (label: string) => handleFieldChange(childLabelPath, label)
      : undefined

    return (
      <SettingsFieldRow
        key={`field:${_path}`}
        node={child}
        state={state}
        value={getValueByPath(state, _path)}
        onChange={(v) => handleFieldChange(_path, v)}
        onClick={child.page ? () => navigate(_path) : undefined}
        onItemNavigate={(segment) => navigate(segment)}
        savedLabel={childSavedLabel}
        onLabelChange={childOnLabelChange}
      />
    )
  }

  // Group consecutive landing children that share the same `section` into one
  // iOS-style grouped card. Children with no section fall into an unheaded
  // group so nothing is orphaned. Order is preserved exactly (no jumping).
  const groups: Array<{ key: string; header?: string; nodes: SettingsNode<Config>[] }> = []
  for (const child of children as SettingsNode<Config>[]) {
    const sectionKey = child.sectionKey
    const header = child.section
    const last = groups[groups.length - 1]
    const groupId = sectionKey ?? header ?? '__ungrouped__'
    if (last && last.key === groupId) {
      last.nodes.push(child)
    } else {
      groups.push({
        key: groupId,
        header: header ? t(sectionKey ?? header, header) : undefined,
        nodes: [child]
      })
    }
  }

  return (
    <SettingsLayout title={title} showRestart={showRestart} onRestart={handleRestart}>
      {groups.map((group, gi) => (
        <SettingsGroup key={`${group.key}:${gi}`} header={group.header}>
          {group.nodes.map((child) => renderChild(child))}
        </SettingsGroup>
      ))}
      {restartDialog}
    </SettingsLayout>
  )
}
