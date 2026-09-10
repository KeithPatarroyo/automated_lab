import { el, uiRoot } from "./root";

const HELP_HTML = `
  <h2>Controls</h2>
  <p>Move with <b>WASD</b> or the arrow keys. Walk up to a character or a computer
  terminal and press <b>E</b> to interact.</p>

  <h2>Characters: NPCs vs. agents</h2>
  <p><b>NPCs</b> (Workshop Tech, Kitchen Cook, Office Manager, and the unlabeled
  background workers) are static - they play a few canned lines when you press E near
  them.</p>
  <p><b>Agents</b> (Lab Scientist, Theoretical Scientist) are different: real
  autonomous AI characters. They walk the map on their own, run experiments, analyze
  data, and occasionally talk to each other. Press E near one for a live conversation
  with it.</p>

  <h2>Computer terminals</h2>
  <p>The Lab Terminal shows the experimentalist's raw measurement data (a
  theory-vs-experiment parity plot); the Office Terminal shows the theorist's
  higher-level view (best structure found so far, the overall property landscape).
  Walk up and press E to open one - you can also type a message to ask its AI about
  the data it's showing.</p>

  <h2>Public chat</h2>
  <p>The chat box (bottom-left) is visible to everyone currently in the lab. An
  anonymous Visitor's messages only show up live, from the moment they join; logging
  in as a named account keeps the whole chat history and your position between
  visits.</p>

  <h2>Agent activity</h2>
  <p>The feed next to chat (bottom-right) is a live, read-only log of what the two AI
  agents are deciding and doing, updated in real time - a way to follow their work
  without following them around the map.</p>
`;

/** A static instructions overlay, opened by its own always-visible button - unlike
 * DialogueBox/ComputerModal, nothing here comes from the server, so this component owns
 * its full open/close lifecycle with no callback into MainScene beyond the `isOpen`
 * getter it checks to gate movement (same pattern as ChatPanel.isFocused). */
export class HelpModal {
  private node: HTMLElement;

  constructor() {
    const button = el("button", "lab-help-button");
    button.type = "button";
    button.textContent = "? Help";
    button.addEventListener("click", () => this.open());
    uiRoot().appendChild(button);

    this.node = el("div", "lab-ui lab-help");
    this.node.style.display = "none";
    this.node.innerHTML = `
      <div class="lab-help-window">
        <div class="lab-computer-header">
          <span>HELP</span>
          <button type="button">close [x]</button>
        </div>
        <div class="lab-help-body">${HELP_HTML}</div>
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
