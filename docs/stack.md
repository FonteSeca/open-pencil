# Technical Stack

## Core Technologies
- **Frontend**: Vue 3 + Vite
- **Rendering**: CanvasKit (Skia WASM)
- **Layout**: Yoga Layout (WASM)
- **Desktop Shell**: Tauri v2 (Rust)
- **Mobile Shell**: Capacitor (iPad support)
- **State Management**: Vue stores (ShallowReactive)
- **Multiplayer**: Trystero (WebRTC) + Yjs (CRDT)
- **Cloud Backend**: Supabase (Auth, Storage, Database)


## Platform Abstraction Layer (Planned)
To support multiple platforms (Web, Tauri, Capacitor), we are implementing a unified platform API in `src/platform/`:

### Interface
```typescript
interface PlatformAPI {
  saveFile(data: Uint8Array, filename: string): Promise<void>;
  openFile(options: OpenFileOptions): Promise<File | null>;
  getDeviceInfo(): Promise<DeviceInfo>;
  showToast(message: string): void;
}
```

### Capacitor Implementation (iPad)
- **Filesystem**: Uses `@capacitor/filesystem` for persistent storage and file access.
- **Preferences**: Uses `@capacitor/preferences` for local settings.
- **Device**: Uses `@capacitor/device` for platform-specific optimizations.

## Rendering Architecture

- **Skia Surface**: WebGL-based surface rendered by CanvasKit.
- **Scene Graph**: Flat map of nodes with parent/child references via GUIDs.
- **Optimizations**: Viewport culling, rAF-throttled resizing.
