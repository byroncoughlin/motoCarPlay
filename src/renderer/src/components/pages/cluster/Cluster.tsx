import MapOutlinedIcon from '@mui/icons-material/MapOutlined'
import { Box, Typography, useTheme } from '@mui/material'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useLiviStore, useStatusStore } from '../../../store/store'

type ClusterProps = { visible?: boolean }

type BoxInfo = { supportFeatures?: unknown }

function isBoxInfo(v: unknown): v is BoxInfo {
  return typeof v === 'object' && v !== null
}

function parseBoxInfo(raw: unknown): BoxInfo | null {
  if (isBoxInfo(raw)) return raw

  if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) return null
    try {
      const parsed: unknown = JSON.parse(s)
      return isBoxInfo(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  return null
}

export const Cluster: React.FC<ClusterProps> = ({ visible }) => {
  const theme = useTheme()
  const showCluster = visible === true

  const settings = useLiviStore((s) => s.settings)
  const boxInfoRaw = useLiviStore((s) => s.boxInfo)
  const isStreaming = useStatusStore((s) => s.isStreaming)
  const isAaActive = useStatusStore((s) => s.isAaActive)

  const [rendererError] = useState<string | null>(null)
  const [clusterStreamActive, setClusterStreamActive] = useState(false)

  const renderReady: boolean = true
  const rootRef = useRef<HTMLDivElement>(null)

  const supportsNaviScreen = useMemo(() => {
    // AA-native exposes a cluster sink (ch=19, display_type=CLUSTER) when any cluster display is active
    if (isAaActive) return true

    const box = parseBoxInfo(boxInfoRaw)
    if (!box) return false

    const features = box.supportFeatures

    if (Array.isArray(features)) {
      return features.some((f) => String(f).trim().toLowerCase() === 'naviscreen')
    }

    if (typeof features === 'string') {
      return features
        .split(/[,\s]+/g)
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean)
        .includes('naviscreen')
    }

    return false
  }, [boxInfoRaw, isAaActive])

  const wantCluster =
    settings?.cluster?.main === true ||
    settings?.cluster?.dash === true ||
    settings?.cluster?.aux === true

  useEffect(() => {
    if (!wantCluster) return
    if (!renderReady) return
    void window.projection.ipc.requestCluster(true).catch(() => {})
  }, [renderReady, wantCluster])

  const prevClusterVisibleRef = useRef(false)
  useEffect(() => {
    const wasVisible = prevClusterVisibleRef.current
    prevClusterVisibleRef.current = showCluster
    if (!showCluster || wasVisible) return
    if (!wantCluster || !renderReady) return
    void window.projection.ipc.requestCluster(true).catch(() => {})
  }, [showCluster, wantCluster, renderReady])

  useEffect(() => {
    const handler = (_evt: unknown, ...args: unknown[]) => {
      const msg = (args[0] ?? {}) as { type?: string }
      if (msg.type !== 'plugged') return
      if (!wantCluster) return
      if (!renderReady) return
      void window.projection.ipc.requestCluster(true).catch(() => {})
    }
    const unsubscribe = window.projection.ipc.onEvent(handler)
    return unsubscribe
  }, [renderReady, wantCluster])

  // Cluster frames negotiated -> the compositor renders the cluster plane
  useEffect(() => {
    const ipc = (window.projection?.ipc ?? {}) as {
      onClusterResolution?: (cb: (payload: unknown) => void) => void
    }
    if (typeof ipc.onClusterResolution !== 'function') return
    ipc.onClusterResolution((payload: unknown) => {
      const d = payload as { width?: number; height?: number } | undefined
      const w = typeof d?.width === 'number' ? d.width : 0
      const h = typeof d?.height === 'number' ? d.height : 0
      if (w > 0 && h > 0) setClusterStreamActive(true)
    })
  }, [])

  useEffect(() => {
    const handler = (_evt: unknown, ...args: unknown[]) => {
      const msg = (args[0] ?? {}) as { type?: string }
      if (msg.type !== 'unplugged' && msg.type !== 'failure') return
      setClusterStreamActive(false)
      void window.projection.ipc.requestCluster(false).catch(() => {})
    }
    const unsubscribe = window.projection.ipc.onEvent(handler)
    return unsubscribe
  }, [])

  return (
    <Box
      ref={rootRef}
      sx={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        display: 'flex',
        justifyContent: 'stretch',
        alignItems: 'stretch',
        backgroundColor: theme.palette.background.default,
        visibility: showCluster ? 'visible' : 'hidden',
        opacity: showCluster ? 1 : 0,
        pointerEvents: showCluster ? 'auto' : 'none',
        transition: 'opacity 220ms ease',
        zIndex: showCluster ? 5 : -1
      }}
    >
      {!clusterStreamActive && showCluster && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            textAlign: 'center',
            pointerEvents: 'none',
            zIndex: 6,
            backgroundColor: theme.palette.background.default
          }}
        >
          <MapOutlinedIcon sx={{ fontSize: 84, opacity: 0.55 }} />
        </Box>
      )}

      {isStreaming && !supportsNaviScreen && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            textAlign: 'center',
            pointerEvents: 'none'
          }}
        >
          <Box sx={{ display: 'grid', placeItems: 'center', gap: 1 }}>
            <MapOutlinedIcon sx={{ fontSize: 84, opacity: 0.55 }} />
            <Typography variant="body2" sx={{ opacity: 0.75 }}>
              Not supported by firmware
            </Typography>
          </Box>
        </Box>
      )}

      {rendererError && (
        <Box sx={{ position: 'absolute', top: 16, left: 16, right: 16 }}>
          <Typography variant="body2" color="error">
            {rendererError}
          </Typography>
        </Box>
      )}
    </Box>
  )
}
