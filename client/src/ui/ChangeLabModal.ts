import { el, topBarButtons, uiRoot } from "./root";
import { LABS } from "../config/labs";

/** Lets a player jump to a different lab - each lab is a fully separate server/database
 * (see README's "Multiple labs" section), not a room within this one, so switching is a
 * full page reload to `?lab=<id>` rather than an in-place scene transition (MainScene's
 * socket listeners and the other top-bar UI classes have no teardown path - see the
 * plan this was built from for why a reload is the deliberately simpler, safer choice).
 * Same self-contained button+modal shape as HelpModal. */
export class ChangeLabModal {
  private node: HTMLElement;

  constructor(currentLabId: string) {
    const button = el("button", "lab-topbar-button");
    button.type = "button";
    button.textContent = "Change Lab";
    button.addEventListener("click", () => this.open());
    topBarButtons().appendChild(button);

    this.node = el("div", "lab-ui lab-help");
    this.node.style.display = "none";
    // Each option is a single clickable card - name above, a bird's-eye screenshot of
    // that lab below, so picking a lab means clicking its picture rather than a plain
    // text row (see config/labs.ts's previewImage / README's "Multiple labs" section
    // for how to regenerate these).
    const rows = LABS.map((lab) => {
      const isCurrent = lab.id === currentLabId;
      return `
        <button type="button" class="lab-changelab-item" data-lab-id="${lab.id}" ${isCurrent ? "disabled" : ""}>
          <span class="lab-changelab-name">${lab.displayName}${isCurrent ? " (current)" : ""}</span>
          <img class="lab-changelab-thumb" src="${lab.previewImage}" alt="${lab.displayName} preview" />
        </button>
      `;
    }).join("");
    this.node.innerHTML = `
      <div class="lab-help-window">
        <div class="lab-computer-header">
          <span>CHANGE LAB</span>
          <button type="button">close [x]</button>
        </div>
        <div class="lab-help-body">
          <p>Each lab is a fully separate world - its own map, its own agents, its own
          accounts and chat history. Click a lab's picture to go there - it reloads the
          page.</p>
          <div class="lab-changelab-list">${rows}</div>
        </div>
      </div>
    `;
    this.node.querySelector(".lab-computer-header button")!.addEventListener("click", () => this.close());
    for (const item of this.node.querySelectorAll<HTMLButtonElement>(".lab-changelab-item:not([disabled])")) {
      item.addEventListener("click", () => {
        const url = new URL(window.location.href);
        url.searchParams.set("lab", item.dataset.labId!);
        window.location.assign(url.toString());
      });
    }
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
