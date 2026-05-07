import type { PlatformAPI } from './types'

export const tauriPlatform: PlatformAPI = {
  name: 'tauri',
  isNative: true,

  async showToast(message: string) {
    // In Tauri, we could use a custom toast or the dialog plugin
    console.log('Tauri Toast:', message)
  },

  async saveFile(filename: string, data: Uint8Array | string) {
    const { writeFile } = await import('@tauri-apps/plugin-fs')
    const { save } = await import('@tauri-apps/plugin-dialog')
    
    const path = await save({
      defaultPath: filename,
      filters: [{ name: 'OpenPencil', extensions: ['fig', 'pencil'] }]
    })

    if (path) {
      await writeFile(path, data instanceof Uint8Array ? data : new TextEncoder().encode(data))
    }
  },

  async getDeviceInfo() {
    const { arch, platform, type, version } = await import('@tauri-apps/api/os')
    return {
      platform: await platform(),
      model: `${await type()} (${await arch()})`,
      osVersion: await version()
    }
  }
}
