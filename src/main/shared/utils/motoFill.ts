export const DEFAULT_MOTO_FILL_COLOR = '#142321'

export type MotoFillConfig = {
  backdropEnabled?: boolean
  ambientFillEnabled?: boolean
  ambientFillColor?: string
}

export function normalizeMotoFillColor(value?: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value ?? '') ? value! : DEFAULT_MOTO_FILL_COLOR
}

export function motoFillEnabled(cfg: MotoFillConfig): boolean {
  return cfg.backdropEnabled === true || cfg.ambientFillEnabled === true
}

export function motoFillHex(cfg: MotoFillConfig): string | undefined {
  return motoFillEnabled(cfg) ? normalizeMotoFillColor(cfg.ambientFillColor) : undefined
}
