import type { TerminalVisualization } from "@lab/shared";
import { el, uiRoot } from "./root";
import { renderParitySvg, renderScatterSvg, renderStructureSvg } from "./terminalVisualization";

export class ComputerModal {
  private node: HTMLElement;
  private headerLabelEl: HTMLElement;
  private headlineEl: HTMLElement;
  /** Two generic chart slots - what renders in each depends on which terminal this is:
   * office (characterization) puts the structure diagram in A and the property scatter
   * in B; lab (calibration) puts an information-content parity plot in A and a
   * bulk-modulus parity plot in B. See setVisualization(). */
  private chartAEl: HTMLElement;
  private chartBEl: HTMLElement;
  private logEl: HTMLElement;
  private inputEl: HTMLInputElement;
  private onSend: ((text: string) => void) | null = null;
  private onClose: (() => void) | null = null;

  constructor() {
    this.node = el("div", "lab-ui lab-computer");
    this.node.style.display = "none";
    this.node.innerHTML = `
      <div class="lab-computer-window">
        <div class="lab-computer-header">
          <span>LAB TERMINAL</span>
          <button type="button">close [x]</button>
        </div>
        <div class="lab-computer-viz">
          <div class="lab-computer-headline"></div>
          <div class="lab-computer-viz-charts">
            <div class="lab-computer-chart-a"></div>
            <div class="lab-computer-chart-b"></div>
          </div>
        </div>
        <div class="lab-computer-log"></div>
        <div class="lab-computer-input-row">
          <input placeholder="Ask the terminal..." maxlength="2000" autocomplete="off" />
        </div>
      </div>
    `;
    this.headerLabelEl = this.node.querySelector(".lab-computer-header span")!;
    this.headlineEl = this.node.querySelector(".lab-computer-headline")!;
    this.chartAEl = this.node.querySelector(".lab-computer-chart-a")!;
    this.chartBEl = this.node.querySelector(".lab-computer-chart-b")!;
    this.logEl = this.node.querySelector(".lab-computer-log")!;
    this.inputEl = this.node.querySelector("input")!;
    this.node.querySelector("button")!.addEventListener("click", () => this.close());

    this.inputEl.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        const text = this.inputEl.value.trim();
        if (text) {
          this.addLine(text, "line-user");
          this.onSend?.(text);
          this.inputEl.value = "";
        }
      }
    });

    uiRoot().appendChild(this.node);
  }

  get isOpen(): boolean {
    return this.node.style.display !== "none";
  }

  /** `visualization` is only present for the real in-world computer terminals (lab_bench/
   * office_desk) - omit it when reusing this same modal for the character-chat flow
   * (walking up to lab_scientist/theoretical_scientist directly), which has no data
   * panel to show. */
  open(
    onSend: (text: string) => void,
    onClose: () => void,
    title = "LAB TERMINAL",
    readyMessage = "Terminal ready. Type a message and press Enter.",
    visualization?: TerminalVisualization,
  ): void {
    this.onSend = onSend;
    this.onClose = onClose;
    this.headerLabelEl.textContent = title;
    this.inputEl.placeholder = title === "LAB TERMINAL" ? "Ask the terminal..." : `Talk to ${title}...`;
    this.logEl.innerHTML = "";
    this.addLine(readyMessage, "line-system");
    this.setVisualization(visualization);
    this.node.style.display = "flex";
    setTimeout(() => this.inputEl.focus(), 0);
  }

  /** Renders (or hides, if `visualization` is undefined) the terminal's data panel
   * above the chat log - which two charts appear depends on `visualization.kind` (see
   * the chartAEl/chartBEl comment above). client/src/ui/terminalVisualization.ts has
   * the actual SVG generation. */
  setVisualization(visualization: TerminalVisualization | undefined): void {
    const vizEl = this.node.querySelector<HTMLElement>(".lab-computer-viz")!;
    if (!visualization) {
      vizEl.style.display = "none";
      return;
    }
    vizEl.style.display = "block";
    this.headlineEl.textContent = visualization.headline;
    if (visualization.kind === "characterization") {
      this.chartAEl.innerHTML = renderStructureSvg(visualization.structure);
      this.chartBEl.innerHTML = renderScatterSvg(visualization.scatter);
    } else {
      this.chartAEl.innerHTML = renderParitySvg(visualization.points, "informationContent");
      this.chartBEl.innerHTML = renderParitySvg(visualization.points, "bulkModulus");
    }
  }

  addResponse(text: string, visualization?: TerminalVisualization): void {
    this.addLine(text, "line-assistant");
    if (visualization) this.setVisualization(visualization);
  }

  addError(message: string): void {
    this.addLine(`[error] ${message}`, "line-error");
  }

  close(): void {
    if (!this.isOpen) return;
    this.node.style.display = "none";
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }

  private addLine(text: string, className: string): void {
    const line = el("div", className);
    line.textContent = text;
    this.logEl.appendChild(line);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }
}
