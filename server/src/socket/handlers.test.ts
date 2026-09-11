import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Server } from "socket.io";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@lab/shared";
import { registerSocketHandlers } from "./handlers.js";
import { addPlayer, MAX_CONNECTED_HUMANS, players, removePlayer } from "../game/state.js";
import { mapMeta, TILE_WIDTH, TILE_HEIGHT } from "../data/mapMeta.js";
import { releaseSession } from "../accounts/humanAccounts.js";
import { db } from "../db/singleton.js";
import { askFast } from "../ai/geminiClient.js";

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
  // Bypasses the real (async) socket disconnect flow for cleanup, same as it already
  // did for players - also release any claimed account session directly so a test that
  // logged in as Keith/Anna can't leave the session claimed for the next test, which
  // wouldn't be guaranteed by client.disconnect() above given the server processes that
  // event asynchronously.
  for (const id of Array.from(players.keys())) {
    releaseSession(id);
    removePlayer(id);
  }
});

function login(client: ClientIO, username: string, password: string): Promise<any> {
  return new Promise((resolve, reject) => {
    client.once("join_ack", resolve);
    client.once("login_error", reject);
    client.emit("login", { username, password });
  });
}

// chat_message is broadcast to every connected client, so a plain `.once()` on a
// socket that isn't the sender can race an unrelated, still-in-flight broadcast from
// someone else - filter by the expected text instead of taking whatever arrives first.
function waitForChatMessage(client: ClientIO, text: string): Promise<any> {
  return new Promise((resolve) => {
    client.on("chat_message", function handler(msg: any) {
      if (msg.text !== text) return;
      client.off("chat_message", handler);
      resolve(msg);
    });
  });
}

describe("join", () => {
  it("assigns a playerId and a spawn from the map's spawn list", async () => {
    const client = await connectClient();
    activeClients.push(client);

    const ack = await new Promise<any>((resolve) => {
      client.once("join_ack", resolve);
      client.emit("join", { username: "Alice", gender: "male" });
    });

    expect(ack.playerId).toBeTruthy();
    expect(ack.players.find((p: any) => p.id === ack.playerId)).toBeTruthy();
    expect(ack.mapMeta.npcs.length).toBeGreaterThan(0);
  });

  it("echoes back the chosen gender", async () => {
    const client = await connectClient();
    activeClients.push(client);

    const ack = await new Promise<any>((resolve) => {
      client.once("join_ack", resolve);
      client.emit("join", { username: "Alice", gender: "female" });
    });

    expect(ack.players.find((p: any) => p.id === ack.playerId).gender).toBe("female");
  });

  it("defaults to male for an invalid gender value", async () => {
    const client = await connectClient();
    activeClients.push(client);

    const ack = await new Promise<any>((resolve) => {
      client.once("join_ack", resolve);
      client.emit("join", { username: "Alice", gender: "not-a-gender" as any });
    });

    expect(ack.players.find((p: any) => p.id === ack.playerId).gender).toBe("male");
  });
});

describe("capacity limit", () => {
  function fillToCapacity(): void {
    for (let i = 0; i < MAX_CONNECTED_HUMANS; i++) {
      addPlayer(`synthetic-${i}`, `Filler${i}`, 0, 0, "male");
    }
  }

  it("refuses a Visitor join once MAX_CONNECTED_HUMANS are already connected", async () => {
    fillToCapacity();
    const client = await connectClient();
    activeClients.push(client);

    const error = await new Promise<any>((resolve) => {
      client.once("join_error", resolve);
      client.emit("join", { username: "OneTooMany", gender: "male" });
    });
    expect(error.message).toMatch(/full/i);
    expect(players.size).toBe(MAX_CONNECTED_HUMANS);
  });

  it("refuses a login once MAX_CONNECTED_HUMANS are already connected", async () => {
    fillToCapacity();
    const client = await connectClient();
    activeClients.push(client);

    const error = await new Promise<any>((resolve) => {
      client.once("login_error", resolve);
      client.emit("login", { username: "Keith", password: "test-keith-pw" });
    });
    expect(error.message).toMatch(/full/i);
    expect(players.size).toBe(MAX_CONNECTED_HUMANS);
  });
});

describe("chat_message", () => {
  it("broadcasts to every connected client", async () => {
    const a = await connectClient();
    const b = await connectClient();
    activeClients.push(a, b);

    await new Promise<void>((resolve) => {
      a.once("join_ack", () => resolve());
      a.emit("join", { username: "Alice", gender: "male" });
    });
    await new Promise<void>((resolve) => {
      b.once("join_ack", () => resolve());
      b.emit("join", { username: "Bob", gender: "female" });
    });

    const [receivedByA, receivedByB] = await Promise.all([
      new Promise<any>((resolve) => a.once("chat_message", resolve)),
      new Promise<any>((resolve) => b.once("chat_message", resolve)),
      Promise.resolve(a.emit("chat_message", { text: "hello everyone" })),
    ]);

    expect(receivedByA.text).toBe("hello everyone");
    expect(receivedByB.text).toBe("hello everyone");
    // Alice is an anonymous Visitor here, not one of the two persisted accounts, so
    // her chat is labeled - see the new "login" describe block below for Keith/Anna.
    expect(receivedByA.username).toBe("Alice (visitor)");
  });
});

