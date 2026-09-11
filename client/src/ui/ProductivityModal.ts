import type { ProductivityStats } from "@lab/shared";
import { el, topBarButtons, uiRoot } from "./root";

/** A dashboard populated from the server on open, unlike HelpModal's fully static
 * content - the button click doesn't open anything itself, it calls `onRequestStats`
 * (MainScene emits the "productivity_open" socket event); `showStats` is what actually
 * renders and opens the modal, called once "productivity_data" comes back. */
export class ProductivityModal {
  private node: HTMLElement;
  private bodyEl: HTMLElement;

  constructor(onRequestStats: () => void) {
    const button = el("button", "lab-topbar-button");
    button.type = "button";
    button.textContent = "Productivity";
    button.addEventListener("click", () => onRequestStats());
    topBarButtons().appendChild(button);

    this.node = el("div", "lab-ui lab-help");
    this.node.style.display = "none";
    this.node.innerHTML = `
      <div class="lab-help-window">
        <div class="lab-computer-header">
          <span>PRODUCTIVITY</span>
          <button type="button">close [x]</button>
        </div>
        <div class="lab-help-body"><p>Loading...</p></div>
      </div>
    `;
    this.bodyEl = this.node.querySelector(".lab-help-body")!;
    this.node.querySelector(".lab-computer-header button")!.addEventListener("click", () => this.close());
    uiRoot().appendChild(this.node);
  }

  get isOpen(): boolean {
    return this.node.style.display !== "none";
  }

  showStats(stats: ProductivityStats): void {
    const row = (label: string, value: string | number) => `
      <div class="lab-stat-row">
        <span class="lab-stat-label">${label}</span>
        <span class="lab-stat-value">${value}</span>
      </div>
    `;
    this.bodyEl.innerHTML =
      row("Agent-to-agent interactions", stats.agentInteractionCount) +
      row("Humans who've accessed this lab", stats.humanAccessCount) +
      row("Productivity score", stats.productivityScoreLabel) +
      row("Efficiency score", stats.efficiencyScoreLabel);
    this.open();
  }

  open(): void {
    this.node.style.display = "flex";
  }

  close(): void {
    this.node.style.display = "none";
  }
}
