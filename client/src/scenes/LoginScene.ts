import Phaser from "phaser";
import { showLoginForm } from "../ui/LoginForm";
import { socketClient } from "../net/SocketClient";
import { resolveActiveLab } from "../config/labs";

export class LoginScene extends Phaser.Scene {
  constructor() {
    super("LoginScene");
  }

  create(): void {
    const lab = resolveActiveLab();
    showLoginForm(
      async (username, gender) => {
        const joinAck = await socketClient.join(lab.serverUrl, username, gender);
        this.scene.start("MainScene", { joinAck, username, lab });
      },
      async (username, password) => {
        const joinAck = await socketClient.login(lab.serverUrl, username, password);
        // Use the server-echoed name (canonical "Keith"/"Anna" casing), not whatever
        // case the user happened to type.
        const me = joinAck.players.find((p) => p.id === joinAck.playerId);
        this.scene.start("MainScene", { joinAck, username: me?.username ?? username, lab });
      },
      lab.displayName,
    );
  }
}
