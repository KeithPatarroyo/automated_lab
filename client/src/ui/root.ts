import "./ui.css";

export function uiRoot(): HTMLElement {
  const el = document.getElementById("app");
  if (!el) throw new Error("#app root element missing from index.html");
  return el;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

let topBarButtonsEl: HTMLElement | null = null;

/** Shared top-right button row (Help, the view toggle, ...) - lets each button just
 * append itself here instead of every one of them independently computing its own
 * `position: absolute` pixel offset to sit next to the others. */
export function topBarButtons(): HTMLElement {
  if (!topBarButtonsEl) {
    topBarButtonsEl = el("div", "lab-ui lab-topbar-buttons");
    uiRoot().appendChild(topBarButtonsEl);
  }
  return topBarButtonsEl;
}
