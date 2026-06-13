import { useLiviStore, useStatusStore } from '@store/store'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { requiresRestartParams } from '../constants'
import { getValueByPath, setValueByPath } from '../utils'

type OverrideConfig = {
  transform?: (value: unknown, prev: unknown) => unknown
  validate?: (value: unknown) => boolean
}

type Overrides = Record<string, OverrideConfig>

type PendingAppRestartChange<T> = {
  path: string
  nextBackdropEnabled: boolean
  kind: 'enable' | 'disable' | 'mode'
  nextState: T
  nextSettings: T
}

function isRestartRelevantPath(path?: string) {
  if (!path) return true
  return !(path === 'bindings' || path.startsWith('bindings.'))
}

function applyMotoLinkedSettings(next: Record<string, unknown>, path: string, value: unknown): void {
  if (path === 'backdropEnabled') {
    if (value === true) {
      next.ambientFillEnabled = false
      next.roundedCornerMaskEnabled = true
    } else if (value === false) {
      next.roundedCornerMaskEnabled = false
    }
  } else if (path === 'ambientFillEnabled') {
    if (value === true) {
      next.backdropEnabled = false
      next.roundedCornerMaskEnabled = true
    } else if (value === false) {
      next.roundedCornerMaskEnabled = false
    }
  }
}

function normalizeBackdropMode(value: unknown): 'color' | 'blur' {
  return value === 'blur' ? 'blur' : 'color'
}

export function useSmartSettings<T extends Record<string, unknown>>(
  initial: T,
  settings: T,
  options?: { overrides?: Overrides }
) {
  const overrides = options?.overrides ?? {}
  const [state, setState] = useState<T>(() => ({ ...initial }))
  const [restartRequested, setRestartRequested] = useState(false)
  const [pendingAppRestartChange, setPendingAppRestartChange] =
    useState<PendingAppRestartChange<T> | null>(null)

  const saveSettings = useLiviStore((s) => s.saveSettings)
  const restartBaseline = useLiviStore((s) => s.restartBaseline)
  const markRestartBaseline = useLiviStore((s) => s.markRestartBaseline)
  const isDongleConnected = useStatusStore((s) => s.isDongleConnected || s.isAaActive)
  const isAaActive = useStatusStore((s) => s.isAaActive)
  const wirelessAaEnabled = useLiviStore((s) => Boolean(s.settings?.wirelessAaEnabled))

  useEffect(() => {
    setState({ ...initial })
  }, [initial])

  const isDirty = useMemo(
    () =>
      Object.keys(state).some((path) => {
        return getValueByPath(settings, path) !== state[path]
      }),
    [state, settings]
  )

  const needsRestartFromConfig = useMemo(() => {
    const cfg = (settings ?? {}) as Record<string, unknown>
    const baseline = (restartBaseline ?? settings ?? {}) as Record<string, unknown>

    for (const key of requiresRestartParams) {
      if (!isRestartRelevantPath(key)) continue
      if (JSON.stringify(cfg[key]) !== JSON.stringify(baseline[key])) return true
    }
    return false
  }, [settings, restartBaseline])

  const needsRestart = useMemo(() => {
    return Boolean(needsRestartFromConfig || restartRequested)
  }, [needsRestartFromConfig, restartRequested])

  const requestRestart = useCallback((path?: string) => {
    if (!isRestartRelevantPath(path)) return
    setRestartRequested(true)
  }, [])

  const buildSettingsChange = useCallback(
    (baseState: T, path: string, rawValue: unknown) => {
      const prevValue = baseState[path]
      const override = overrides[path]

      const nextValue = override?.transform?.(rawValue, prevValue) ?? rawValue
      if (override?.validate && !override.validate(nextValue)) return null

      const nextState = { ...baseState, [path]: nextValue }
      applyMotoLinkedSettings(nextState, path, nextValue)

      const nextSettings = structuredClone((settings ?? {}) as T)
      Object.entries(nextState).forEach(([p, v]) => {
        setValueByPath(nextSettings, p, v)
      })

      return { nextState, nextSettings }
    },
    [overrides, settings]
  )

  const backdropEnabled = Boolean((settings as Record<string, unknown> | undefined)?.backdropEnabled)
  const backdropMode = normalizeBackdropMode(
    (settings as Record<string, unknown> | undefined)?.backdropMode
  )

  const handleFieldChange = (path: string, rawValue: unknown) => {
    const change = buildSettingsChange(state, path, rawValue)
    if (!change) return

    const nextBackdropEnabled = Boolean(
      (change.nextSettings as Record<string, unknown>).backdropEnabled
    )
    const nextBackdropMode = normalizeBackdropMode(
      (change.nextSettings as Record<string, unknown>).backdropMode
    )
    if (nextBackdropEnabled !== backdropEnabled) {
      setPendingAppRestartChange({
        path,
        nextBackdropEnabled,
        kind: nextBackdropEnabled ? 'enable' : 'disable',
        nextState: change.nextState,
        nextSettings: change.nextSettings
      })
      return
    }

    if (nextBackdropEnabled && nextBackdropMode !== backdropMode) {
      setPendingAppRestartChange({
        path,
        nextBackdropEnabled,
        kind: 'mode',
        nextState: change.nextState,
        nextSettings: change.nextSettings
      })
      return
    }

    setState(change.nextState)
    void saveSettings(change.nextSettings)
  }

  const cancelPendingAppRestartChange = useCallback(() => {
    setPendingAppRestartChange(null)
  }, [])

  const confirmPendingAppRestartChange = useCallback(async () => {
    const pending = pendingAppRestartChange
    if (!pending) return false

    setPendingAppRestartChange(null)
    setState(pending.nextState)
    await saveSettings(pending.nextSettings)

    try {
      await window.app?.restartApp?.()
    } catch (e) {
      console.warn('[settings] app restart after backdrop change failed:', e)
      return false
    }

    return true
  }, [pendingAppRestartChange, saveSettings])

  const resetState = () => {
    setPendingAppRestartChange(null)
    setState(initial)
  }

  const restart = async () => {
    if (!needsRestart) return false

    if (wirelessAaEnabled || isAaActive) {
      await window.projection.ipc.restart()
    } else {
      if (!isDongleConnected) return false
      await window.projection.usb.forceReset()
    }

    markRestartBaseline()
    setRestartRequested(false)

    return true
  }

  return {
    state,
    isDirty,
    needsRestart,
    isDongleConnected,
    handleFieldChange,
    resetState,
    restart,
    requestRestart,
    pendingAppRestartChange,
    cancelPendingAppRestartChange,
    confirmPendingAppRestartChange
  }
}
