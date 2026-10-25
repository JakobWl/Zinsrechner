export type DesktopListener = (event: unknown, ...args: any[]) => void;
export interface DesktopBridge {
  invoke(channel: string, ...args: any[]): Promise<any>;
  send(channel: string, ...args: any[]): void;
  on(channel: string, listener: DesktopListener): void;
  off(channel: string, listener: DesktopListener): void;
}
