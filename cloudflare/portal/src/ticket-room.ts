import { DurableObject } from "cloudflare:workers";
import { advanceQueue, settleQueue } from "./queue";

const MAX_SOCKETS = 6;
const SOCKET_TTL_MS = 10 * 60 * 1000;

// One room per ticket. It only relays events to connected browsers; messages are
// validated, encrypted and stored by the Worker before they are broadcast.
export class TicketRoom extends DurableObject<Env> {
  private live() {
    const now = Date.now();
    return this.ctx.getWebSockets().filter((ws) => {
      const info = ws.deserializeAttachment() as { exp?: number } | null;
      if (info?.exp && info.exp > now) return true;
      try {
        ws.close(4000, "expired");
      } catch {
        /* already closed */
      }
      return false;
    });
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/broadcast" && request.method === "POST") {
      const text = await request.text();
      for (const ws of this.live()) {
        try {
          ws.send(text);
        } catch {
          /* the socket closed while sending */
        }
      }
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/arm" && request.method === "POST") {
      const { id, at } = (await request.json()) as { id: string; at: number };
      await this.ctx.storage.put("ticket", id);
      await this.ctx.storage.setAlarm(at);
      return new Response(null, { status: 204 });
    }
    if (
      url.pathname === "/connect" &&
      request.headers.get("upgrade")?.toLowerCase() === "websocket"
    ) {
      if (this.live().length >= MAX_SOCKETS)
        return new Response(null, { status: 429 });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ exp: Date.now() + SOCKET_TTL_MS });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return new Response(null, { status: 404 });
  }
  // Rotates the head ticket when its payment window ends, in real time.
  async alarm() {
    const id = await this.ctx.storage.get<string>("ticket");
    const result = await advanceQueue(this.env);
    await settleQueue(this.env, result, {
      force: true,
      local: id
        ? {
            id,
            send: (text) => {
              for (const ws of this.live()) {
                try {
                  ws.send(text);
                } catch {
                  /* closed while sending */
                }
              }
            },
            setAlarm: (at) => this.ctx.storage.setAlarm(at),
          }
        : undefined,
    });
  }
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    // Browsers only listen; chat messages are sent through the authenticated API.
    if (message === "ping") ws.send("pong");
  }
  webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code);
    } catch {
      /* already closed */
    }
  }
}
