import type { PlatformAPI } from './types'

export const webPlatform: PlatformAPI = {
  name: 'web',
  isNative: false,

  async showToast(message: string) {
    alert(message)
  },

  async saveFile(filename: string, data: Uint8Array | string, mimeType = 'application/octet-stream') {
    const blob = new Blob([data], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  },

  async getDeviceInfo() {
    return {
      platform: 'web',
      model: navigator.userAgent,
      osVersion: 'unknown'
    }
  }
}
