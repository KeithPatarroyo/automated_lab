import { el, uiRoot } from "./root";

export class DialogueBox {
  private node: HTMLElement;
  private nameEl: HTMLElement;
  private textEl: HTMLElement;
  private lines: string[] = [];
  private index = 0;
  private onClosed: (() => void) | null = null;

  constructor() {
    this.node = el("div", "lab-ui lab-dialogue");
    this.node.style.display = "none";
    this.node.innerHTML = `
      <div class="lab-dialogue-name"></div>
      <div class="lab-dialogue-text"></div>
      <div class="lab-dialogue-hint">click / space to continue</div>
    `;
    this.nameEl = this.node.querySelector(".lab-dialogue-name")!;
    this.textEl = this.node.querySelector(".lab-dialogue-text")!;
    this.node.addEventListener("click", () => this.advance());
    uiRoot().appendChild(this.node);
  }

  get isOpen(): boolean {
    return this.node.style.display !== "none";
  }

  open(name: string, lines: string[], onClosed: () => void): void {
    this.nameEl.textContent = name;
    this.lines = lines;
    this.index = 0;
    this.onClosed = onClosed;
    this.node.style.display = "block";
    this.render();
  }

  advance(): void {
    if (!this.isOpen) return;
    this.index++;
    if (this.index >= this.lines.length) {
      this.close();
      return;
    }
    this.render();
  }

  close(): void {
    this.node.style.display = "none";
    const cb = this.onClosed;
    this.onClosed = null;
    cb?.();
  }

  private render(): void {
    this.textEl.textContent = this.lines[this.index] ?? "";
  }
}
