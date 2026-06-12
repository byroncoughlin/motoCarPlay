import type { Config } from '@shared/types'
import { generateRoutes } from '../../utils/generateRoutes'
import { SettingsNode } from '../types'
import { motoSettingsSchema } from './motoSchema'

export const settingsSchema: SettingsNode<Config> = motoSettingsSchema

export const settingsRoutes = generateRoutes(settingsSchema)
