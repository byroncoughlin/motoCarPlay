import type { Config } from '@shared/types'

/**
 * For 'scheduled' appearance: is the given local hour in the day/light window?
 * dayStart/nightStart are hours 0-23. The day window is [dayStart, nightStart)
 * computed modulo 24, so it also handles a window that wraps midnight.
 */
export function isDaytime(hour: number, dayStartHour: number, nightStartHour: number): boolean {
  const h = ((hour % 24) + 24) % 24
  const d = ((dayStartHour % 24) + 24) % 24
  const n = ((nightStartHour % 24) + 24) % 24
  if (d === n) return true // degenerate: treat as always day
  if (d < n) return h >= d && h < n // e.g. 6..18 → day
  return h >= d || h < n // day window wraps midnight (e.g. 18..6)
}

/**
 * Resolve the phone night-mode boolean from `appearanceMode`:
 *   - 'night' → true, 'day' → false (forced)
 *   - 'scheduled' → derived from the local clock and the configured hours
 *   - anything else / undefined → undefined (leave unchanged)
 *
 * This is the single source of truth for day/night so the telemetry store, the
 * AA NightModeData seed, and the CarPlay dongle handshake never disagree.
 */
export function resolveNightMode(config: Config | undefined): boolean | undefined {
  const mode = config?.appearanceMode
  if (mode === 'night') return true
  if (mode === 'day') return false
  if (mode === 'scheduled') {
    const dayStart = config?.appearanceDayStartHour ?? 6
    const nightStart = config?.appearanceNightStartHour ?? 18
    return !isDaytime(new Date().getHours(), dayStart, nightStart)
  }
  return undefined
}
