import { el, uiRoot } from "./root";

export function showLoginForm(onSubmit: (username: string) => void): void {
  const container = el("div", "lab-ui lab-login");
  container.innerHTML = `
    <form>
      <h1>Automated Lab</h1>
      <input name="username" placeholder="Enter a name" maxlength="24" autocomplete="off" required />
      <button type="submit">Enter the lab</button>
    </form>
  `;
  uiRoot().appendChild(container);

  const form = container.querySelector("form")!;
  const input = container.querySelector("input")!;
  input.focus();

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const username = input.value.trim();
    if (!username) return;
    container.remove();
    onSubmit(username);
  });
}
