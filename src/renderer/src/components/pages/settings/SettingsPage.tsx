import { Box, Button, Typography } from '@mui/material'
import type { SettingsNode } from '@renderer/routes/types'
import type { Config } from '@shared/types'
import { useLiviStore, useStatusStore } from '@store/store'
import type { Key } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { settingsSchema } from '../../../routes/schemas/schema'
import { SettingsLayout } from '../../layouts'
import { KeyBindingRow, StackItem } from './components'
import { SettingsFieldPage } from './components/SettingsFieldPage'
import { SettingsFieldRow } from './components/SettingsFieldRow'
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
        void confirmPendingAppRestartChange()
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

  return (
    <SettingsLayout title={title} showRestart={showRestart} onRestart={handleRestart}>
      {children.map((child: SettingsNode<Config>, index: Key | null | undefined) => {
        const _path = child.path as string

        if (child.type === 'route') {
          if (child.hidden) return null
          return (
            <StackItem
              key={index}
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
              key={child.label}
              state={settings}
              node={child}
              onChange={(v) => handleFieldChange(_path, v)}
              requestRestart={requestRestart}
            />
          )
        }

        if (child.type === 'keybinding') {
          return <KeyBindingRow key={`${_path}:${child.label}`} node={child} />
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
            key={_path}
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
      })}
      {restartDialog}
    </SettingsLayout>
  )
}
