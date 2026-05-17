export {}

declare global {
  interface Window {
    projection: {
      ipc: {
        sendCommand: (cmd: string) => void
      }
      usb: {
        listenForEvents: (callback: (...args: any[]) => void) => () => void
      }
    }
  }
}
