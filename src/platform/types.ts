export interface PlatformAPI {
  name: 'tauri' | 'capacitor' | 'web'
  isNative: boolean
  
  // UI
  showToast(message: string): Promise<void>
  
  // Filesystem
  saveFile(filename: string, data: Uint8Array | string, mimeType?: string): Promise<void>
  
  // Device
  getDeviceInfo(): Promise<{
    platform: string
    model: string
    osVersion: string
  }>
}

export interface PlatformOptions {
  // Add options if needed
}
