import { DurableObject } from "cloudflare:workers";

const ADMIN_PIN = "713422";

export class Rooms extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/rooms") {
      if (request.method === "GET") {
        const rooms = (await this.ctx.storage.get("rooms")) || {};
        return Response.json(rooms);
      }

      if (request.method === "POST") {
        const body = await request.json();

        if (body.pin !== ADMIN_PIN) {
          return Response.json(
            { error: "Invalid admin PIN" },
            { status: 403 }
          );
        }

        const rooms = (await this.ctx.storage.get("rooms")) || {};

        const id =
          body.id ||
          Math.random().toString(36).slice(2, 10);

        rooms[id] = {
          id,
          name: body.name || "VibeAI Room",
          characters: Array.isArray(body.characters)
            ? body.characters.slice(0, 9)
            : [],
          story: body.story || "",
          createdAt: Date.now()
        };

        await this.ctx.storage.put("rooms", rooms);

        return Response.json({
          ok: true,
          room: rooms[id]
        });
      }
    }

    if (url.pathname === "/room") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      const body = await request.json();
      const rooms = (await this.ctx.storage.get("rooms")) || {};

      if (!rooms[body.roomId]) {
        return Response.json(
          { error: "Room not found" },
          { status: 404 }
        );
      }

      return Response.json({
        ok: true,
        room: rooms[body.roomId]
      });
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("WebSocket required", {
          status: 426
        });
      }

      const roomId = url.searchParams.get("room");

      if (!roomId) {
        return new Response("Room ID required", {
          status: 400
        });
      }

      const rooms = (await this.ctx.storage.get("rooms")) || {};

      if (!rooms[roomId]) {
        return new Response("Room not found", {
          status: 404
        });
      }

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];

      this.ctx.acceptWebSocket(server);

      server.serializeAttachment({
        roomId,
        joinedAt: Date.now()
      });

      server.send(
        JSON.stringify({
          type: "connected",
          roomId,
          room: rooms[roomId]
        })
      );

      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }

    return new Response("VibeAI Room Server OK");
  }

  async webSocketMessage(ws, message) {
    let data;

    try {
      data =
        typeof message === "string"
          ? JSON.parse(message)
          : JSON.parse(new TextDecoder().decode(message));
    } catch {
      return;
    }

    const attachment = ws.deserializeAttachment() || {};
    const roomId = attachment.roomId;

    if (!roomId) return;

    const sockets = this.ctx.getWebSockets();

    for (const socket of sockets) {
      if (socket === ws) continue;

      const other = socket.deserializeAttachment() || {};

      if (other.roomId !== roomId) continue;

      try {
        socket.send(
          JSON.stringify({
            ...data,
            roomId
          })
        );
      } catch {}
    }
  }

  async webSocketClose(ws) {
    try {
      ws.close();
    } catch {}
  }

  async webSocketError(ws) {
    try {
      ws.close();
    } catch {}
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const id = env.ROOMS.idFromName("GLOBAL");
    const room = env.ROOMS.get(id);

    return room.fetch(request);
  }
};
