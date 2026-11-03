import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { join } from "node:path";
import { USER_DATA_DIR } from "./config.js";

export const HELPER_SOCKET_PATH = join(USER_DATA_DIR, "helper.sock");

export interface HelperMessage {
  type: string;
  [key: string]: unknown;
}

export function encodeMessage(message: HelperMessage): string {
  return `${JSON.stringify(message)}\n`;
}

export class LineDecoder {
  private buffer = "";

  push(chunk: string): HelperMessage[] {
    this.buffer += chunk;
    const messages: HelperMessage[] = [];
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) {
        try {
          const parsed = JSON.parse(line);
          if (parsed && typeof parsed.type === "string") messages.push(parsed);
        } catch {
          // Ignore malformed lines from a mismatched helper version.
        }
      }
      newline = this.buffer.indexOf("\n");
    }
    return messages;
  }
}

/**
 * Connects to the macOS Background Helper when it is running. Every caller
 * must tolerate a disconnected client and fall back to the JSON signal files.
 */
export class HelperIpcClient extends EventEmitter {
  private socket: Socket | null = null;
  private connected = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly role: string,
    private readonly socketPath = HELPER_SOCKET_PATH,
    private readonly reconnectMs = 2_000,
  ) {
    super();
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.destroy();
    this.socket = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  send(message: HelperMessage): boolean {
    if (!this.connected || !this.socket) return false;
    return this.socket.write(encodeMessage(message));
  }

  waitFor(
    predicate: (message: HelperMessage) => boolean,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<HelperMessage | null> {
    return new Promise((resolve) => {
      const finish = (value: HelperMessage | null) => {
        clearTimeout(timer);
        this.off("message", onMessage);
        this.off("disconnected", onDisconnect);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      };
      const onMessage = (message: HelperMessage) => {
        if (predicate(message)) finish(message);
      };
      const onDisconnect = () => finish(null);
      const onAbort = () => finish(null);
      const timer = setTimeout(() => finish(null), timeoutMs);
      this.on("message", onMessage);
      this.on("disconnected", onDisconnect);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private connect(): void {
    if (this.stopped) return;
    if (!existsSync(this.socketPath)) {
      this.scheduleReconnect();
      return;
    }
    const socket = createConnection(this.socketPath);
    const decoder = new LineDecoder();
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      this.socket = socket;
      this.connected = true;
      socket.write(
        encodeMessage({
          type: "hello",
          role: this.role,
          pid: process.pid,
          cwd: process.cwd(),
        }),
      );
      this.emit("connected");
    });
    socket.on("data", (chunk: string) => {
      for (const message of decoder.push(chunk)) this.emit("message", message);
    });
    socket.on("error", () => {
      // "close" follows and schedules the reconnect.
    });
    socket.on("close", () => {
      const wasConnected = this.connected;
      this.connected = false;
      if (this.socket === socket) this.socket = null;
      if (wasConnected) this.emit("disconnected");
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectMs);
    this.reconnectTimer.unref();
  }
}
