import type { Config } from '@shared/types'
import { motoFillHex } from '@shared/utils'

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

export function motoBackdropHex(cfg: BackdropColorConfig): string {
  const fill = motoFillHex(cfg)
  if (fill) return fill

  return backdropHex(cfg.darkMode, cfg.backgroundColorDark, cfg.backgroundColorLight)
}
