import type { Gender } from "@lab/shared";
import { el, uiRoot } from "./root";

export function showLoginForm(onSubmit: (username: string, gender: Gender) => void): void {
  const container = el("div", "lab-ui lab-login");
  container.innerHTML = `
    <form>
      <h1>Automated Lab</h1>
      <input name="username" placeholder="Enter a name" maxlength="24" autocomplete="off" required />
      <div class="lab-login-gender">
        <label><input type="radio" name="gender" value="male" checked /> Male</label>
        <label><input type="radio" name="gender" value="female" /> Female</label>
      </div>
      <button type="submit">Enter the lab</button>
    </form>
  `;
  uiRoot().appendChild(container);

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
}
