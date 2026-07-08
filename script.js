const SUPABASE_URL = "https://zpiocrzswxjnfvyeinsi.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_LWvvRv0mgLBP4_102dLKEA_8a0Txygk";

const STORAGE_KEY = "meeting-room-bookings-v2";
const AUTO_REFRESH_MS = 30000;
const OPEN_HOUR = 8;
const CLOSE_HOUR = 20;

const app = document.querySelector(".app");
const authScreen = document.querySelector("#authScreen");
const loginForm = document.querySelector("#loginForm");
const authMessage = document.querySelector("#authMessage");
const resetPasswordButton = document.querySelector("#resetPassword");
const loginEmail = document.querySelector("#loginEmail");
const loginPassword = document.querySelector("#loginPassword");
const logoutButton = document.querySelector("#logoutButton");
const userBadge = document.querySelector("#userBadge");
const bookingForm = document.querySelector("#bookingForm");
const userForm = document.querySelector("#userForm");
const userMessage = document.querySelector("#userMessage");
const adminPanel = document.querySelector("#adminPanel");
const calendar = document.querySelector("#calendar");
const bookingList = document.querySelector("#bookingList");
const bookingCount = document.querySelector("#bookingCount");
const message = document.querySelector("#message");
const weekLabel = document.querySelector("#weekLabel");
const roomStatus = document.querySelector("#roomStatus");
const nextBooking = document.querySelector("#nextBooking");
const syncStatus = document.querySelector("#syncStatus");
const dateInput = document.querySelector("#date");
const startInput = document.querySelector("#start_time");
const endInput = document.querySelector("#end_time");
const nameInput = document.querySelector("#name");
const companyInput = document.querySelector("#company");
const clearLocalButton = document.querySelector("#clearLocal");

const hasSupabaseConfig = SUPABASE_URL.startsWith("https://") && SUPABASE_ANON_KEY.length > 20;
const supabaseClient = hasSupabaseConfig
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

let currentMonday = getMonday(new Date());
let bookings = [];
let currentUser = null;
let currentProfile = null;
let realtimeChannel = null;

init();

async function init() {
  dateInput.valueAsDate = new Date();
  startInput.value = "09:00";
  endInput.value = "10:00";
  nameInput.readOnly = true;
  companyInput.readOnly = true;
  updateSyncStatus();
  bindEvents();
  render();

  if (!supabaseClient) {
    showAuthMessage("Configura Supabase per usare login e prenotazioni condivise.", "error");
    return;
  }

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

  window.setInterval(renderStatus, AUTO_REFRESH_MS);
  window.setInterval(() => {
    if (currentUser) loadBookings();
  }, AUTO_REFRESH_MS);
}

function bindEvents() {
  loginForm.addEventListener("submit", handleLogin);
  resetPasswordButton.addEventListener("click", sendPasswordReset);
  logoutButton.addEventListener("click", logout);
  userForm.addEventListener("submit", registerUserRequest);

  document.querySelector("#prevWeek").addEventListener("click", () => {
    currentMonday.setDate(currentMonday.getDate() - 7);
    render();
  });

  document.querySelector("#nextWeek").addEventListener("click", () => {
    currentMonday.setDate(currentMonday.getDate() + 7);
    render();
  });

  clearLocalButton.addEventListener("click", () => {
    if (supabaseClient) {
      showMessage("La pulizia locale e disponibile solo senza Supabase.", "error");
      return;
    }

    if (!confirm("Vuoi cancellare tutte le prenotazioni salvate su questo browser?")) return;
    localStorage.removeItem(STORAGE_KEY);
    bookings = [];
    render();
    showMessage("Prenotazioni locali cancellate.", "ok");
  });

  bookingForm.addEventListener("submit", handleSubmit);
}

async function handleLogin(event) {
  event.preventDefault();
  showAuthMessage("");

  const { error } = await supabaseClient.auth.signInWithPassword({
    email: loginEmail.value.trim(),
    password: loginPassword.value,
  });

  if (error) {
    showAuthMessage("Accesso non riuscito. Controlla email e password.", "error");
  }
}

async function sendPasswordReset() {
  const email = loginEmail.value.trim();

  if (!email) {
    showAuthMessage("Inserisci prima la tua email.", "error");
    return;
  }

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.href,
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
  applyProfile();
  authScreen.classList.add("hidden");
  app.classList.remove("hidden");
  await loadBookings();
  subscribeToRealtime();
}

function showLogin() {
  currentUser = null;
  currentProfile = null;
  bookings = [];
  unsubscribeFromRealtime();
  app.classList.add("hidden");
  authScreen.classList.remove("hidden");
  adminPanel.classList.add("hidden");
  userBadge.textContent = "Utente non autenticato";
  render();
}

