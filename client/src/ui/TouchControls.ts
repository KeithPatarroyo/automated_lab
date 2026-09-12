import { el, uiRoot } from "./root";

const ARROWS: Record<"up" | "down" | "left" | "right", string> = {
  up: "▲",
  down: "▼",
  left: "◀",
  right: "▶",
};

/** On-screen d-pad for touch devices, sitting in the black letterboxed strip below the
 * game canvas (Scale.FIT centers a fixed 640x480 canvas, leaving that space on most
 * phones) rather than floating on top of the game view. Exposes the same four
 * held-direction booleans MainScene already reads off the keyboard every frame, so
 * touch and keyboard just combine through the existing `update()` logic - this class
 * has no opinion on whether movement is currently allowed (uiBlocksMovement still
 * gates that), and an open modal simply paints over it (z-index) like everything else.
 * Only renders on a touch-capable device; on desktop it's a no-op with everything false. */
export class TouchControls {
  private held = { up: false, down: false, left: false, right: false };
  private interactRequested = false;
  private node: HTMLElement | null = null;

  constructor() {
    const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    if (!isTouchDevice) return;

    document.body.classList.add("lab-touch-active");

    this.node = el("div", "lab-touch-controls");
    const pad = el("div", "lab-touch-pad");
    (["up", "left", "right", "down"] as const).forEach((dir) => {
      const button = el("button", `lab-touch-btn lab-touch-btn-${dir}`);
      button.type = "button";
      button.textContent = ARROWS[dir];
      const press = (e: Event) => {
        e.preventDefault();
        this.held[dir] = true;
      };
      const release = (e: Event) => {
        e.preventDefault();
        this.held[dir] = false;
      };
      button.addEventListener("pointerdown", press);
      button.addEventListener("pointerup", release);
      button.addEventListener("pointerleave", release);
      button.addEventListener("pointercancel", release);
      pad.appendChild(button);
    });

    // Sits in the grid's empty center cell (surrounded by the four direction
    // buttons) - a single tap, not held-and-repeated like the arrows, matching
    // Phaser.Input.Keyboard.JustDown's fire-once-per-press semantics for "E".
    const interactButton = el("button", "lab-touch-btn lab-touch-btn-interact");
    interactButton.type = "button";
    interactButton.textContent = "E";
    interactButton.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.interactRequested = true;
    });
    pad.appendChild(interactButton);

    this.node.appendChild(pad);
    uiRoot().appendChild(this.node);

    this.positionBelowCanvas();
    window.addEventListener("resize", this.positionBelowCanvas);
  }

  get up(): boolean {
    return this.held.up;
  }
  get down(): boolean {
    return this.held.down;
  }
  get left(): boolean {
    return this.held.left;
  }
  get right(): boolean {
    return this.held.right;
  }

  /** Fire-once read of the interact button, same shape as Phaser's JustDown - a tap
   * reports true exactly once, regardless of how long update() keeps polling. */
  consumeInteractPress(): boolean {
    if (!this.interactRequested) return false;
    this.interactRequested = false;
    return true;
  }

  /** Pins the control strip's top edge to the canvas's actual rendered bottom edge
   * (Phaser recalculates that on window resize/rotation, so this just follows it),
   * with `bottom: 0` in CSS filling the rest of the way to the viewport edge. Also
   * publishes that height as a CSS variable so the chat/agent-log panels (anchored to
   * the viewport bottom) can lift themselves above the strip instead of sitting under
   * it - see ui.css's `--lab-touch-controls-height` usage. */
  private positionBelowCanvas = (): void => {
    if (!this.node) return;
    const canvas = document.querySelector("#game-container canvas");
    if (!canvas) return;
    const canvasBottom = canvas.getBoundingClientRect().bottom;
    this.node.style.top = `${canvasBottom}px`;
    const stripHeight = Math.max(0, window.innerHeight - canvasBottom);
    document.documentElement.style.setProperty("--lab-touch-controls-height", `${stripHeight}px`);
  };
}
