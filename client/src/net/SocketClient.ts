import { io, type Socket } from "socket.io-client";
import type {
  AgentLogEntry,
  AgentNpcState,
  ChatMessage,
  ClientToServerEvents,
  Gender,
  MapMeta,
  PlayerState,
  ServerToClientEvents,
} from "@lab/shared";

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface JoinAck {
  playerId: string;
  players: PlayerState[];
  mapMeta: MapMeta;
  chatLogTail: ChatMessage[];
  agents: AgentNpcState[];
  agentLogTail: AgentLogEntry[];
}

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";

class SocketClient {
  socket: GameSocket | null = null;

  connect(): GameSocket {
    if (this.socket) return this.socket;
    this.socket = io(SERVER_URL, { transports: ["websocket"] });
    return this.socket;
  }

  join(username: string, gender: Gender): Promise<JoinAck> {
    const socket = this.connect();
    return new Promise((resolve) => {
      socket.once("join_ack", (payload) => resolve(payload));
      socket.emit("join", { username, gender });
    });
  }
}

export const socketClient = new SocketClient();