async function getProfile(user) {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id,username,company,email,is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    showMessage("Profilo non trovato. Controlla lo script Supabase.", "error");
  }

  return data || {
    id: user.id,
    username: user.email,
    company: "",
    email: user.email,
    is_admin: false,
  };
}

function applyProfile() {
  const displayName = currentProfile.username || currentUser.email;
  nameInput.value = displayName;
  companyInput.value = currentProfile.company || "";
  userBadge.textContent = `${displayName}${currentProfile.is_admin ? " · admin" : ""}`;
  adminPanel.classList.toggle("hidden", !currentProfile.is_admin);
}

function updateSyncStatus() {
  if (supabaseClient) {
    syncStatus.textContent = "Modalita condivisa con login";
    syncStatus.classList.add("online");
    clearLocalButton.hidden = true;
    return;
  }

  syncStatus.textContent = "Modalita locale";
  clearLocalButton.hidden = false;
}

async function loadBookings() {
  try {
    bookings = supabaseClient ? await getRemoteBookings() : getLocalBookings();
    render();
  } catch (error) {
    showMessage("Non riesco a caricare le prenotazioni. Controlla la configurazione.", "error");
  }
}

async function getRemoteBookings() {
  const { data, error } = await supabaseClient
    .from("bookings")
    .select("id,user_id,name,company,date,start_time,end_time,notes,created_at")
    .order("date", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) throw error;
  return data || [];
}

function getLocalBookings() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

async function handleSubmit(event) {
  event.preventDefault();

  if (supabaseClient && !currentUser) {
    showMessage("Devi accedere prima di prenotare.", "error");
    return;
  }

  const booking = getBookingFromForm();
  const validationMessage = validateBooking(booking);

  if (validationMessage) {
    showMessage(validationMessage, "error");
    return;
  }

  if (hasOverlap(booking, bookings)) {
    showMessage("Sala gia prenotata in quella fascia oraria.", "error");
    return;
  }

  try {
    if (supabaseClient) {
      await saveRemoteBooking(booking);
      await loadBookings();
    } else {
      bookings = saveLocalBooking(booking);
      render();
    }

    bookingForm.reset();
    applyProfile();
    dateInput.value = booking.date;
    startInput.value = booking.end_time;
    endInput.value = addMinutes(booking.end_time, 60);
    currentMonday = getMonday(new Date(`${booking.date}T12:00:00`));
    showMessage("Prenotazione confermata.", "ok");
  } catch (error) {
    const isOverlap = String(error.message || "").includes("overlapping booking");
    showMessage(
      isOverlap
        ? "Questo orario e appena stato occupato da un'altra prenotazione."
        : "Non riesco a salvare la prenotazione. Controlla Supabase.",
      "error"
    );
  }
}

function getBookingFromForm() {
  const formData = new FormData(bookingForm);

  return {
    user_id: currentUser?.id || null,
    name: cleanText(currentProfile?.username || formData.get("name")),
    company: cleanText(currentProfile?.company || formData.get("company")),
    date: formData.get("date"),
    start_time: formData.get("start_time"),
    end_time: formData.get("end_time"),
    notes: cleanText(formData.get("notes")),
  };
}

function validateBooking(booking) {
  if (!booking.name || !booking.company || !booking.date || !booking.start_time || !booking.end_time) {
    return "Compila tutti i campi obbligatori.";
  }

  if (booking.end_time <= booking.start_time) {
    return "L'ora di fine deve essere successiva all'ora di inizio.";
  }

  if (booking.start_time < "08:00" || booking.end_time > "20:00") {
    return "La sala e prenotabile dalle 08:00 alle 20:00.";
  }

  return "";
}

function hasOverlap(candidate, list) {
  return list.some((booking) => {
    if (booking.date !== candidate.date) return false;
    return candidate.start_time < booking.end_time && candidate.end_time > booking.start_time;
  });
}

async function saveRemoteBooking(booking) {
  const { error } = await supabaseClient.from("bookings").insert(booking);
  if (error) throw error;
}

function saveLocalBooking(booking) {
  const nextBookings = [
    ...bookings,
    {
      ...booking,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    },
  ].sort(sortByDateAndTime);

  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextBookings));
  return nextBookings;
}

async function registerUserRequest(event) {
  event.preventDefault();

  if (!currentProfile?.is_admin) {
    showUserMessage("Solo l'amministratore puo registrare utenti.", "error");
    return;
  }

  const formData = new FormData(userForm);
  const password = String(formData.get("password") || "");
  const payload = {
    username: cleanText(formData.get("username")),
    company: cleanText(formData.get("company")),
    email: cleanText(formData.get("email")).toLowerCase(),
    temporary_password_set: password.length > 0,
    created_by: currentUser.id,
  };

  const { error } = await supabaseClient.from("user_requests").insert(payload);

  if (error) {
    showUserMessage("Non riesco a registrare la richiesta utente.", "error");
    return;
  }

  userForm.reset();
  showUserMessage(
    password
      ? "Richiesta salvata. Crea l'utente in Supabase Auth con questa password temporanea."
      : "Richiesta salvata. Invia l'invito/reset password da Supabase Auth.",
    "ok"
  );
}

