const SUPABASE_URL = "https://zpiocrzswxjnfvyeinsi.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_LWvvRv0mgLBP4_102dLKEA_8a0Txygk";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const resetForm = document.querySelector("#resetForm");
const newPassword = document.querySelector("#newPassword");
const confirmPassword = document.querySelector("#confirmPassword");
const resetMessage = document.querySelector("#resetMessage");
const savePassword = document.querySelector("#savePassword");

let recoverySessionReady = false;

init();

async function init() {
  resetForm.addEventListener("submit", updatePassword);
  showMessage("Verifica del link in corso...", "");

  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  const authorizationCode = query.get("code");
  const redirectedRecovery = sessionStorage.getItem("password-recovery-redirect") === "1";
  const hasRecoveryLink = Boolean(authorizationCode || (accessToken && refreshToken) || redirectedRecovery);
  sessionStorage.removeItem("password-recovery-redirect");

  if (!hasRecoveryLink) {
    showInvalidLink();
    return;
  }

  if (authorizationCode) {
    const { error } = await supabaseClient.auth.exchangeCodeForSession(authorizationCode);
    if (error) {
      showInvalidLink();
      return;
    }

    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (accessToken && refreshToken) {
    const { error } = await supabaseClient.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error) {
      showInvalidLink();
      return;
    }

    window.history.replaceState({}, document.title, window.location.pathname);
  }

  const { data, error } = await supabaseClient.auth.getSession();
  if (error || !data.session?.user) {
    showInvalidLink();
    return;
  }

  recoverySessionReady = true;
  savePassword.disabled = false;
  showMessage("Inserisci due volte la tua nuova password.", "");
}

async function updatePassword(event) {
  event.preventDefault();

  if (!recoverySessionReady) {
    showInvalidLink();
    return;
  }

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

  recoverySessionReady = false;
  savePassword.disabled = true;
  await supabaseClient.auth.signOut();
  showMessage("Password creata. Ora puoi accedere.", "ok");
  window.setTimeout(() => {
    window.location.replace("index.html?password_updated=1");
  }, 1600);
}

function showInvalidLink() {
  recoverySessionReady = false;
  savePassword.disabled = true;
  showMessage("Link non valido o scaduto. Richiedi una nuova email.", "error");
}

function showMessage(text, type) {
  resetMessage.textContent = text;
  resetMessage.className = type ? `message ${type}` : "message";
}
