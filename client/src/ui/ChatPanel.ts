import type { ChatMessage } from "@lab/shared";
import { el, uiRoot } from "./root";

export class ChatPanel {
  private node: HTMLElement;
  private logEl: HTMLElement;
  private inputEl: HTMLInputElement;

  constructor(onSend: (text: string) => void) {
    this.node = el("div", "lab-ui lab-chat");
    this.node.innerHTML = `
      <div class="lab-chat-log"></div>
      <div class="lab-chat-input-row">
        <input placeholder="Message everyone... (Enter to send)" maxlength="500" autocomplete="off" />
      </div>
    `;
    this.logEl = this.node.querySelector(".lab-chat-log")!;
    this.inputEl = this.node.querySelector("input")!;
    uiRoot().appendChild(this.node);

    this.inputEl.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        const text = this.inputEl.value.trim();
        if (text) {
          onSend(text);
          this.inputEl.value = "";
        }
      } else if (e.key === "Escape") {
        this.inputEl.blur();
      }
    });
  }

  get isFocused(): boolean {
    return document.activeElement === this.inputEl;
  }

  focus(): void {
    this.inputEl.focus();
  }

  addMessage(msg: ChatMessage): void {
    const row = el("div");
    const nameSpan = el("span", "username");
    nameSpan.textContent = `${msg.username}: `;
    row.appendChild(nameSpan);
    row.appendChild(document.createTextNode(msg.text));
    this.logEl.appendChild(row);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }
}
