import Phaser from "phaser";
import { showLoginForm } from "../ui/LoginForm";
import { socketClient } from "../net/SocketClient";

export class LoginScene extends Phaser.Scene {
  constructor() {
    super("LoginScene");
  }

  create(): void {
    showLoginForm(
      async (username, gender) => {
        const joinAck = await socketClient.join(username, gender);
        this.scene.start("MainScene", { joinAck, username });
      },
      async (username, password) => {
        const joinAck = await socketClient.login(username, password);
        // Use the server-echoed name (canonical "Keith"/"Anna" casing), not whatever
        // case the user happened to type.
        const me = joinAck.players.find((p) => p.id === joinAck.playerId);
        this.scene.start("MainScene", { joinAck, username: me?.username ?? username });
      },
    );
  }
}
