import { el, topBarButtons, uiRoot } from "./root";

const REPO_URL = "https://github.com/KeithPatarroyo/automated_lab";

const ABOUT_HTML = `
  <p>Developed by Keith Patarroyo, 2026.</p>
  <p>Source code: <a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">${REPO_URL}</a></p>
  <p>Inspired by the <i>Generative Agents</i> paper (<code>Paper/2304.03442v2.pdf</code>)
  and Andrew White's drugcrow.ai concept.</p>
`;

/** A static credits overlay, same self-contained button+modal shape as HelpModal - no
 * server round-trip, owns its own open/close lifecycle, and exposes `isOpen` for
 * MainScene's uiBlocksMovement gate. */
export class AboutModal {
  private node: HTMLElement;

  constructor() {
    const button = el("button", "lab-topbar-button");
    button.type = "button";
    button.textContent = "About";
    button.addEventListener("click", () => this.open());
    topBarButtons().appendChild(button);

    this.node = el("div", "lab-ui lab-help");
    this.node.style.display = "none";
    this.node.innerHTML = `
      <div class="lab-help-window">
        <div class="lab-computer-header">
          <span>ABOUT</span>
          <button type="button">close [x]</button>
        </div>
        <div class="lab-help-body">${ABOUT_HTML}</div>
      </div>
    `;
    this.node.querySelector("button")!.addEventListener("click", () => this.close());
    uiRoot().appendChild(this.node);
  }

  get isOpen(): boolean {
    return this.node.style.display !== "none";
  }

  open(): void {
    this.node.style.display = "flex";
  }

  close(): void {
    this.node.style.display = "none";
  }
}
