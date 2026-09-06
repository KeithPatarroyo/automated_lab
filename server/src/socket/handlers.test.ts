import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Server } from "socket.io";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@lab/shared";
import { registerSocketHandlers } from "./handlers.js";
import { chatLog, players, pushChatMessage, removePlayer } from "../game/state.js";
import { mapMeta, TILE_WIDTH, TILE_HEIGHT } from "../data/mapMeta.js";

// Deterministic regardless of whatever's actually in server/.env (a real GEMINI_API_KEY
// is configured there for local dev, which would otherwise make this test hit the real
// API) - keeps the real GeminiClientError class so `err instanceof GeminiClientError`
// in handlers.ts still matches. askFast backs both the computer-terminal chat and
// npc_chat_message, so mocking it here covers whichever path a test actually exercises.
vi.mock("../ai/geminiClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ai/geminiClient.js")>();
  return {
    ...actual,
    askFast: vi.fn(async () => {
      throw new actual.GeminiClientError("GEMINI_API_KEY is not configured on the server");
    }),
  };
});

type ClientIO = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

let httpServer: ReturnType<typeof createServer>;
let io: Server<ClientToServerEvents, ServerToClientEvents>;
let baseUrl: string;

beforeAll(async () => {
  httpServer = createServer();
  io = new Server(httpServer);
  io.on("connection", (socket) => registerSocketHandlers(io, socket));
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as AddressInfo).port;
  baseUrl = `http://localhost:${port}`;
});

afterAll(() => {
  io.close();
  httpServer.close();
});

function connectClient(): Promise<ClientIO> {
  return new Promise((resolve) => {
    const socket: ClientIO = ioc(baseUrl, { transports: ["websocket"], forceNew: true });
    socket.on("connect", () => resolve(socket));
  });
}

const activeClients: ClientIO[] = [];

afterEach(() => {
  for (const c of activeClients.splice(0)) c.disconnect();
  for (const id of Array.from(players.keys())) removePlayer(id);
  chatLog.length = 0;
});

describe("join", () => {
  it("assigns a playerId and a spawn from the map's spawn list", async () => {
    const client = await connectClient();
    activeClients.push(client);

    const ack = await new Promise<any>((resolve) => {
      client.once("join_ack", resolve);
      client.emit("join", { username: "Alice" });
    });

    expect(ack.playerId).toBeTruthy();
    expect(ack.players.find((p: any) => p.id === ack.playerId)).toBeTruthy();
    expect(ack.mapMeta.npcs.length).toBeGreaterThan(0);
  });
});

describe("chat_message", () => {
  it("broadcasts to every connected client", async () => {
    const a = await connectClient();
    const b = await connectClient();
    activeClients.push(a, b);

    await new Promise<void>((resolve) => {
      a.once("join_ack", () => resolve());
      a.emit("join", { username: "Alice" });
    });
    await new Promise<void>((resolve) => {
      b.once("join_ack", () => resolve());
      b.emit("join", { username: "Bob" });
    });

    const [receivedByA, receivedByB] = await Promise.all([
      new Promise<any>((resolve) => a.once("chat_message", resolve)),
      new Promise<any>((resolve) => b.once("chat_message", resolve)),
      Promise.resolve(a.emit("chat_message", { text: "hello everyone" })),
    ]);

    expect(receivedByA.text).toBe("hello everyone");
    expect(receivedByB.text).toBe("hello everyone");
    expect(receivedByA.username).toBe("Alice");
  });
});

describe("npc_interact", () => {
  it("returns the npc's lines when the player is in range", async () => {
    const client = await connectClient();
    activeClients.push(client);

    const ack = await new Promise<any>((resolve) => {
      client.once("join_ack", resolve);
      client.emit("join", { username: "Alice" });
    });

    const npc = mapMeta.npcs.find((n) => n.npcId === "workshop_tech")!;
    const player = players.get(ack.playerId)!;
    player.x = npc.x * TILE_WIDTH;
    player.y = npc.y * TILE_HEIGHT;

    const dialogue = await new Promise<any>((resolve) => {
      client.once("npc_dialogue", resolve);
      client.emit("npc_interact", { npcId: "workshop_tech" });
    });

    expect(dialogue.npcId).toBe("workshop_tech");
    expect(dialogue.lines.length).toBeGreaterThan(0);
  });

  it("does nothing for an unknown npcId", async () => {
    const client = await connectClient();
    activeClients.push(client);
    const ack = await new Promise<any>((resolve) => {
      client.once("join_ack", resolve);
      client.emit("join", { username: "Alice" });
    });
    const player = players.get(ack.playerId)!;
    player.x = 0;
    player.y = 0;

    let received = false;
    client.once("npc_dialogue", () => {
      received = true;
    });
    client.emit("npc_interact", { npcId: "does_not_exist" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received).toBe(false);
  });
});

describe("computer terminal", () => {
  it("opens a session near a computer and surfaces an error when no API key is configured", async () => {
    const client = await connectClient();
    activeClients.push(client);
    const ack = await new Promise<any>((resolve) => {
      client.once("join_ack", resolve);
      client.emit("join", { username: "Alice" });
    });

    const computer = mapMeta.computers[0];
    const player = players.get(ack.playerId)!;
    player.x = computer.x * TILE_WIDTH;
    player.y = computer.y * TILE_HEIGHT;

    const opened = await new Promise<any>((resolve) => {
      client.once("computer_opened", resolve);
      client.emit("computer_open", { computerId: computer.computerId });
    });
    expect(opened.sessionId).toBeTruthy();

    const error = await new Promise<any>((resolve) => {
      client.once("computer_error", resolve);
      client.emit("computer_message", { sessionId: opened.sessionId, text: "hello?" });
    });
    expect(error.sessionId).toBe(opened.sessionId);
    expect(error.message).toMatch(/GEMINI_API_KEY/);
  });
});

describe("chat log cap", () => {
  it("keeps only the most recent CHAT_LOG_LIMIT messages", () => {
    for (let i = 0; i < 250; i++) {
      pushChatMessage({ id: String(i), playerId: "x", username: "x", text: String(i), ts: i });
    }
    expect(chatLog.length).toBe(200);
    expect(chatLog[chatLog.length - 1].text).toBe("249");
  });
});
