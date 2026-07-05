// Simulated ride for the site demo: a ~100s loop — warm-up, pull away, a set
// of sweeping corners, a fast straight, and a slowdown — shaped so every
// gauge on the dash has something honest to show.

export type RideSample = Record<string, unknown>

const TWO_PI = Math.PI * 2

function smoothstep(a: number, b: number, t: number): number {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)))
  return x * x * (3 - 2 * x)
}

export function rideSample(tMs: number): RideSample {
  const t = (tMs / 1000) % 100 // loop the ride every 100s
  const tAbs = tMs / 1000

  // ── speed profile (mph) ────────────────────────────────────────────
  // 0-8s stopped · 8-20s accelerate to 48 · 20-55s twisties 34-52 ·
  // 55-75s straight up to 72 · 75-92s cruise · 92-100s brake to ~10
  let mph = 0
  if (t >= 8) mph = 48 * smoothstep(8, 20, t)
  if (t >= 20 && t < 55) mph = 43 + 9 * Math.sin(((t - 20) / 35) * TWO_PI * 2.5)
  if (t >= 55) mph = 52 + 20 * smoothstep(55, 75, t)
  if (t >= 92) mph = 72 - 62 * smoothstep(92, 100, t)
  mph = Math.max(0, mph)

  // ── lean: corner sweeps during the twisty section, gentle elsewhere ─
  let lean = 0
  if (t >= 20 && t < 55) {
    lean = 26 * Math.sin(((t - 20) / 35) * TWO_PI * 2.5)
  } else if (mph > 15) {
    lean = 4 * Math.sin(tAbs / 3.1)
  }
  const pitch = mph > 1 ? 2 + 2.5 * Math.sin(tAbs / 5.7) : 0

  // heading integrates loosely with the corners; deterministic per loop time
  const heading = (315 + 40 * Math.sin((t / 100) * TWO_PI) + t * 1.4) % 360

  // ── G forces: lateral from lean, longitudinal from the speed ramps ──
  const gLat = Math.tan((lean * Math.PI) / 180) * 0.55
  let gLong = 0
  if (t >= 8 && t < 20) gLong = 0.28
  if (t >= 55 && t < 75) gLong = 0.22
  if (t >= 92) gLong = -0.42
  const gForceX = gLat + 0.015 * Math.sin(tAbs * 2.3)
  const gForceY = gLong + 0.012 * Math.sin(tAbs * 1.7)

  // ── cylinder heads: warm from cold toward ~135°C, breathing with load ─
  const warm = smoothstep(0, 75, t)
  const load = mph / 72
  const chtBase = 55 + 82 * warm + 12 * load
  const chtLeftC = chtBase + 3 * Math.sin(tAbs / 4.2)
  const chtRightC = chtBase + 6 + 3 * Math.sin(tAbs / 3.6 + 1)

  // ── environment ────────────────────────────────────────────────────
  const ambientC = 21.5 + 1.2 * Math.sin(tAbs / 23)
  const altitudeM = 372 + 26 * Math.sin((t / 100) * TWO_PI + 1.2) // ~1150-1300 ft
  const piCpuC = 58 + 9 * warm + 3 * Math.sin(tAbs / 7)

  // ── GPS sky: a plausible constellation, slowly wheeling ─────────────
  const sats = Array.from({ length: 11 }, (_, i) => {
    const az = (i * 33 + tAbs * 0.7) % 360
    const el = 12 + ((i * 17) % 62)
    const snr = 22 + ((i * 7) % 21) + 4 * Math.sin(tAbs / 9 + i)
    return { prn: 2 + i * 3, az, el, snr: Math.round(snr), used: i < 9 }
  })

  return {
    speedKph: mph / 0.621371,
    gpsFix: tAbs > 2,
    gpsSatellites: tAbs > 2 ? 9 : 3,
    gps: { heading, alt: altitudeM },
    gpsSky: {
      fixType: tAbs > 2 ? 3 : 0,
      satsUsed: tAbs > 2 ? 9 : 3,
      satsInView: 11,
      hdop: 1.3,
      pdop: 2.1,
      sats,
      ttff: 13,
      acquiring: null
    },
    ambientC,
    chtLeftC,
    chtRightC,
    piCpuC,
    leanDeg: lean,
    pitchDeg: pitch,
    gForceX,
    gForceY,
    imuRecalibrating: false
  }
}
