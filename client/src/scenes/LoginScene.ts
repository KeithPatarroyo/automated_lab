import Phaser from "phaser";
import { showLoginForm } from "../ui/LoginForm";
import { socketClient } from "../net/SocketClient";

export class LoginScene extends Phaser.Scene {
  constructor() {
    super("LoginScene");
  }

  create(): void {
    showLoginForm(async (username, gender) => {
      const joinAck = await socketClient.join(username, gender);
      this.scene.start("MainScene", { joinAck, username });
    });
  }
}
