import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// Linux windowed (GNOME/labwc): host the UI plus the GStreamer video plane in
// the nested wlroots compositor so they composite into one window, zero-copy :)
export function bootstrapCompositor(): boolean {
  if (process.platform !== 'linux') return false
  if (process.env.LIVI_COMPOSITOR === '1') return false
  if (process.env.LIVI_NO_COMPOSITOR === '1') return false

  // Only the AppImage has a stable self-path to re-launch
  const appImage = process.env.APPIMAGE
  if (!appImage) return false

  const launcher = join(process.resourcesPath, 'compositor', 'livi-compositor')
  if (!existsSync(launcher)) return false

  // The inner AppImage must re-mount fresh (drop AppRun's vars)
  const hostLd = process.env.LD_LIBRARY_PATH ?? ''
  const inner =
    `LIVI_COMPOSITOR=1 LD_LIBRARY_PATH='${hostLd}' ` + `'${appImage}' --ozone-platform=wayland`

  const env: NodeJS.ProcessEnv = { ...process.env, LIVI_UI_APP_ID: 'livi' }
  delete env.APPIMAGE
  delete env.APPDIR
  delete env.ARGV0
  delete env.OWD

  spawn(launcher, ['-s', inner], { detached: true, stdio: 'inherit', env }).unref()
  return true
}
