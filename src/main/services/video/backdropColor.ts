import type { Config } from '@shared/types'

const DEFAULT_MOTO_FILL_COLOR = '#142321'

export type BackdropColorConfig = Pick<
  Config,
  | 'darkMode'
  | 'backgroundColorDark'
  | 'backgroundColorLight'
  | 'backdropEnabled'
  | 'ambientFillEnabled'
  | 'ambientFillColor'
>

export function backdropHex(darkMode: boolean, dark?: string, light?: string): string {
  return (darkMode ? dark : light) || (darkMode ? '#000000' : '#d4d4d4')
}

function normalizeMotoFillColor(value?: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value ?? '') ? value! : DEFAULT_MOTO_FILL_COLOR
}

export function motoBackdropHex(cfg: BackdropColorConfig): string {
  if (cfg.backdropEnabled === true || cfg.ambientFillEnabled === true) {
    return normalizeMotoFillColor(cfg.ambientFillColor)
  }

  return backdropHex(cfg.darkMode, cfg.backgroundColorDark, cfg.backgroundColorLight)
}
