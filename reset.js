const SUPABASE_URL = "https://zpiocrzswxjnfvyeinsi.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_LWvvRv0mgLBP4_102dLKEA_8a0Txygk";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const resetForm = document.querySelector("#resetForm");
const newPassword = document.querySelector("#newPassword");
const confirmPassword = document.querySelector("#confirmPassword");
const resetMessage = document.querySelector("#resetMessage");

init();

async function init() {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");

  if (accessToken && refreshToken) {
    const { error } = await supabaseClient.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error) showMessage("Link non valido o scaduto. Richiedi un nuovo reset.", "error");
  }

  resetForm.addEventListener("submit", updatePassword);
}

async function updatePassword(event) {
  event.preventDefault();

  const password = newPassword.value;
  const confirmation = confirmPassword.value;

  if (password.length < 8) {
    showMessage("La password deve avere almeno 8 caratteri.", "error");
    return;
  }

  if (password !== confirmation) {
    showMessage("Le password non coincidono.", "error");
    return;
  }

  const { error } = await supabaseClient.auth.updateUser({ password });

  if (error) {
    showMessage("Non riesco a salvare la password. Richiedi un nuovo reset.", "error");
    return;
  }

  showMessage("Password aggiornata. Ora puoi accedere.", "ok");
  window.setTimeout(() => {
    window.location.href = "index.html";
  }, 1600);
}

function showMessage(text, type) {
  resetMessage.textContent = text;
  resetMessage.className = type ? `message ${type}` : "message";
}
