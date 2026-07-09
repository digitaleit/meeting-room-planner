const SUPABASE_URL = "https://zpiocrzswxjnfvyeinsi.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_LWvvRv0mgLBP4_102dLKEA_8a0Txygk";

const app = document.querySelector(".app");
const authScreen = document.querySelector("#authScreen");
const loginForm = document.querySelector("#loginForm");
const authMessage = document.querySelector("#authMessage");
const resetPasswordButton = document.querySelector("#resetPassword");
const loginEmail = document.querySelector("#loginEmail");
const loginPassword = document.querySelector("#loginPassword");
const logoutButton = document.querySelector("#logoutButton");
const userBadge = document.querySelector("#userBadge");
const userForm = document.querySelector("#userForm");
const userMessage = document.querySelector("#userMessage");
const usersList = document.querySelector("#usersList");
const usersSummary = document.querySelector("#usersSummary");
const refreshUsersButton = document.querySelector("#refreshUsers");

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let currentProfile = null;
let users = [];

init();

async function init() {
  bindEvents();

  const { data } = await supabaseClient.auth.getSession();
  if (data.session?.user) {
    await handleAuthenticated(data.session.user);
  } else {
    showLogin();
  }

  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_OUT") showLogin();
    if (event === "SIGNED_IN" && session?.user) await handleAuthenticated(session.user);
  });
}

function bindEvents() {
  loginForm.addEventListener("submit", handleLogin);
  resetPasswordButton.addEventListener("click", sendPasswordReset);
  logoutButton.addEventListener("click", logout);
  userForm.addEventListener("submit", saveUser);
  refreshUsersButton.addEventListener("click", loadUsers);
}

async function handleLogin(event) {
  event.preventDefault();
  showAuthMessage("");

  const { error } = await supabaseClient.auth.signInWithPassword({
    email: loginEmail.value.trim(),
    password: loginPassword.value,
  });

  if (error) showAuthMessage("Accesso non riuscito. Controlla email e password.", "error");
}

async function sendPasswordReset() {
  const email = loginEmail.value.trim();

  if (!email) {
    showAuthMessage("Inserisci prima la tua email.", "error");
    return;
  }

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}${window.location.pathname.replace(/users\.html$/, "")}reset.html`,
  });

  showAuthMessage(
    error ? "Non riesco a inviare la mail di reset." : "Email inviata: controlla la tua posta.",
    error ? "error" : "ok"
  );
}

async function logout() {
  await supabaseClient.auth.signOut();
}

async function handleAuthenticated(user) {
  currentUser = user;
  currentProfile = await getProfile(user);

  if (!currentProfile?.is_admin) {
    showAuthMessage("Questa pagina e riservata agli amministratori.", "error");
    await supabaseClient.auth.signOut();
    return;
  }

  userBadge.textContent = `${currentProfile.username || user.email} · admin`;
  authScreen.classList.add("hidden");
  app.classList.remove("hidden");
  await loadUsers();
}

function showLogin() {
  currentUser = null;
  currentProfile = null;
  users = [];
  app.classList.add("hidden");
  authScreen.classList.remove("hidden");
  userBadge.textContent = "Utente non autenticato";
  renderUsers();
}

async function getProfile(user) {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id,username,company,email,is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (error) showAuthMessage("Profilo non trovato. Controlla Supabase.", "error");
  return data;
}

async function loadUsers() {
  showUserMessage("");

  const { data, error } = await supabaseClient.functions.invoke("admin-create-user", {
    body: { action: "list" },
  });

  if (error) {
    showUserMessage("Non riesco a caricare gli utenti.", "error");
    return;
  }

  users = data?.users || [];
  renderUsers();
}

async function saveUser(event) {
  event.preventDefault();
  showUserMessage("Salvataggio utente in corso...", "");

  const formData = new FormData(userForm);
  const payload = {
    action: "upsert",
    username: cleanText(formData.get("username")),
    company: cleanText(formData.get("company")),
    email: cleanText(formData.get("email")).toLowerCase(),
  };
  const password = String(formData.get("password") || "").trim();
  if (password) payload.password = password;

  const { data, error } = await supabaseClient.functions.invoke("admin-create-user", {
    body: payload,
  });

  if (error) {
    showUserMessage("Non riesco a salvare l'utente.", "error");
    return;
  }

  userForm.reset();
  await loadUsers();
  showUserMessage(
    data?.passwordResetSent
      ? "Utente salvato. Email inviata per impostare la password."
      : "Utente salvato con password impostata.",
    "ok"
  );
}

async function setUserPassword(user) {
  const input = document.querySelector(`[data-password-for="${user.id}"]`);
  const password = input?.value.trim();

  if (!password || password.length < 8) {
    showUserMessage("Inserisci una password di almeno 8 caratteri.", "error");
    return;
  }

  const { error } = await supabaseClient.functions.invoke("admin-create-user", {
    body: {
      action: "upsert",
      username: user.username,
      company: user.company,
      email: user.email,
      password,
    },
  });

  if (error) {
    showUserMessage("Non riesco a impostare la password.", "error");
    return;
  }

  input.value = "";
  showUserMessage(`Password aggiornata per ${user.email}.`, "ok");
}

async function sendUserReset(user) {
  const { error } = await supabaseClient.functions.invoke("admin-create-user", {
    body: {
      action: "reset",
      email: user.email,
    },
  });

  showUserMessage(
    error ? `Non riesco a inviare il reset a ${user.email}.` : `Reset password inviato a ${user.email}.`,
    error ? "error" : "ok"
  );
}

function renderUsers() {
  usersSummary.textContent = users.length === 1
    ? "1 utente presente."
    : `${users.length} utenti presenti.`;

  if (!users.length) {
    usersList.innerHTML = '<p class="empty">Nessun utente presente.</p>';
    return;
  }

  usersList.innerHTML = "";
  users.forEach((user) => {
    const row = document.createElement("article");
    row.className = "user-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(user.username)}</strong>
        <span>${escapeHtml(user.company)}</span>
        <small>${escapeHtml(user.email)}${user.is_admin ? " · admin" : ""}</small>
      </div>
      <div class="user-actions">
        <input data-password-for="${escapeHtml(user.id)}" type="password" autocomplete="new-password" placeholder="Nuova password">
        <button class="secondary" type="button" data-action="set-password">Imposta pw</button>
        <button class="secondary" type="button" data-action="reset">Reset via mail</button>
      </div>
    `;

    row.querySelector('[data-action="set-password"]').addEventListener("click", () => setUserPassword(user));
    row.querySelector('[data-action="reset"]').addEventListener("click", () => sendUserReset(user));
    usersList.append(row);
  });
}

function cleanText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function showAuthMessage(text, type) {
  authMessage.textContent = text;
  authMessage.className = type ? `message ${type}` : "message";
}

function showUserMessage(text, type) {
  userMessage.textContent = text;
  userMessage.className = type ? `message ${type}` : "message";
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
