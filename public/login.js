const form = document.querySelector("#login-form");
const status = document.querySelector("#login-status");
const totpField = document.querySelector("#totp-field");

fetch("/api/auth/session", { cache: "no-store" })
  .then((response) => response.json())
  .then((data) => {
    if (data.authenticated) {
      location.assign("/admin");
      return;
    }
    totpField.hidden = !data.totpRequired;
    totpField.querySelector("input").required = Boolean(data.totpRequired);
    form.dataset.loginPath = data.loginPath ?? "/entrar-8f3k2x";
  })
  .catch(() => {
    status.textContent = "Serviço temporariamente indisponível.";
  });

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.textContent = "";
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      body: new FormData(form),
      headers: { Accept: "application/json" },
    });
    const result = await response.json();
    if (!response.ok) {
      status.textContent = result.minutes
        ? `Muitas tentativas, tente novamente em ${result.minutes} minutos.`
        : result.error ?? "Usuário ou senha inválidos.";
      return;
    }
    location.assign("/admin");
  } catch {
    status.textContent = "Serviço temporariamente indisponível, tente novamente mais tarde.";
  } finally {
    button.disabled = false;
  }
});
