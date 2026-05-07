import { Filesystem, Directory } from '@capacitor/filesystem'
import { Device } from '@capacitor/device'
import type { PlatformAPI } from './types'

export const capacitorPlatform: PlatformAPI = {
  name: 'capacitor',
  isNative: true,

  async showToast(message: string) {
    // We could use @capacitor/toast if we added it, but for now console
    console.log('Capacitor Toast:', message)
  },

  async saveFile(filename: string, data: Uint8Array | string) {
    // On iPad, we usually save to Documents or use a share sheet
    // For now, let's write to Documents directory
    const base64Data = typeof data === 'string' 
      ? btoa(data) 
      : btoa(String.fromCharCode(...data))

    await Filesystem.writeFile({
      path: filename,
      data: base64Data,
      directory: Directory.Documents
    })
  },

  async getDeviceInfo() {
    const info = await Device.getInfo()
    return {
      platform: info.platform,
      model: info.model,
      osVersion: info.osVersion
    }
  }
}