describe("npc_interact", () => {
  it("returns the npc's lines when the player is in range", async () => {
    const client = await connectClient();
    activeClients.push(client);

    const ack = await new Promise<any>((resolve) => {
      client.once("join_ack", resolve);
      client.emit("join", { username: "Alice", gender: "male" });
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
      client.emit("join", { username: "Alice", gender: "male" });
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
      client.emit("join", { username: "Alice", gender: "male" });
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


describe("login", () => {
  it("succeeds with the right credentials and returns the account's name/gender", async () => {
    const client = await connectClient();
    activeClients.push(client);

    const ack = await login(client, "Keith", "test-keith-pw");
    const me = ack.players.find((p: any) => p.id === ack.playerId);
    expect(me.username).toBe("Keith");
    expect(me.gender).toBe("male");
  });

  it("is case-insensitive on username", async () => {
    const client = await connectClient();
    activeClients.push(client);

    const ack = await login(client, "keith", "test-keith-pw");
    expect(ack.players.find((p: any) => p.id === ack.playerId).username).toBe("Keith");
  });

  it("rejects a wrong password and adds no player", async () => {
    const client = await connectClient();
    activeClients.push(client);

    const error = await new Promise<any>((resolve) => {
      client.once("login_error", resolve);
      client.emit("login", { username: "Keith", password: "wrong" });
    });
    expect(error.message).toMatch(/invalid/i);
    expect(players.size).toBe(0);
  });

  it("rejects a second concurrent login for the same account, leaving the first untouched", async () => {
    const a = await connectClient();
    const b = await connectClient();
    activeClients.push(a, b);

    await login(a, "Anna", "test-anna-pw");
    expect(players.size).toBe(1);

    const error = await new Promise<any>((resolve) => {
      b.once("login_error", resolve);
      b.emit("login", { username: "Anna", password: "test-anna-pw" });
    });
    expect(error.message).toMatch(/already logged in/i);
    expect(players.size).toBe(1);
  });

  it("resumes at the previously saved position after a disconnect and relogin", async () => {
    const first = await connectClient();
    const ack = await login(first, "Keith", "test-keith-pw");
    const player = players.get(ack.playerId)!;
    player.x = 321;
    player.y = 654;
    player.dir = "left";

    // Real disconnect (not the afterEach bypass) so the handler's saveHumanSnapshot
    // actually runs - server-side processing is async, so poll briefly for the row.
    first.disconnect();
    for (let i = 0; i < 20 && !db.loadHumanSnapshot("keith"); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(db.loadHumanSnapshot("keith")).toMatchObject({ x: 321, y: 654, dir: "left" });

    const second = await connectClient();
    activeClients.push(second);
    const ack2 = await login(second, "Keith", "test-keith-pw");
    const me2 = ack2.players.find((p: any) => p.id === ack2.playerId);
    expect(me2.x).toBe(321);
    expect(me2.y).toBe(654);
    expect(me2.dir).toBe("left");
  });

  it("refuses a Visitor join with a reserved username, any case", async () => {
    const client = await connectClient();
    activeClients.push(client);

    const error = await new Promise<any>((resolve) => {
      client.once("join_error", resolve);
      client.emit("join", { username: "KEITH", gender: "male" });
    });
    expect(error.message).toMatch(/reserved/i);
    expect(players.size).toBe(0);
  });
});

describe("persistence scoped to logged-in accounts", () => {
  it("persists public chat from both a logged-in account and a Visitor, labeling the Visitor's", async () => {
    const acct = await connectClient();
    const visitor = await connectClient();
    activeClients.push(acct, visitor);

    await login(acct, "Keith", "test-keith-pw");
    await new Promise<void>((resolve) => {
      visitor.once("join_ack", () => resolve());
      visitor.emit("join", { username: "Bob", gender: "male" });
    });

    const acctMsgPromise = waitForChatMessage(acct, "hello from keith");
    acct.emit("chat_message", { text: "hello from keith" });
    const acctMsg = await acctMsgPromise;
    expect(acctMsg.username).toBe("Keith");
    expect(db.loadAllPublicChatLog().some((m) => m.text === "hello from keith")).toBe(true);

    const visitorMsgPromise = waitForChatMessage(visitor, "hello from bob");
    visitor.emit("chat_message", { text: "hello from bob" });
    const visitorMsg = await visitorMsgPromise;
    expect(visitorMsg.username).toBe("Bob (visitor)");
    // A Visitor's own messages go into the same shared public record Keith/Anna read
    // back on login, labeled so it's clear they came from a guest, not a real account.
    const persistedBobMsg = db.loadAllPublicChatLog().find((m) => m.text === "hello from bob");
    expect(persistedBobMsg?.username).toBe("Bob (visitor)");
  });

  it("gives a Visitor no chat history on join, but gives a logged-in account its full persisted history", async () => {
    const acct = await connectClient();
    activeClients.push(acct);
    await login(acct, "Keith", "test-keith-pw");
    const msgPromise = waitForChatMessage(acct, "a message before the visitor arrives");
    acct.emit("chat_message", { text: "a message before the visitor arrives" });
    await msgPromise;

    const visitor = await connectClient();
    activeClients.push(visitor);
    const visitorAck = await new Promise<any>((resolve) => {
      visitor.once("join_ack", resolve);
      visitor.emit("join", { username: "Dana", gender: "female" });
    });
    expect(visitorAck.chatLogTail).toEqual([]);

    // Anna, not a second Keith session (which would hit the concurrent-login
    // rejection while `acct` is still connected) - the persisted chat history is
    // shared across both accounts, not per-account.
    const anna = await connectClient();
    activeClients.push(anna);
    const annaAck = await login(anna, "Anna", "test-anna-pw");
    expect(annaAck.chatLogTail.some((m: any) => m.text === "a message before the visitor arrives")).toBe(true);
  });

  it("persists terminal and NPC-chat interactions only for a logged-in account", async () => {
    const acctClient = await connectClient();
    const visitorClient = await connectClient();
    activeClients.push(acctClient, visitorClient);

    const acctAck = await login(acctClient, "Keith", "test-keith-pw");
    const acctPlayer = players.get(acctAck.playerId)!;
    const computer = mapMeta.computers[0];
    acctPlayer.x = computer.x * TILE_WIDTH;
    acctPlayer.y = computer.y * TILE_HEIGHT;

    vi.mocked(askFast).mockResolvedValueOnce("a helpful reply");
    const opened = await new Promise<any>((resolve) => {
      acctClient.once("computer_opened", resolve);
      acctClient.emit("computer_open", { computerId: computer.computerId });
    });
    await new Promise<any>((resolve) => {
      acctClient.once("computer_response", resolve);
      acctClient.emit("computer_message", { sessionId: opened.sessionId, text: "how's the experiment going?" });
    });

    const keithLog = db.loadRecentHumanInteractionLog("keith", 50);
    expect(keithLog.some((e) => e.role === "user" && e.text === "how's the experiment going?")).toBe(true);
    expect(keithLog.some((e) => e.role === "assistant" && e.text === "a helpful reply")).toBe(true);

    const visitorAck = await new Promise<any>((resolve) => {
      visitorClient.once("join_ack", resolve);
      visitorClient.emit("join", { username: "Carol", gender: "female" });
    });
    const visitorPlayer = players.get(visitorAck.playerId)!;
    visitorPlayer.x = computer.x * TILE_WIDTH;
    visitorPlayer.y = computer.y * TILE_HEIGHT;

    vi.mocked(askFast).mockResolvedValueOnce("a reply to a visitor");
    const visitorOpened = await new Promise<any>((resolve) => {
      visitorClient.once("computer_opened", resolve);
      visitorClient.emit("computer_open", { computerId: computer.computerId });
    });
    await new Promise<any>((resolve) => {
      visitorClient.once("computer_response", resolve);
      visitorClient.emit("computer_message", { sessionId: visitorOpened.sessionId, text: "visitor question" });
    });

    const keithLogAfter = db.loadRecentHumanInteractionLog("keith", 50);
    expect(keithLogAfter.some((e) => e.text === "visitor question")).toBe(false);
    expect(keithLogAfter.some((e) => e.text === "a reply to a visitor")).toBe(false);
  });
});

describe("visitor departure announcement", () => {
  it("announces a Visitor's disconnect live to the public chat, but not for a logged-in account", async () => {
    const observer = await connectClient();
    const visitor = await connectClient();
    activeClients.push(observer);

    await new Promise<void>((resolve) => {
      observer.once("join_ack", () => resolve());
      observer.emit("join", { username: "Observer", gender: "male" });
    });
    await new Promise<void>((resolve) => {
      visitor.once("join_ack", () => resolve());
      visitor.emit("join", { username: "Eve", gender: "female" });
    });

    const departurePromise = waitForChatMessage(observer, "Eve (visitor) has left.");
    visitor.disconnect();
    const departure = await departurePromise;
    expect(departure.username).toBe("System");
    expect(db.loadAllPublicChatLog().some((m) => m.text === "Eve (visitor) has left.")).toBe(true);

    // A logged-in account disconnecting gets no such announcement.
    const acct = await connectClient();
    await login(acct, "Anna", "test-anna-pw");
    let sawAnnaAnnouncement = false;
    const handler = (msg: any) => {
      if (msg.text.includes("Anna")) sawAnnaAnnouncement = true;
    };
    observer.on("chat_message", handler);
    acct.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 150));
    observer.off("chat_message", handler);
    expect(sawAnnaAnnouncement).toBe(false);
  });
});