function subscribeToRealtime() {
  if (!supabaseClient || realtimeChannel) return;

  realtimeChannel = supabaseClient
    .channel("bookings-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, loadBookings)
    .subscribe();

  window.addEventListener("beforeunload", () => {
    if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
  });
}

function unsubscribeFromRealtime() {
  if (!supabaseClient || !realtimeChannel) return;
  supabaseClient.removeChannel(realtimeChannel);
  realtimeChannel = null;
}

function render() {
  bookings = bookings.slice().sort(sortByDateAndTime);
  renderStatus();
  renderCalendar();
  renderList();
}

function renderStatus() {
  const now = new Date();
  const today = formatDate(now);
  const time = now.toTimeString().slice(0, 5);

  const active = bookings.find((item) =>
    item.date === today &&
    item.start_time <= time &&
    item.end_time > time
  );

  if (active) {
    roomStatus.textContent = "Occupata ora";
    roomStatus.className = "status busy";
    nextBooking.textContent = `${active.start_time}-${active.end_time} · ${active.name} · ${active.company}`;
    return;
  }

  roomStatus.textContent = "Libera ora";
  roomStatus.className = "status free";

  const future = bookings.find((item) => `${item.date} ${item.start_time}` > `${today} ${time}`);
  nextBooking.textContent = future
    ? `Prossima: ${formatItalianDate(future.date)} ${future.start_time}-${future.end_time} · ${future.name}`
    : "Nessuna prenotazione imminente";
}

function renderCalendar() {
  calendar.innerHTML = "";

  const days = Array.from({ length: 5 }, (_, index) => {
    const day = new Date(currentMonday);
    day.setDate(currentMonday.getDate() + index);
    return day;
  });

  weekLabel.textContent = `${formatItalianDate(formatDate(days[0]))} - ${formatItalianDate(formatDate(days[4]))}`;

  calendar.append(cell("", "header"));
  days.forEach((day) => {
    calendar.append(cell(day.toLocaleDateString("it-IT", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
    }), "header"));
  });

  const hours = Array.from({ length: CLOSE_HOUR - OPEN_HOUR }, (_, i) => `${String(i + OPEN_HOUR).padStart(2, "0")}:00`);

  hours.forEach((hour) => {
    calendar.append(cell(hour, "time"));

    days.forEach((day) => {
      const date = formatDate(day);
      const slot = document.createElement("div");
      slot.className = "cell";

      bookings
        .filter((item) => item.date === date && item.start_time.slice(0, 2) === hour.slice(0, 2))
        .forEach((item) => slot.append(calendarBooking(item)));

      calendar.append(slot);
    });
  });
}

function renderList() {
  bookingCount.textContent = bookings.length === 1
    ? "1 prenotazione salvata."
    : `${bookings.length} prenotazioni salvate.`;

  if (!bookings.length) {
    bookingList.innerHTML = '<p class="empty">Nessuna prenotazione presente.</p>';
    return;
  }

  bookingList.innerHTML = "";
  bookings.forEach((item) => {
    const row = document.createElement("article");
    row.className = "booking-row";
    row.innerHTML = `
      <strong>${escapeHtml(formatItalianDate(item.date))}<br>${escapeHtml(item.start_time)}-${escapeHtml(item.end_time)}</strong>
      <div>
        <span>${escapeHtml(item.name)}</span>
        <small>${escapeHtml(item.company)}${item.notes ? " · " + escapeHtml(item.notes) : ""}</small>
      </div>
    `;
    bookingList.append(row);
  });
}

function calendarBooking(item) {
  const div = document.createElement("div");
  div.className = "calendar-booking";
  div.innerHTML = `
    <strong>${escapeHtml(item.start_time)}-${escapeHtml(item.end_time)}</strong>
    <span>${escapeHtml(item.name)}</span>
    <small>${escapeHtml(item.company)}</small>
  `;
  return div;
}

function cell(text, className) {
  const div = document.createElement("div");
  div.className = `cell ${className}`;
  div.textContent = text;
  return div;
}

function cleanText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function sortByDateAndTime(a, b) {
  return `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`);
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatItalianDate(dateString) {
  return new Date(`${dateString}T12:00:00`).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function addMinutes(time, minutes) {
  const [hours, mins] = time.split(":").map(Number);
  const date = new Date();
  date.setHours(hours, mins + minutes, 0, 0);
  return date.toTimeString().slice(0, 5);
}

function showMessage(text, type) {
  message.textContent = text;
  message.className = type ? `message ${type}` : "message";
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
