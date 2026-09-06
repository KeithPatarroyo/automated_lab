import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { LoginScene } from "./scenes/LoginScene";
import { MainScene } from "./scenes/MainScene";

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-container",
  width: 640,
  height: 480,
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  backgroundColor: "#111111",
  scene: [BootScene, LoginScene, MainScene],
});
