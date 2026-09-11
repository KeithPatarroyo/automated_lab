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

class SocketClient {
  socket: GameSocket | null = null;

  /** `serverUrl` picks which lab's server this connects to (see config/labs.ts) - a
   * page load only ever targets one lab (switching is a full reload, see
   * ChangeLabModal), so the `if (this.socket) return this.socket` guard below is never
   * hit twice with a different URL in one page lifetime. */
  connect(serverUrl: string): GameSocket {
    if (this.socket) return this.socket;
    this.socket = io(serverUrl, { transports: ["websocket"] });
    return this.socket;
  }

  join(serverUrl: string, username: string, gender: Gender): Promise<JoinAck> {
    const socket = this.connect(serverUrl);
    return new Promise((resolve, reject) => {
      const onAck = (payload: JoinAck) => {
        socket.off("join_error", onError);
        resolve(payload);
      };
      const onError = (payload: { message: string }) => {
        socket.off("join_ack", onAck);
        reject(new Error(payload.message));
      };
      socket.once("join_ack", onAck);
      socket.once("join_error", onError);
      socket.emit("join", { username, gender });
    });
  }

  login(serverUrl: string, username: string, password: string): Promise<JoinAck> {
    const socket = this.connect(serverUrl);
    return new Promise((resolve, reject) => {
      const onAck = (payload: JoinAck) => {
        socket.off("login_error", onError);
        resolve(payload);
      };
      const onError = (payload: { message: string }) => {
        socket.off("join_ack", onAck);
        reject(new Error(payload.message));
      };
      socket.once("join_ack", onAck);
      socket.once("login_error", onError);
      socket.emit("login", { username, password });
    });
  }
}

export const socketClient = new SocketClient();
