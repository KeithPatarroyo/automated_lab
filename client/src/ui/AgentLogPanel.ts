import type { AgentLogEntry } from "@lab/shared";
import { el, uiRoot } from "./root";

const DISPLAY_NAMES: Record<string, string> = {
  lab_scientist: "Lab Scientist",
  theoretical_scientist: "Theoretical Scientist",
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Read-only feed of background agent activity (decisions, movement, arrivals) at the
 * bottom of the screen - separate from ChatPanel (in-world player chat, bottom-left) so
 * the two don't compete for the same space or get visually confused with each other. */
export class AgentLogPanel {
  private node: HTMLElement;
  private logEl: HTMLElement;

  constructor(initial: AgentLogEntry[]) {
    this.node = el("div", "lab-ui lab-agent-log");
    this.node.innerHTML = `
      <div class="lab-agent-log-header">AGENT ACTIVITY</div>
      <div class="lab-agent-log-body"></div>
    `;
    this.logEl = this.node.querySelector(".lab-agent-log-body")!;
    uiRoot().appendChild(this.node);
    for (const entry of initial) this.addEntry(entry);
  }

  addEntry(entry: AgentLogEntry): void {
    const row = el("div", "lab-agent-log-row");
    const time = el("span", "lab-agent-log-time");
    time.textContent = formatTime(entry.ts);
    const name = el("span", "lab-agent-log-name");
    name.textContent = DISPLAY_NAMES[entry.npcId] ?? entry.npcId;
    row.appendChild(time);
    row.appendChild(name);
    row.appendChild(document.createTextNode(entry.text));
    this.logEl.appendChild(row);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }
}
