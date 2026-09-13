import type { Gender } from "@lab/shared";
import { el, uiRoot } from "./root";

type Mode = "select" | "visitor" | "account";

const REPO_URL = "https://github.com/KeithPatarroyo/automated_lab";

/** Entry screen: choose "Visitor" (ephemeral username+gender, never persisted) or
 * "Log In" (Keith/Anna only - the two persisted accounts, see server/src/accounts/
 * humanAccounts.ts). Both paths can be rejected by the server (a reserved username, or
 * bad credentials) - on rejection the form shows an inline error and stays open rather
 * than vanishing, since previously "Visitor" always succeeded and removed itself
 * immediately, which no longer holds now that a reserved name can be turned away. */
export function showLoginForm(
  onVisitorSubmit: (username: string, gender: Gender) => Promise<void>,
  onAccountLogin: (username: string, password: string) => Promise<void>,
  labName: string,
): void {
  const container = el("div", "lab-ui lab-login");
  uiRoot().appendChild(container);

  let mode: Mode = "select";
  render();

  function render(): void {
    if (mode === "select") renderSelect();
    else if (mode === "visitor") renderVisitor();
    else renderAccount();
  }

  function renderSelect(): void {
    container.innerHTML = `
      <div class="lab-login-card">
        <h1>Automated Lab</h1>
        <p class="lab-login-subtitle">${labName}</p>
        <div class="lab-login-mode-select">
          <button type="button" data-mode="login">Log In</button>
          <button type="button" data-mode="visitor">Visitor</button>
        </div>
        <a class="lab-login-repo-link" href="${REPO_URL}" target="_blank" rel="noopener noreferrer">View source on GitHub</a>
      </div>
    `;
    container.querySelector('[data-mode="login"]')!.addEventListener("click", () => {
      mode = "account";
      render();
    });
    container.querySelector('[data-mode="visitor"]')!.addEventListener("click", () => {
      mode = "visitor";
      render();
    });
  }

  /** Runs `submit`, removing the form on success and showing an inline error (without
   * losing whatever's already in the other fields) on rejection. Disables the submit
   * button while pending so a slow response can't be double-submitted. */
  function handleSubmit(form: HTMLFormElement, submit: () => Promise<void>): void {
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    let errorEl = form.querySelector<HTMLElement>(".lab-login-error");
    if (!errorEl) {
      errorEl = el("p", "lab-login-error");
      form.appendChild(errorEl);
    }
    errorEl.textContent = "";
    button.disabled = true;
    submit()
      .then(() => container.remove())
      .catch((err: unknown) => {
        button.disabled = false;
        errorEl!.textContent = err instanceof Error ? err.message : "Something went wrong.";
      });
  }

  function renderVisitor(): void {
    container.innerHTML = `
      <div class="lab-login-card">
        <h1>Automated Lab</h1>
        <p class="lab-login-subtitle">${labName}</p>
        <form>
          <input class="lab-login-input" name="username" placeholder="Enter a name" maxlength="24" autocomplete="off" required />
          <div class="lab-login-gender">
            <label><input type="radio" name="gender" value="male" checked /> Male</label>
            <label><input type="radio" name="gender" value="female" /> Female</label>
          </div>
          <button type="submit">Enter the lab</button>
        </form>
        <button type="button" class="lab-login-back">Back</button>
      </div>
    `;
    const form = container.querySelector("form")!;
    const input = container.querySelector("input[name=username]")! as HTMLInputElement;
    input.focus();

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const username = input.value.trim();
      if (!username) return;
      const genderInput = container.querySelector<HTMLInputElement>('input[name="gender"]:checked');
      const gender: Gender = genderInput?.value === "female" ? "female" : "male";
      handleSubmit(form, () => onVisitorSubmit(username, gender));
    });

    container.querySelector(".lab-login-back")!.addEventListener("click", () => {
      mode = "select";
      render();
    });
  }

  function renderAccount(): void {
    container.innerHTML = `
      <div class="lab-login-card">
        <h1>Automated Lab</h1>
        <p class="lab-login-subtitle">${labName}</p>
        <form>
          <input class="lab-login-input" name="account-username" placeholder="Username" autocomplete="username" required />
          <input class="lab-login-input" name="account-password" type="password" placeholder="Password" autocomplete="current-password" required />
          <button type="submit">Log In</button>
        </form>
        <button type="button" class="lab-login-back">Back</button>
      </div>
    `;
    const form = container.querySelector("form")!;
    const usernameInput = container.querySelector("input[name=account-username]")! as HTMLInputElement;
    const passwordInput = container.querySelector("input[name=account-password]")! as HTMLInputElement;
    usernameInput.focus();

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const username = usernameInput.value.trim();
      const password = passwordInput.value;
      if (!username || !password) return;
      handleSubmit(form, () => onAccountLogin(username, password));
      passwordInput.value = "";
    });

    container.querySelector(".lab-login-back")!.addEventListener("click", () => {
      mode = "select";
      render();
    });
  }
}
