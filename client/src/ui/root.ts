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
