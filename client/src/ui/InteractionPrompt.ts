import { el, uiRoot } from "./root";

export class InteractionPrompt {
  private node: HTMLElement;

  constructor() {
    this.node = el("div", "lab-ui lab-prompt");
    this.node.style.display = "none";
    uiRoot().appendChild(this.node);
  }

  show(text: string): void {
    this.node.textContent = text;
    this.node.style.display = "block";
  }

  hide(): void {
    this.node.style.display = "none";
  }
}
