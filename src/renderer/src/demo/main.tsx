// Site demo entry: the REAL dashboard overlay (same component the bike
// runs), fed by a simulated ride, over a static CarPlay screenshot. The
// parent page drives it over postMessage:
//   { channel:'motoDemo', action:'openMetric', key:'leanAngle' }
//   { channel:'motoDemo', action:'closeMetric' }
//   { channel:'motoDemo', action:'mode', mode:'extend'|'solid'|'blur' }
import './shim'
import '../assets/fonts/inter.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import {
  MOTO_CLOSE_METRIC_EVENT,
  MOTO_OPEN_METRIC_EVENT
} from '../components/pages/projection/motoGraphEvents'
import { ProjectionSensorOverlay } from '../components/pages/projection/ProjectionSensorOverlay'
import { useLiviStore } from '../store/store'
import { rideSample } from './ride'
import { emitTelemetry } from './shim'

// The overlay reads MotoSettings out of the app store; seed just those.
useLiviStore.setState({
  settings: {
    leanOffset: 0,
    pitchOffset: 0,
    reverseTilt: false,
    reversePitch: false,
    diagnosticMode: false,
    chtReadoutInBar: true,
    leanRulerEnabled: false,
    altitudeOffsetFt: 0
  } as never
})

type BandMode = 'extend' | 'solid' | 'blur'

// Same geometry as the device: CarPlay square is 73.25% of the display,
// inset 13.375% on each side.
const SQUARE_INSET = '13.375%'
const SOLID_FILL = '#142321'
const MAP_SRC = './carplay-map.png'

// Composed exactly like the real modes: a full-bleed backdrop layer (live
// wallpaper in extend, solid fill, or blurred frame sample) with the sharp
// CarPlay square on top; the overlay's transparent bands reveal it.
function Backdrop({ mode }: { mode: BandMode }) {
  if (mode === 'extend') {
    return (
      <img
        src={MAP_SRC}
        alt="CarPlay navigation (static screenshot)"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover'
        }}
      />
    )
  }
  return (
    <>
      {mode === 'blur' ? (
        <img
          src={MAP_SRC}
          alt=""
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: 'blur(30px) brightness(0.85) saturate(1.2)',
            transform: 'scale(1.15)'
          }}
        />
      ) : (
        <div style={{ position: 'absolute', inset: 0, background: SOLID_FILL }} />
      )}
      <img
        src={MAP_SRC}
        alt="CarPlay navigation (static screenshot)"
        style={{
          position: 'absolute',
          top: SQUARE_INSET,
          left: SQUARE_INSET,
          width: '73.25%',
          height: '73.25%',
          objectFit: 'cover'
        }}
      />
    </>
  )
}

function DemoApp() {
  const [mode, setMode] = React.useState<BandMode>('blur')

  React.useEffect(() => {
    const start = Date.now()
    emitTelemetry(rideSample(0))
    const id = window.setInterval(() => emitTelemetry(rideSample(Date.now() - start)), 250)
    return () => window.clearInterval(id)
  }, [])

  React.useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as
        | { channel?: string; action?: string; key?: string; mode?: BandMode }
        | undefined
      if (!d || d.channel !== 'motoDemo') return
      if (d.action === 'openMetric' && d.key) {
        window.dispatchEvent(new CustomEvent(MOTO_OPEN_METRIC_EVENT, { detail: d.key }))
      } else if (d.action === 'closeMetric') {
        window.dispatchEvent(new CustomEvent(MOTO_CLOSE_METRIC_EVENT))
      } else if (d.action === 'mode' && d.mode) {
        setMode(d.mode)
      }
    }
    window.addEventListener('message', onMsg)
    window.parent?.postMessage({ channel: 'motoDemo', event: 'ready' }, '*')
    return () => window.removeEventListener('message', onMsg)
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#000',
        display: 'grid',
        placeItems: 'center'
      }}
    >
      <div
        className="moto-overlay"
        style={{
          position: 'relative',
          width: 'min(100vw, 100vh)',
          aspectRatio: '1 / 1',
          overflow: 'hidden',
          background: '#000'
        }}
      >
        <Backdrop mode={mode} />
        <ProjectionSensorOverlay />
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <MemoryRouter>
    <DemoApp />
  </MemoryRouter>
)
