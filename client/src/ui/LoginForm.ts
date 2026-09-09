import type { Gender } from "@lab/shared";
import { el, uiRoot } from "./root";

type Mode = "select" | "visitor" | "account";

/** Entry screen: choose "Visitor" (today's username+gender flow, calls `onSubmit`) or
 * "Log In" (username/password placeholder - no real account system exists yet, see
 * README's Known limitations; submitting just shows a "not available yet" note). */
export function showLoginForm(onSubmit: (username: string, gender: Gender) => void): void {
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
        <div class="lab-login-mode-select">
          <button type="button" data-mode="login">Log In</button>
          <button type="button" data-mode="visitor">Visitor</button>
        </div>
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

  function renderVisitor(): void {
    container.innerHTML = `
      <div class="lab-login-card">
        <h1>Automated Lab</h1>
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
      container.remove();
      onSubmit(username, gender);
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
        <form>
          <input class="lab-login-input" name="account-username" placeholder="Username" autocomplete="username" required />
          <input class="lab-login-input" name="account-password" type="password" placeholder="Password" autocomplete="current-password" required />
          <button type="submit">Log In</button>
        </form>
        <p class="lab-login-note">Account login isn't set up yet - use Visitor for now.</p>
        <button type="button" class="lab-login-back">Back</button>
      </div>
    `;
    const form = container.querySelector("form")!;
    const note = container.querySelector(".lab-login-note")!;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      note.textContent = "Account login isn't set up yet - use Visitor for now.";
    });

    container.querySelector(".lab-login-back")!.addEventListener("click", () => {
      mode = "select";
      render();
    });
  }
}
