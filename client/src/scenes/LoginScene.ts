import Phaser from "phaser";
import { showLoginForm } from "../ui/LoginForm";
import { socketClient } from "../net/SocketClient";

export class LoginScene extends Phaser.Scene {
  constructor() {
    super("LoginScene");
  }

  create(): void {
    showLoginForm(async (username) => {
      const joinAck = await socketClient.join(username);
      this.scene.start("MainScene", { joinAck, username });
    });
  }
}
