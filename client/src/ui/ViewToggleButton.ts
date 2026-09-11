import { el, topBarButtons } from "./root";

/** A self-contained toggle button (same shape as ChatPanel's constructor - owns its DOM,
 * fires a callback) for switching the camera between following the player and a
 * zoomed-out view of the whole map. Unlike the `?birdseye=1` screenshot mode
 * (MainScene's boot-time-only URL check), this only ever touches the camera - the
 * player's own sprite/nametag and the chat/agent-log panels stay visible in both
 * views, and movement keeps working normally while zoomed out. */
export class ViewToggleButton {
  private button: HTMLButtonElement;
  private birdsEye = false;

  constructor(private readonly onToggle: (birdsEye: boolean) => void) {
    this.button = el("button", "lab-topbar-button");
    this.button.type = "button";
    this.button.textContent = "Bird's-eye";
    this.button.addEventListener("click", () => {
      this.birdsEye = !this.birdsEye;
      this.button.textContent = this.birdsEye ? "Room view" : "Bird's-eye";
      this.onToggle(this.birdsEye);
    });
    topBarButtons().appendChild(this.button);
  }
}
