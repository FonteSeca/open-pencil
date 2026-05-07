import { IS_TAURI, IS_CAPACITOR } from '@open-pencil/core/constants'
import { tauriPlatform } from './tauri'
import { capacitorPlatform } from './capacitor'
import { webPlatform } from './web'
import type { PlatformAPI } from './types'

export function getPlatform(): PlatformAPI {
  if (IS_TAURI) return tauriPlatform
  if (IS_CAPACITOR) return capacitorPlatform
  return webPlatform
}

export const platform = getPlatform()
export type { PlatformAPI } from './types'
