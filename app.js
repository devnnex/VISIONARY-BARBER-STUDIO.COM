const SUPABASE_URL = "https://zwguroyjngzrdbdwvzkg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp3Z3Vyb3lqbmd6cmRiZHd2emtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyODkyMTgsImV4cCI6MjA5ODg2NTIxOH0.JGzaXCojcgN_9aW_93v-Uj1Dw522yhbdX93tJNaE0kM";
const SHOP_SLUG = "demo-barberia";

const hasSupabaseConfig = !SUPABASE_URL.includes("YOUR-PROJECT") && !SUPABASE_ANON_KEY.includes("YOUR_PUBLIC");
const supabaseClient = hasSupabaseConfig ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const IS_ADMIN_PAGE = location.pathname.toLowerCase().endsWith("admin.html");
const IS_CLIENT_PAGE = !IS_ADMIN_PAGE;
let hasSession = false;
let isAdmin = false;
let ownerExists = true;
let ownerStatusKnown = false;
let ownerStatusError = "";

const demo = {
  shop: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "BarberBook Pro",
    slug: SHOP_SLUG,
    logo_url: "",
    hero_image_url: "https://images.unsplash.com/photo-1621605815971-fbc98d665033?auto=format&fit=crop&w=1100&q=80",
    promo_image_url: "",
    hero_title: "Reserva tu corte sin esperar.",
    hero_kicker: "Estilo, precision y agenda inteligente"
  },
  professionals: [
    { id: "p1", name: "Richard Anderson", role: "Barbero master", photo_url: "https://images.unsplash.com/photo-1582893561942-d61adcb2e534?auto=format&fit=crop&w=400&q=80", availability: { weekdays: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:30" }, active: true },
    { id: "p2", name: "David Marcomin", role: "Especialista en fade", photo_url: "https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=400&q=80", availability: { weekdays: [1, 2, 3, 4, 5], start: "10:00", end: "18:00" }, active: true },
    { id: "p3", name: "Jacob Thomas", role: "Barba y clasico", photo_url: "https://images.unsplash.com/photo-1622296089863-eb7fc530daa8?auto=format&fit=crop&w=400&q=80", availability: { weekdays: [2, 3, 4, 5, 6], start: "09:30", end: "17:30" }, active: true }
  ],
  services: [
    { id: "s1", name: "Corte premium", duration_minutes: 45, price: 45000, active: true },
    { id: "s2", name: "Barba y perfilado", duration_minutes: 30, price: 30000, active: true },
    { id: "s3", name: "Corte + barba", duration_minutes: 70, price: 70000, active: true }
  ],
  appointments: []
};

const storeKey = "barberbook-pro-state";
const state = loadState();
state.booking = { professional: null, date: null, time: null, service: null };
state.transactions = state.transactions || [];
let currentStep = 1;
let isSubmittingBooking = false;
let currentView = "home";
let previousMainView = "home";
let knownAppointmentIds = new Set();
let highlightedAppointmentId = "";
let latestReservationId = "";
let reservationAudio = null;
let reservationAlertTimer = null;

function loadState() {
  const saved = localStorage.getItem(storeKey);
  if (!saved) return structuredClone(demo);
  return { ...structuredClone(demo), ...JSON.parse(saved) };
}

function saveState() {
  localStorage.setItem(storeKey, JSON.stringify({
    shop: state.shop,
    professionals: state.professionals,
    services: state.services,
    appointments: state.appointments,
    transactions: state.transactions
  }));
}

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const money = (value) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(value || 0));
const todayISO = () => new Date().toISOString().slice(0, 10);

document.addEventListener("DOMContentLoaded", async () => {
  document.body.classList.add(IS_ADMIN_PAGE ? "admin-page" : "client-page");
  lucide.createIcons();
  bindNavigation();
  bindBooking();
  if (IS_ADMIN_PAGE) bindAdmin();
  bindTheme();
  await bootstrapData();
  await bootstrapAuth();
  if (IS_ADMIN_PAGE) showView("admin");
  rememberKnownAppointments();
  renderAll();
  subscribeRealtime();
});

async function bootstrapData() {
  if (!supabaseClient) return;
  const { data: shop } = await supabaseClient.from("barber_shops").select("*").eq("slug", SHOP_SLUG).single();
  if (!shop) return toast("No encontre la barberia en Supabase. Ejecuta supabase.sql primero.");
  state.shop = shop;
  await refreshOwnerStatus();
  const [{ data: professionals }, { data: services }] = await Promise.all([
    supabaseClient.from("professionals").select("*").eq("shop_id", shop.id).order("created_at"),
    supabaseClient.from("services").select("*").eq("shop_id", shop.id).order("created_at")
  ]);
  state.professionals = professionals || [];
  state.services = services || [];
  await refreshAppointments();
  if (IS_ADMIN_PAGE) await refreshTransactions();
}

async function refreshTransactions() {
  if (!supabaseClient || !state.shop?.id) return;
  const { data, error } = await supabaseClient
    .from("professional_transactions")
    .select("*")
    .eq("shop_id", state.shop.id)
    .order("transaction_date", { ascending: false });
  if (!error) state.transactions = data || [];
}

function normalizeAppointment(row) {
  return {
    ...row,
    professional_name: row.professional_name || row.professionals?.name,
    service_name: row.service_name || row.services?.name,
    service_price: row.service_price || row.services?.price
  };
}

async function bootstrapAuth() {
  if (!supabaseClient) return;
  hasSession = IS_ADMIN_PAGE;
  isAdmin = IS_ADMIN_PAGE;
  if (IS_ADMIN_PAGE) await refreshAppointments();
}

async function syncAuthState(session) {
  hasSession = Boolean(session);
  isAdmin = false;
  if (!hasSession) return;

  if (!ownerExists) await claimFirstOwner();
  isAdmin = await checkAdminProfile();
  if (isAdmin) await refreshAppointments();
}

async function checkAdminProfile() {
  if (!supabaseClient || !state.shop?.id) return false;
  const { data: userData, error: userError } = await supabaseClient.auth.getUser();
  const userId = userData?.user?.id;

  if (userError || !userId) {
    if (userError) toast(readableError(userError));
    return false;
  }

  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, role, shop_id")
    .eq("id", userId)
    .eq("shop_id", state.shop.id)
    .maybeSingle();

  if (error) {
    toast(readableError(error));
    return false;
  }
  return Boolean(data && ["owner", "admin"].includes(data.role));
}

async function refreshOwnerStatus() {
  if (!supabaseClient || !state.shop?.id) return;
  const { data, error } = await supabaseClient.rpc("shop_has_owner", { target_shop_id: state.shop.id });
  ownerStatusKnown = !error;
  ownerStatusError = error ? error.message : "";
  ownerExists = error ? true : Boolean(data);
}

async function refreshAppointments() {
  if (!supabaseClient || !state.shop?.id) return;
  if (IS_ADMIN_PAGE) {
    const { data } = await supabaseClient
      .from("appointments")
      .select("*, professionals(name), services(name, price, duration_minutes)")
      .eq("shop_id", state.shop.id)
      .order("appointment_date", { ascending: false });
    state.appointments = (data || []).map(normalizeAppointment);
    return;
  }
  const { data } = await supabaseClient.rpc("get_unavailable_slots", { target_shop_id: state.shop.id });
  state.appointments = (data || []).map((row) => ({
    id: `${row.professional_id}-${row.appointment_date}-${row.start_time}`,
    shop_id: state.shop.id,
    professional_id: row.professional_id,
    appointment_date: row.appointment_date,
    start_time: String(row.start_time).slice(0, 5),
    status: "scheduled"
  }));
}

function subscribeRealtime() {
  if (!supabaseClient) return;
  supabaseClient
    .channel(`shop-${state.shop.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "appointments", filter: `shop_id=eq.${state.shop.id}` }, async (payload) => {
      const newId = payload?.new?.id;
      const isNewReservation = payload.eventType === "INSERT" && newId && !knownAppointmentIds.has(newId);
      await refreshAppointments();
      rememberKnownAppointments();
      handleRealtimeBookingConflict();
      renderAll();
      if (IS_ADMIN_PAGE && isNewReservation) {
        startReservationAlert(newId);
      } else if (IS_ADMIN_PAGE) {
        toast("Citas actualizadas.");
      }
    })
    .subscribe();
}

function bindNavigation() {
  $("#openMenu").addEventListener("click", openMenu);
  $("#overlay").addEventListener("click", closeMenu);
  $("#goAdmin").addEventListener("click", () => {
    if (IS_ADMIN_PAGE) showView("admin");
    else location.href = "admin.html";
  });
  $$("[data-view]").forEach((btn) => btn.addEventListener("click", () => {
    if (btn.dataset.view === "admin" && IS_CLIENT_PAGE) location.href = "admin.html";
    else showView(btn.dataset.view);
  }));
  $("#backFromAdmin").addEventListener("click", () => {
    if (IS_ADMIN_PAGE) location.href = "index.html";
    else showView(previousMainView || "home");
  });
}

function openMenu() {
  $("#sideMenu").classList.add("open");
  $("#overlay").classList.add("show");
}

function closeMenu() {
  $("#sideMenu").classList.remove("open");
  $("#overlay").classList.remove("show");
}

function showView(view) {
  if (view === "admin" && IS_CLIENT_PAGE) {
    location.href = "admin.html";
    return;
  }
  if (view !== "admin" && currentView !== "admin") previousMainView = view;
  if (view === "admin" && currentView !== "admin") previousMainView = currentView || "home";
  currentView = view;
  $$(".view").forEach((el) => el.classList.remove("active"));
  $(`#${view}View`).classList.add("active");
  $$(".menu-link").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === view));
  $("#mainNav").classList.toggle("active", view !== "admin");
  $("#adminNav").classList.toggle("active", view === "admin");
  closeMenu();
  if (view === "admin") $("#goAdmin").classList.remove("has-alert");
  lucide.createIcons();
}

function bindTheme() {
  const saved = localStorage.getItem("barberbook-theme") || "light";
  document.documentElement.dataset.theme = saved;
  $("#themeToggle").checked = saved === "dark";
  $("#themeToggle").addEventListener("change", (event) => {
    const theme = event.target.checked ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("barberbook-theme", theme);
  });
}

function bindBooking() {
  $("#resetBooking").addEventListener("click", resetBooking);
  $("#bookingForm").addEventListener("submit", createAppointment);
  $("#prevStep").addEventListener("click", previousBookingStep);
  $("#nextStep").addEventListener("click", nextBookingStep);
  $("#closeSuccess").addEventListener("click", () => $("#successLayer").classList.remove("show"));
  $("#closeConflict").addEventListener("click", () => $("#conflictLayer").classList.remove("show"));
}

function bindAdmin() {
  $$(".admin-tab").forEach((tab) => tab.addEventListener("click", () => {
    $$(".admin-tab").forEach((el) => el.classList.remove("active"));
    $$(".admin-screen").forEach((el) => el.classList.remove("active"));
    tab.classList.add("active");
    $(`#${tab.dataset.admin}Admin`).classList.add("active");
    closeMenu();
    lucide.createIcons();
  }));

  $("#professionalForm").addEventListener("submit", saveProfessional);
  $("#serviceForm").addEventListener("submit", saveService);
  $("#brandingForm").addEventListener("submit", saveBranding);
  $("#settlementForm").addEventListener("submit", saveSettlement);
  bindBrandPreviews();
  $("#adminLoginForm").addEventListener("submit", loginAdmin);
  $("#adminLogout").addEventListener("click", logoutAdmin);
  $("#toggleAdminPassword").addEventListener("click", toggleAdminPassword);
  $("#openProfessionalModal").addEventListener("click", () => openProfessionalModal());
  $("#openServiceModal").addEventListener("click", () => openServiceModal());
  $$("[data-close-modal]").forEach((btn) => btn.addEventListener("click", () => closeModal(btn.dataset.closeModal)));
  ["appointmentSearch", "appointmentProfessionalFilter", "appointmentStatusFilter"].forEach((id) => $(`#${id}`).addEventListener("input", renderAppointments));
  ["accountingRange", "accountingDate", "accountingFilter"].forEach((id) => $(`#${id}`).addEventListener("input", renderMetrics));
  ["professionalSearch"].forEach((id) => $(`#${id}`).addEventListener("input", renderProfessionalsAdmin));
  ["serviceSearch"].forEach((id) => $(`#${id}`).addEventListener("input", renderServicesAdmin));
  $("#seedNotification").addEventListener("click", () => {
    state.appointments.unshift(makeAppointment({
      professional: state.professionals[0],
      service: state.services[0],
      date: todayISO(),
      time: "15:30",
      name: "Cliente prueba",
      phone: "3000000000"
    }));
    saveState();
    renderAll();
    $("#goAdmin").classList.add("has-alert");
    startReservationAlert(state.appointments[0].id);
    toast("Notificacion de reserva recibida.");
  });
  $("#viewNewReservation").addEventListener("click", viewLatestReservation);
  $("#stopReservationAlert").addEventListener("click", stopReservationAlert);
}

function renderAll() {
  hydrateAvailability();
  renderBrand();
  renderBooking();
  if (IS_ADMIN_PAGE) renderAdmin();
  lucide.createIcons();
}

function renderBrand() {
  $("#topShopName").textContent = state.shop.name;
  $("#menuShopName").textContent = state.shop.name;
  if ($("#heroTitle")) $("#heroTitle").textContent = state.shop.hero_title;
  if ($("#heroKicker")) $("#heroKicker").textContent = state.shop.hero_kicker || "Reserva inteligente";
  if ($("#heroImage")) $("#heroImage").src = state.shop.hero_image_url || demo.shop.hero_image_url;
  const logo = state.shop.logo_url;
  [$("#topLogo"), $("#menuLogo")].forEach((el) => {
    el.innerHTML = logo ? `<img src="${logo}" alt="${state.shop.name}">` : initials(state.shop.name);
  });
  if ($("#brandName")) $("#brandName").value = state.shop.name;
  if ($("#brandHeroTitle")) $("#brandHeroTitle").value = state.shop.hero_title;
  setBrandPreview("brandLogoPreview", state.shop.logo_url);
  setBrandPreview("brandHeroPreview", state.shop.hero_image_url);
  setBrandPreview("brandPromoPreview", state.shop.promo_image_url);
}

function renderBooking() {
  renderStepper();
  renderBarbers();
  renderDates();
  renderTimes();
  renderServices();
  renderSummary();
}

function renderStepper() {
  $$("#stepper span").forEach((span, index) => span.classList.toggle("done", index < currentStep));
  $$(".booking-step").forEach((step) => step.classList.toggle("active", Number(step.dataset.step) === currentStep));
  $("#prevStep").disabled = currentStep === 1 || isSubmittingBooking;
  $("#nextStep").style.display = currentStep === 4 ? "none" : "inline-flex";
  $("#nextStep").disabled = !canAdvanceFromStep(currentStep) || isSubmittingBooking;
}

function renderBarbers() {
  $("#barberList").innerHTML = activeProfessionals().map((barber) => `
    <button class="barber-card ${state.booking.professional?.id === barber.id ? "selected" : ""}" data-id="${barber.id}">
      <img src="${barber.photo_url || demo.professionals[0].photo_url}" alt="${barber.name}">
      <div><strong>${barber.name}</strong><span>${barber.role || "Profesional"} · <b class="rating-star">★ 5.0</b></span></div>
      <i data-lucide="chevron-right"></i>
    </button>
  `).join("");
  $$("#barberList .barber-card").forEach((card) => card.addEventListener("click", () => {
    state.booking.professional = state.professionals.find((item) => item.id === card.dataset.id);
    currentStep = 2;
    renderBooking();
  }));
}

function renderDates() {
  const dates = [...Array(14)].map((_, index) => {
    const date = new Date();
    date.setDate(date.getDate() + index);
    return date;
  });
  if (state.booking.professional && (!state.booking.date || !isProfessionalAvailableOnDate(state.booking.professional, state.booking.date))) {
    const firstAvailable = dates.find((date) => isProfessionalAvailableOnDate(state.booking.professional, date.toISOString().slice(0, 10)));
    state.booking.date = firstAvailable ? firstAvailable.toISOString().slice(0, 10) : null;
    state.booking.time = null;
  }
  $("#dateStrip").innerHTML = dates.map((date) => {
    const iso = date.toISOString().slice(0, 10);
    const unavailable = state.booking.professional && !isProfessionalAvailableOnDate(state.booking.professional, iso);
    return `<button class="date-btn ${state.booking.date === iso ? "selected" : ""}" ${unavailable ? "disabled" : ""} data-date="${iso}">
      <small>${date.toLocaleDateString("es-CO", { weekday: "short" })}</small>
      <b>${date.getDate()}</b>
      <small>${unavailable ? "Cerrado" : date.toLocaleDateString("es-CO", { month: "short" })}</small>
    </button>`;
  }).join("");
  $$("#dateStrip .date-btn:not(:disabled)").forEach((btn) => btn.addEventListener("click", () => {
    if (state.booking.date !== btn.dataset.date) btn.classList.add("pulse-select");
    state.booking.date = btn.dataset.date;
    state.booking.time = null;
    renderBooking();
  }));
  if (!state.booking.date) state.booking.date = dates[0].toISOString().slice(0, 10);
}

function renderTimes() {
  const times = getAvailableTimes(state.booking.professional, state.booking.date).filter((time) => !isBooked(state.booking.professional?.id, state.booking.date, time));
  if (state.booking.time && !times.includes(state.booking.time)) state.booking.time = null;
  $("#timeGrid").innerHTML = times.map((time) => {
    return `<button class="time-btn ${state.booking.time === time ? "selected" : ""}" data-time="${time}">
      ${formatTimePretty(time)}<small>Libre</small>
    </button>`;
  }).join("") || `<div class="empty-state">No quedan horarios disponibles para esta fecha.</div>`;
  $$("#timeGrid .time-btn:not(:disabled)").forEach((btn) => btn.addEventListener("click", () => {
    state.booking.time = btn.dataset.time;
    currentStep = 3;
    renderBooking();
  }));
}

function renderServices() {
  $("#serviceList").innerHTML = activeServices().map((service) => `
    <button class="service-card ${state.booking.service?.id === service.id ? "selected" : ""}" data-id="${service.id}">
      <div><strong>${service.name}</strong><span>${service.duration_minutes} min · <b class="rating-star">★ 5.0</b></span></div>
      <strong>${money(service.price)}</strong>
    </button>
  `).join("");
  $$("#serviceList .service-card").forEach((card) => card.addEventListener("click", () => {
    state.booking.service = state.services.find((item) => item.id === card.dataset.id);
    currentStep = 4;
    renderBooking();
  }));
}

function renderSummary() {
  const { professional, date, time, service } = state.booking;
  $("#bookingSummary").innerHTML = professional && date && time && service
    ? `<strong>Resumen</strong><br>${professional.name}<br>${new Date(date + "T00:00:00").toLocaleDateString("es-CO", { dateStyle: "full" })} a las ${formatTimePretty(time)}<br>${service.name} - ${money(service.price)}`
    : "Completa los pasos anteriores para ver el resumen.";
}

function canAdvanceFromStep(step) {
  if (step === 1) return Boolean(state.booking.professional);
  if (step === 2) return Boolean(state.booking.date && state.booking.time);
  if (step === 3) return Boolean(state.booking.service);
  return true;
}

function nextBookingStep() {
  if (!canAdvanceFromStep(currentStep)) return toast("Completa este paso para continuar.");
  currentStep = Math.min(4, currentStep + 1);
  renderBooking();
}

function previousBookingStep() {
  currentStep = Math.max(1, currentStep - 1);
  renderBooking();
}

async function createAppointment(event) {
  event.preventDefault();
  if (isSubmittingBooking) return;
  const { professional, date, time, service } = state.booking;
  if (!professional || !date || !time || !service) return toast("Completa la reserva antes de confirmar.");
  if (isBooked(professional.id, date, time)) return showBookingConflict();
  isSubmittingBooking = true;
  setBusy(true);

  const payload = makeAppointment({
    professional,
    service,
    date,
    time,
    name: $("#customerName").value.trim(),
    phone: $("#customerPhone").value.trim()
  });

  try {
    if (supabaseClient) {
      const { error } = await supabaseClient.from("appointments").insert({
        shop_id: state.shop.id,
        professional_id: professional.id,
        service_id: service.id,
        appointment_date: date,
        start_time: time,
        customer_name: payload.customer_name,
        customer_phone: payload.customer_phone,
        status: "scheduled",
        total_price: service.price
      });
      if (error) {
        if (error.code === "23505") showBookingConflict();
        else toast(error.message);
        return;
      }
      state.appointments.unshift(payload);
      await refreshAppointments();
    } else {
      state.appointments.unshift(payload);
      saveState();
    }

    if (IS_ADMIN_PAGE) $("#goAdmin").classList.add("has-alert");
    resetBooking();
    renderAll();
    showSuccess();
  } finally {
    isSubmittingBooking = false;
    setBusy(false);
    renderBooking();
  }
}

function makeAppointment({ professional, service, date, time, name, phone }) {
  return {
    id: crypto.randomUUID(),
    shop_id: state.shop.id,
    professional_id: professional.id,
    professional_name: professional.name,
    service_id: service.id,
    service_name: service.name,
    service_price: Number(service.price),
    total_price: Number(service.price),
    appointment_date: date,
    start_time: time,
    customer_name: name,
    customer_phone: phone,
    status: "scheduled",
    created_at: new Date().toISOString()
  };
}

function resetBooking() {
  state.booking = { professional: null, date: todayISO(), time: null, service: null };
  currentStep = 1;
  $("#bookingForm").reset();
  renderBooking();
}

function isBooked(professionalId, date, time) {
  if (!professionalId || !date || !time) return false;
  return state.appointments.some((appt) =>
    appt.professional_id === professionalId &&
    appt.appointment_date === date &&
    appt.start_time === time &&
    ["scheduled", "confirmed", "completed"].includes(appt.status)
  );
}

function renderAdmin() {
  renderAdminAuth();
  const locked = false;
  $("#adminSecure").classList.toggle("locked", locked);
  $("#adminLock").classList.toggle("show", locked);
  $$("#adminNav .admin-tab").forEach((tab) => tab.disabled = locked);
  if (locked) return;
  renderMetrics();
  renderAppointments();
  renderProfessionalsAdmin();
  renderServicesAdmin();
}

function renderAdminAuth() {
  $("#adminLoginForm").classList.remove("show");
  $("#adminLock").classList.remove("show");
  isAdmin = IS_ADMIN_PAGE;
  hasSession = IS_ADMIN_PAGE;
  if (!$("#adminLoginForm h3")) return;
  $("#adminLoginForm h3").textContent = adminAuthTitle();
  $("#adminEmail").disabled = hasSession;
  $("#adminPassword").disabled = hasSession;
  $("#toggleAdminPassword").disabled = hasSession;
  $("#adminLogout").classList.toggle("is-hidden", !hasSession);
  $("#adminLoginForm .primary").classList.toggle("is-hidden", hasSession);
  $("#adminLoginForm .primary").innerHTML = !ownerStatusKnown || ownerExists ? `<i data-lucide="log-in"></i>Entrar` : `<i data-lucide="user-plus"></i>Crear jefe`;
  $("#adminAuthHint").textContent = adminAuthHint();
}

async function loginAdmin(event) {
  event.preventDefault();
  if (!supabaseClient) return toast("Modo demo activo.");
  const email = $("#adminEmail").value.trim().toLowerCase();
  const password = $("#adminPassword").value;
  const submit = $("#adminLoginForm .primary");

  if (!email || !password) return toast("Escribe el email y la contrasena.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast("El email no tiene un formato valido.");

  submit.disabled = true;
  submit.innerHTML = `<span class="mini-loader"></span>${ownerExists ? "Entrando" : "Creando jefe"}`;
  await refreshOwnerStatus();
  renderAdminAuth();
  try {
    if (!ownerStatusKnown) return toast("Falta ejecutar el SQL actualizado de funciones admin en Supabase.");
    if (!ownerExists) return createFirstOwner({ email, password });
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) return toast(authErrorMessage(error));
    await refreshOwnerStatus();
    await syncAuthState((await supabaseClient.auth.getSession()).data.session);
    $("#adminPassword").value = "";
    toast(isAdmin ? "Admin conectado." : "Sesion iniciada, pero este usuario no esta vinculado como jefe de esta barberia.");
  } catch (error) {
    toast(readableError(error));
  } finally {
    submit.disabled = false;
    renderAdminAuth();
  }
}

async function createFirstOwner(credentials = {}) {
  const email = (credentials.email || $("#adminEmail").value).trim().toLowerCase();
  const password = credentials.password || $("#adminPassword").value;
  if (!email || !password) return toast("Escribe email y contrasena para crear el jefe.");
  if (password.length < 6) return toast("La contrasena debe tener minimo 6 caracteres.");

  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: { data: { full_name: "Jefe principal", shop_id: state.shop.id } }
  });
  if (error) {
    const message = (error.message || "").toLowerCase();
    if (message.includes("already registered") || message.includes("already exists")) {
      const { error: loginError } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (loginError) return toast(authErrorMessage(loginError));
      await claimFirstOwner();
      await syncAuthState((await supabaseClient.auth.getSession()).data.session);
      $("#adminPassword").value = "";
      toast("Jefe conectado y vinculado.");
      return;
    }
    return toast(authErrorMessage(error));
  }

  if (data.session) {
    await claimFirstOwner();
    await syncAuthState(data.session);
    $("#adminPassword").value = "";
    toast("Jefe creado y conectado.");
    return;
  }

  toast("Jefe creado. Revisa el correo de confirmacion y luego inicia sesion.");
}

async function claimFirstOwner() {
  if (!supabaseClient || !state.shop?.id) return;
  const { error } = await supabaseClient.rpc("claim_first_owner", {
    target_shop_id: state.shop.id,
    full_name: "Jefe principal"
  });
  if (error) {
    toast(readableError(error));
    return;
  }
  await refreshOwnerStatus();
}

async function logoutAdmin() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  toast("Sesion cerrada.");
}

function toggleAdminPassword() {
  const input = $("#adminPassword");
  const visible = input.type === "text";
  input.type = visible ? "password" : "text";
  $("#toggleAdminPassword").innerHTML = `<i data-lucide="${visible ? "eye" : "eye-off"}"></i>`;
  $("#toggleAdminPassword").setAttribute("aria-label", visible ? "Ver contrasena" : "Ocultar contrasena");
  lucide.createIcons();
}

function authErrorMessage(error) {
  const message = (error?.message || "").toLowerCase();
  if (message.includes("invalid login credentials")) {
    return ownerExists
      ? "Credenciales invalidas. Verifica email/contrasena o crea/restablece el usuario en Supabase Auth."
      : "Todavia no existe jefe. Usa este formulario para crear el primer jefe.";
  }
  if (message.includes("user already registered")) return "Ese email ya existe. Inicia sesion con esa cuenta.";
  return readableError(error) || "No se pudo iniciar sesion.";
}

function adminAuthTitle() {
  if (isAdmin) return "Sesion admin activa";
  if (hasSession) return "Usuario sin permisos";
  if (!ownerStatusKnown) return "Configurar acceso admin";
  return ownerExists ? "Acceso administrador" : "Crear primer jefe";
}

function adminAuthHint() {
  if (!supabaseClient) return "Modo demo local activo.";
  if (isAdmin) return "Ya puedes administrar citas, profesionales, servicios y marca.";
  if (hasSession) return "La sesion existe, pero este usuario no tiene perfil owner/admin en public.profiles para esta barberia. Cierra sesion o vincula este usuario.";
  if (!ownerStatusKnown) return `No pude verificar si existe jefe. Ejecuta supabase.sql actualizado. ${ownerStatusError}`;
  return ownerExists
    ? "Esta barberia ya tiene jefe. Solo puedes iniciar sesion con esa cuenta."
    : "Esta barberia no tiene jefe. Escribe email y contrasena para crear el primero.";
}

function renderMetrics() {
  if (!$("#accountingDate").value) $("#accountingDate").value = todayISO();
  const range = getAccountingRange();
  const appointmentsInRange = state.appointments.filter((a) => isDateInRange(a.appointment_date, range));
  const transactionsInRange = (state.transactions || []).filter((t) => isDateInRange(t.transaction_date, range));
  const scheduled = appointmentsInRange.filter((a) => a.status === "scheduled").length;
  const completed = appointmentsInRange.filter((a) => a.status === "completed").length;
  const revenue = appointmentsInRange.filter((a) => a.status === "completed").reduce((sum, a) => sum + Number(a.total_price || a.service_price || 0), 0);
  const deductions = transactionsInRange.filter((t) => t.transaction_type === "deduction").reduce((sum, t) => sum + Number(t.amount || 0), 0);
  $("#metrics").innerHTML = [
    ["Citas agendadas", scheduled],
    ["Servicios atendidos", completed],
    ["Ingresos realizados", money(revenue)],
    ["Descuentos", money(deductions)]
  ].map(([label, value]) => `<article class="metric"><span>${label}</span><strong>${value}</strong></article>`).join("");

  const previousAccounting = $("#accountingFilter").value || "all";
  $("#accountingFilter").innerHTML = `<option value="all">Todos los barberos</option>` + activeProfessionals().map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
  $("#accountingFilter").value = previousAccounting;
  const selected = $("#accountingFilter").value || "all";
  const rows = activeProfessionals().filter((barber) => selected === "all" || barber.id === selected).map((barber) => {
    const appointments = appointmentsInRange.filter((a) => a.professional_id === barber.id);
    const done = appointments.filter((a) => a.status === "completed");
    const movements = transactionsInRange.filter((t) => t.professional_id === barber.id);
    const gross = done.reduce((s, a) => s + Number(a.total_price || a.service_price || 0), 0);
    const deducted = movements.filter((t) => t.transaction_type === "deduction").reduce((s, t) => s + Number(t.amount || 0), 0);
    const paid = movements.filter((t) => t.transaction_type === "payout").reduce((s, t) => s + Number(t.amount || 0), 0);
    const net = Math.max(gross - deducted - paid, 0);
    return `<tr>
      <td><strong>${barber.name}</strong><small>${availabilityLabel(barber)}</small></td>
      <td>${done.length}</td>
      <td>${money(gross)}</td>
      <td>${money(deducted)}</td>
      <td>${money(paid)}</td>
      <td><b class="net-value">${money(net)}</b></td>
      <td>
        <div class="row-actions">
          <button class="small-btn" data-settle="deduction" data-prof="${barber.id}">Descontar</button>
          <button class="small-btn ok-action" data-settle="payout" data-prof="${barber.id}">Liquidar</button>
        </div>
      </td>
    </tr>`;
  });
  $("#accountingRows").innerHTML = rows.join("") || `<tr><td colspan="7">Sin datos para este rango.</td></tr>`;
  $$("[data-settle]").forEach((btn) => btn.addEventListener("click", () => openSettlementModal(btn.dataset.prof, btn.dataset.settle)));
  $("#accountingDate").classList.toggle("is-hidden", $("#accountingRange").value !== "custom");
  lucide.createIcons();
}

function renderAppointments() {
  const previousProfessional = $("#appointmentProfessionalFilter").value || "all";
  const previousStatus = $("#appointmentStatusFilter").value || "active";
  $("#appointmentProfessionalFilter").innerHTML = `<option value="all">Todos los profesionales</option>` + activeProfessionals().map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
  $("#appointmentProfessionalFilter").value = previousProfessional;
  $("#appointmentStatusFilter").innerHTML = `
    <option value="active">Pendientes</option>
    <option value="all">Todas las citas</option>
    <option value="scheduled">Agendadas</option>
    <option value="confirmed">Confirmadas</option>
    <option value="completed">Atendidas</option>
    <option value="cancelled">Canceladas</option>
    <option value="no_show">No asistio</option>
  `;
  $("#appointmentStatusFilter").value = previousStatus;
  const query = ($("#appointmentSearch").value || "").toLowerCase();
  const prof = $("#appointmentProfessionalFilter").value || "all";
  const statusFilter = $("#appointmentStatusFilter").value || "active";
  const rows = state.appointments.filter((appt) => {
    const text = `${appt.customer_name || ""} ${appt.customer_phone || ""} ${appt.service_name || ""} ${appt.professional_name || findName(state.professionals, appt.professional_id)}`.toLowerCase();
    const statusMatch = statusFilter === "all"
      || (statusFilter === "active" && ["scheduled", "confirmed"].includes(appt.status))
      || appt.status === statusFilter;
    return (prof === "all" || appt.professional_id === prof) && statusMatch && text.includes(query);
  });
  $("#appointmentCount").innerHTML = `<i data-lucide="star"></i>${rows.length} citas`;
  $("#appointmentList").innerHTML = rows.map((appt) => `
    <article class="appointment-card status-${appt.status} ${highlightedAppointmentId === appt.id ? "is-highlighted" : ""}" data-open-appt="${appt.id}">
      <div class="appointment-date">
        <small>${new Date(appt.appointment_date + "T00:00:00").toLocaleDateString("es-CO", { month: "short" })}</small>
        <strong>${new Date(appt.appointment_date + "T00:00:00").getDate()}</strong>
        <span>${formatTimePretty(appt.start_time)}</span>
      </div>
      <div class="appointment-main">
        <strong>${appt.customer_name || "Horario ocupado"}</strong>
        <span>${appt.customer_phone || "Datos privados"}</span>
        <p>${appt.professional_name || findName(state.professionals, appt.professional_id)} - ${appt.service_name || findName(state.services, appt.service_id)}</p>
        <small>${formatDateLong(appt.appointment_date)} · ${formatTimeRange(appt.start_time, appt.services?.duration_minutes || appt.duration_minutes || 45)}</small>
      </div>
      <div class="appointment-money">
        <small class="status-pill">${statusLabel(appt.status)}</small>
        <strong>${money(appt.total_price || appt.service_price || 0)}</strong>
      </div>
      <select data-status="${appt.id}">
        ${["scheduled", "confirmed", "completed", "cancelled", "no_show"].map((status) => `<option ${appt.status === status ? "selected" : ""} value="${status}">${statusLabel(status)}</option>`).join("")}
      </select>
    </article>
  `).join("") || `<span>No hay reservas con esos filtros.</span>`;
  $$("[data-open-appt]").forEach((card) => card.addEventListener("click", () => openAppointmentDetail(card.dataset.openAppt)));
  $$("[data-status]").forEach((select) => {
    select.addEventListener("click", (event) => event.stopPropagation());
    select.addEventListener("change", () => updateAppointmentStatus(select.dataset.status, select.value));
  });
  lucide.createIcons();
}

async function updateAppointmentStatus(id, status) {
  if (supabaseClient) {
    const { error } = await supabaseClient.from("appointments").update({ status }).eq("id", id);
    if (error) return toast(error.message);
    await bootstrapData();
  } else {
    state.appointments = state.appointments.map((appt) => appt.id === id ? { ...appt, status } : appt);
    saveState();
  }
  renderAdmin();
}

function renderProfessionalsAdmin() {
  const query = ($("#professionalSearch").value || "").toLowerCase();
  const rows = state.professionals.filter((p) => `${p.name} ${p.role || ""}`.toLowerCase().includes(query));
  $("#professionalCount").textContent = `${rows.filter((p) => p.active !== false).length} activos`;
  $("#professionalRows").innerHTML = rows.map((p) => `
    <article class="data-row professional-row">
      <img src="${p.photo_url || demo.professionals[0].photo_url}" alt="${p.name}">
      <div><strong>${p.name}</strong><span>${p.role || ""}</span><small>${availabilityLabel(p)}</small></div>
      <div class="row-actions">
        <button class="small-btn" data-edit-prof="${p.id}">Editar</button>
        <button class="small-btn danger" data-delete-prof="${p.id}">Eliminar</button>
      </div>
    </article>
  `).join("") || `<span>No hay profesionales con ese filtro.</span>`;
  $$("[data-edit-prof]").forEach((btn) => btn.addEventListener("click", () => fillProfessional(btn.dataset.editProf)));
  $$("[data-delete-prof]").forEach((btn) => btn.addEventListener("click", () => deleteProfessional(btn.dataset.deleteProf)));
}

async function saveProfessional(event) {
  event.preventDefault();
  const id = $("#professionalId").value || crypto.randomUUID();
  const photoUrl = await maybeUpload("professionalPhotoFile", "professional", $("#professionalPhoto").value.trim());
  const row = {
    id,
    shop_id: state.shop.id,
    name: $("#professionalName").value.trim(),
    role: $("#professionalRole").value.trim(),
    photo_url: photoUrl,
    availability: getAvailabilityFromForm(),
    active: true
  };
  if (supabaseClient) {
    const { error } = await supabaseClient.from("professionals").upsert(row);
    if (error) return toast(error.message);
    await bootstrapData();
  } else {
    state.professionals = upsertById(state.professionals, row);
    saveState();
  }
  event.target.reset();
  $("#professionalId").value = "";
  closeModal("professionalModal");
  renderAll();
}

function fillProfessional(id) {
  const row = state.professionals.find((item) => item.id === id);
  openProfessionalModal(row);
}

function openProfessionalModal(row = null) {
  $("#professionalForm").reset();
  $("#professionalId").value = "";
  $("#professionalStartTime").value = "09:00";
  $("#professionalEndTime").value = "18:30";
  setWeekdays([1, 2, 3, 4, 5, 6]);
  $("#professionalModalTitle").textContent = row ? "Editar profesional" : "Agregar profesional";
  if (row) {
    const availability = normalizeAvailability(row.availability);
  $("#professionalId").value = row.id;
  $("#professionalName").value = row.name;
  $("#professionalRole").value = row.role || "";
  $("#professionalPhoto").value = row.photo_url || "";
    $("#professionalStartTime").value = availability.start;
    $("#professionalEndTime").value = availability.end;
    setWeekdays(availability.weekdays);
  }
  openModal("professionalModal");
}

async function deleteProfessional(id) {
  if (supabaseClient) {
    const { error } = await supabaseClient.from("professionals").update({ active: false }).eq("id", id);
    if (error) return toast(error.message);
    await bootstrapData();
  } else {
    state.professionals = state.professionals.map((p) => p.id === id ? { ...p, active: false } : p);
    saveState();
  }
  renderAll();
}

function renderServicesAdmin() {
  const query = ($("#serviceSearch").value || "").toLowerCase();
  const rows = state.services.filter((s) => `${s.name} ${s.price} ${s.duration_minutes}`.toLowerCase().includes(query));
  $("#serviceCount").textContent = `${rows.filter((s) => s.active !== false).length} servicios`;
  $("#serviceRows").innerHTML = rows.map((s) => `
    <article class="data-row service-row">
      <div><strong>${s.name} <b class="rating-star">★ 5.0</b></strong><span>${s.duration_minutes} min - ${money(s.price)}</span></div>
      <div class="row-actions">
        <button class="small-btn" data-edit-service="${s.id}">Editar</button>
        <button class="small-btn danger" data-delete-service="${s.id}">Eliminar</button>
      </div>
    </article>
  `).join("") || `<span>No hay servicios con ese filtro.</span>`;
  $$("[data-edit-service]").forEach((btn) => btn.addEventListener("click", () => fillService(btn.dataset.editService)));
  $$("[data-delete-service]").forEach((btn) => btn.addEventListener("click", () => deleteService(btn.dataset.deleteService)));
}

async function saveService(event) {
  event.preventDefault();
  const id = $("#serviceId").value || crypto.randomUUID();
  const row = {
    id,
    shop_id: state.shop.id,
    name: $("#serviceName").value.trim(),
    duration_minutes: Number($("#serviceDuration").value),
    price: Number($("#servicePrice").value),
    active: true
  };
  if (supabaseClient) {
    const { error } = await supabaseClient.from("services").upsert(row);
    if (error) return toast(error.message);
    await bootstrapData();
  } else {
    state.services = upsertById(state.services, row);
    saveState();
  }
  event.target.reset();
  $("#serviceId").value = "";
  closeModal("serviceModal");
  renderAll();
}

function fillService(id) {
  const row = state.services.find((item) => item.id === id);
  openServiceModal(row);
}

function openServiceModal(row = null) {
  $("#serviceForm").reset();
  $("#serviceId").value = "";
  $("#serviceModalTitle").textContent = row ? "Editar servicio" : "Agregar servicio";
  if (row) {
  $("#serviceId").value = row.id;
  $("#serviceName").value = row.name;
  $("#serviceDuration").value = row.duration_minutes;
  $("#servicePrice").value = row.price;
  }
  openModal("serviceModal");
}

async function deleteService(id) {
  if (supabaseClient) {
    const { error } = await supabaseClient.from("services").update({ active: false }).eq("id", id);
    if (error) return toast(error.message);
    await bootstrapData();
  } else {
    state.services = state.services.map((s) => s.id === id ? { ...s, active: false } : s);
    saveState();
  }
  renderAll();
}

function bindBrandPreviews() {
  [
    ["brandLogoFile", "brandLogoPreview"],
    ["brandHeroFile", "brandHeroPreview"],
    ["brandPromoFile", "brandPromoPreview"]
  ].forEach(([inputId, previewId]) => {
    const input = $(`#${inputId}`);
    if (!input) return;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      setBrandPreview(previewId, URL.createObjectURL(file));
    });
  });
}

function setBrandPreview(previewId, src) {
  const img = $(`#${previewId}`);
  if (!img) return;
  const holder = img.closest(".brand-file");
  if (!src) {
    img.removeAttribute("src");
    holder?.classList.remove("has-preview");
    return;
  }
  img.src = src;
  holder?.classList.add("has-preview");
}

async function saveBranding(event) {
  event.preventDefault();
  const button = event.submitter || $("#brandingForm button[type='submit']");
  const previousHtml = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span class="mini-loader"></span>Guardando marca`;
  const nextShop = {
    ...state.shop,
    name: $("#brandName").value.trim(),
    hero_title: $("#brandHeroTitle").value.trim()
  };
  try {
    nextShop.logo_url = await maybeUpload("brandLogoFile", "logo", nextShop.logo_url);
    nextShop.hero_image_url = await maybeUpload("brandHeroFile", "hero", nextShop.hero_image_url);
    nextShop.promo_image_url = await maybeUpload("brandPromoFile", "promo", nextShop.promo_image_url);

    if (supabaseClient) {
      const { data, error } = await supabaseClient
        .from("barber_shops")
        .update(nextShop)
        .eq("id", state.shop.id)
        .select("*")
        .single();
      if (error) return toast(readableError(error));
      state.shop = data;
      await bootstrapData();
    } else {
      state.shop = nextShop;
      saveState();
    }
    toast("Personalizacion guardada.");
    renderAll();
  } catch (error) {
    toast(readableError(error));
  } finally {
    button.disabled = false;
    button.innerHTML = previousHtml;
    lucide.createIcons();
  }
}

async function maybeUpload(inputId, slot, fallback) {
  const file = $(`#${inputId}`).files[0];
  if (!file) return fallback || "";
  if (!supabaseClient) return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
  const safeName = file.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = `${state.shop.id}/${slot}-${Date.now()}-${safeName}`;
  const { error } = await supabaseClient.storage.from("barber-assets").upload(path, file, { upsert: true });
  if (error) {
    throw error;
  }
  return supabaseClient.storage.from("barber-assets").getPublicUrl(path).data.publicUrl;
}

function activeProfessionals() {
  return state.professionals.filter((item) => item.active !== false).map((item) => ({
    ...item,
    availability: normalizeAvailability(item.availability)
  }));
}

function activeServices() {
  return state.services.filter((item) => item.active !== false);
}

function upsertById(rows, row) {
  return rows.some((item) => item.id === row.id) ? rows.map((item) => item.id === row.id ? row : item) : [row, ...rows];
}

function findName(rows, id) {
  return rows.find((row) => row.id === id)?.name || "Sin nombre";
}

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

function getAccountingRange() {
  const mode = $("#accountingRange")?.value || "today";
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  if (mode === "yesterday") {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  } else if (mode === "7" || mode === "15") {
    start.setDate(start.getDate() - (Number(mode) - 1));
  } else if (mode === "month") {
    start.setDate(1);
  } else if (mode === "year") {
    start.setMonth(0, 1);
  } else if (mode === "custom") {
    const selected = $("#accountingDate")?.value || todayISO();
    return { start: selected, end: selected, label: selected };
  }
  return { start: toISODate(start), end: toISODate(end), label: mode };
}

function isDateInRange(date, range) {
  if (!date) return false;
  return date >= range.start && date <= range.end;
}

function professionalAccounting(professionalId) {
  const range = getAccountingRange();
  const appointments = state.appointments.filter((a) => a.professional_id === professionalId && isDateInRange(a.appointment_date, range));
  const movements = (state.transactions || []).filter((t) => t.professional_id === professionalId && isDateInRange(t.transaction_date, range));
  const completed = appointments.filter((a) => a.status === "completed");
  const gross = completed.reduce((sum, a) => sum + Number(a.total_price || a.service_price || 0), 0);
  const deducted = movements.filter((t) => t.transaction_type === "deduction").reduce((sum, t) => sum + Number(t.amount || 0), 0);
  const paid = movements.filter((t) => t.transaction_type === "payout").reduce((sum, t) => sum + Number(t.amount || 0), 0);
  return { range, appointments, movements, completed, gross, deducted, paid, net: Math.max(gross - deducted - paid, 0) };
}

function openSettlementModal(professionalId, type) {
  const professional = state.professionals.find((p) => p.id === professionalId);
  if (!professional) return toast("No encontre el profesional.");
  const account = professionalAccounting(professionalId);
  $("#settlementProfessionalId").value = professionalId;
  $("#settlementType").value = type;
  $("#settlementTitle").textContent = type === "deduction" ? `Descontar a ${professional.name}` : `Liquidar a ${professional.name}`;
  $("#settlementAmount").value = type === "payout" ? Math.round(account.net) : "";
  $("#settlementNote").value = "";
  $("#settlementSummary").innerHTML = `
    <article><span>Ingresos</span><strong>${money(account.gross)}</strong></article>
    <article><span>Descuentos</span><strong>${money(account.deducted)}</strong></article>
    <article><span>Liquidado</span><strong>${money(account.paid)}</strong></article>
    <article><span>Neto disponible</span><strong>${money(account.net)}</strong></article>
  `;
  openModal("settlementModal");
}

async function saveSettlement(event) {
  event.preventDefault();
  const row = {
    id: crypto.randomUUID(),
    shop_id: state.shop.id,
    professional_id: $("#settlementProfessionalId").value,
    transaction_type: $("#settlementType").value,
    amount: Number($("#settlementAmount").value || 0),
    note: $("#settlementNote").value.trim(),
    transaction_date: todayISO()
  };
  if (!row.amount) return toast("Escribe un monto valido.");
  if (supabaseClient) {
    const { error } = await supabaseClient.from("professional_transactions").insert(row);
    if (error) return toast(readableError(error));
    await refreshTransactions();
  } else {
    state.transactions = [row, ...(state.transactions || [])];
    saveState();
  }
  closeModal("settlementModal");
  renderMetrics();
  toast(row.transaction_type === "deduction" ? "Descuento registrado." : "Liquidacion registrada.");
}

function initials(name) {
  return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function formatTimePretty(time) {
  if (!time) return "--";
  const [hourRaw, minute = "00"] = String(time).slice(0, 5).split(":").map(Number);
  const period = hourRaw >= 12 ? "PM" : "AM";
  const hour = hourRaw % 12 || 12;
  return `${hour}:${String(minute).padStart(2, "0")} ${period}`;
}

function formatTimeRange(time, duration = 45) {
  if (!time) return "Horario sin definir";
  const [hour, minute = 0] = String(time).slice(0, 5).split(":").map(Number);
  const start = new Date();
  start.setHours(hour, minute, 0, 0);
  const end = new Date(start.getTime() + Number(duration || 45) * 60000);
  return `${formatTimePretty(time)} - ${formatTimePretty(`${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`)}`;
}

function formatDateLong(date) {
  if (!date) return "Fecha sin definir";
  return new Date(date + "T00:00:00").toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function statusLabel(status) {
  return {
    scheduled: "Agendada",
    confirmed: "Confirmada",
    completed: "Atendida",
    cancelled: "Cancelada",
    no_show: "No asistio"
  }[status] || status;
}

function rememberKnownAppointments() {
  knownAppointmentIds = new Set(state.appointments.map((appt) => appt.id).filter(Boolean));
}

function startReservationAlert(id) {
  if (!IS_ADMIN_PAGE) return;
  latestReservationId = id || "";
  highlightedAppointmentId = latestReservationId;
  const appt = state.appointments.find((item) => item.id === latestReservationId);
  $("#goAdmin").classList.add("has-alert");
  if ($("#reservationAlert")) {
    $("#reservationAlertTitle").textContent = appt
      ? `${appt.customer_name || "Cliente"} · ${formatTimePretty(appt.start_time)}`
      : "Cita recibida";
    $("#reservationAlert").classList.add("show");
  }
  playReservationSound();
  notifyReservation(appt);
  clearTimeout(reservationAlertTimer);
  reservationAlertTimer = setTimeout(stopReservationAlert, 30000);
  renderAppointments();
}

function playReservationSound() {
  try {
    reservationAudio?.pause();
    reservationAudio = new Audio("sonido/alarma.mp3");
    reservationAudio.loop = true;
    reservationAudio.volume = 0.85;
    reservationAudio.play().catch(() => toast("Nueva reserva recibida. Toca la pantalla para habilitar sonido."));
  } catch {
    toast("Nueva reserva recibida.");
  }
}

function stopReservationAlert() {
  reservationAudio?.pause();
  reservationAudio = null;
  clearTimeout(reservationAlertTimer);
  $("#reservationAlert")?.classList.remove("show");
}

function notifyReservation(appt) {
  if (!("Notification" in window) || !appt) return;
  const body = `${appt.customer_name || "Cliente"} · ${formatTimePretty(appt.start_time)} · ${appt.professional_name || findName(state.professionals, appt.professional_id)}`;
  if (Notification.permission === "granted") {
    new Notification("Nueva reserva en BarberBook", { body, icon: state.shop.logo_url || undefined });
    return;
  }
  if (Notification.permission === "default") {
    Notification.requestPermission().then((permission) => {
      if (permission === "granted") new Notification("Nueva reserva en BarberBook", { body, icon: state.shop.logo_url || undefined });
    });
  }
}

function viewLatestReservation() {
  if (!latestReservationId) return;
  showView("admin");
  $$(".admin-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.admin === "appointments"));
  $$(".admin-screen").forEach((screen) => screen.classList.toggle("active", screen.id === "appointmentsAdmin"));
  $("#appointmentStatusFilter").value = "all";
  renderAppointments();
  requestAnimationFrame(() => {
    const card = $(`[data-open-appt="${latestReservationId}"]`);
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
    card?.classList.add("is-highlighted");
  });
  stopReservationAlert();
  openAppointmentDetail(latestReservationId);
}

function openAppointmentDetail(id) {
  const appt = state.appointments.find((item) => item.id === id);
  if (!appt) return toast("No encontre esa reserva.");
  highlightedAppointmentId = id;
  const professional = appt.professional_name || findName(state.professionals, appt.professional_id);
  const service = appt.service_name || findName(state.services, appt.service_id);
  const duration = appt.services?.duration_minutes || appt.duration_minutes || 45;
  $("#appointmentDetailTitle").textContent = `${service} · ${statusLabel(appt.status)}`;
  $("#appointmentDetailBody").innerHTML = `
    <div class="detail-grid">
      <article><span>Cliente</span><strong>${appt.customer_name || "Sin nombre"}</strong><small>${appt.customer_phone || "Sin celular"}</small></article>
      <article><span>Profesional</span><strong>${professional}</strong><small>Servicio realizado por el barbero seleccionado</small></article>
      <article><span>Fecha</span><strong>${formatDateLong(appt.appointment_date)}</strong><small>${formatTimeRange(appt.start_time, duration)}</small></article>
      <article><span>Servicio</span><strong>${service}</strong><small>${duration} minutos · ${money(appt.total_price || appt.service_price || 0)}</small></article>
      <article><span>Estado</span><strong>${statusLabel(appt.status)}</strong><small>${appt.attended_at ? `Atendida: ${new Date(appt.attended_at).toLocaleString("es-CO")}` : "Sin cierre registrado"}</small></article>
      <article><span>Registro</span><strong>${appt.created_at ? new Date(appt.created_at).toLocaleString("es-CO") : "Sin fecha"}</strong><small>ID ${appt.id}</small></article>
    </div>
  `;
  openModal("appointmentDetailModal");
  renderAppointments();
}

function toast(message) {
  const el = $("#toast");
  el.textContent = typeof message === "string" ? message : readableError(message);
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 3200);
}

function readableError(error) {
  if (!error) return "Error desconocido.";
  if (typeof error === "string") return error;
  if (error.message) return error.message;
  if (error.error_description) return error.error_description;
  if (error.details) return error.details;
  if (error.hint) return error.hint;
  try {
    const text = JSON.stringify(error);
    return text && text !== "{}" ? text : "Supabase devolvio un error sin mensaje. Revisa que el usuario exista en auth.users y tenga perfil en public.profiles.";
  } catch {
    return "Supabase devolvio un error sin mensaje.";
  }
}

function setBusy(active) {
  $("#loaderLayer").classList.toggle("show", active);
}

function showSuccess() {
  $("#successLayer").classList.add("show");
  lucide.createIcons();
}

function showBookingConflict() {
  resetBooking();
  showView("booking");
  $("#conflictLayer").classList.add("show");
  lucide.createIcons();
}

function handleRealtimeBookingConflict() {
  const { professional, date, time } = state.booking;
  if (!professional || !date || !time) return;
  if (isBooked(professional.id, date, time)) showBookingConflict();
}

function hydrateAvailability() {
  state.professionals = state.professionals.map((professional) => ({
    ...professional,
    availability: normalizeAvailability(professional.availability)
  }));
}

function normalizeAvailability(availability) {
  if (!availability) return { weekdays: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:30" };
  if (typeof availability === "string") {
    try {
      return normalizeAvailability(JSON.parse(availability));
    } catch {
      return { weekdays: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:30" };
    }
  }
  return {
    weekdays: Array.isArray(availability.weekdays) ? availability.weekdays.map(Number) : [1, 2, 3, 4, 5, 6],
    start: availability.start || "09:00",
    end: availability.end || "18:30"
  };
}

function isProfessionalAvailableOnDate(professional, isoDate) {
  if (!professional || !isoDate) return false;
  const availability = normalizeAvailability(professional.availability);
  const weekday = new Date(`${isoDate}T00:00:00`).getDay();
  return availability.weekdays.includes(weekday);
}

function getAvailableTimes(professional, isoDate) {
  if (!professional || !isoDate || !isProfessionalAvailableOnDate(professional, isoDate)) return [];
  const availability = normalizeAvailability(professional.availability);
  const start = timeToMinutes(availability.start);
  const end = timeToMinutes(availability.end);
  const step = 45;
  const times = [];
  for (let minutes = start; minutes <= end - step; minutes += step) {
    times.push(minutesToTime(minutes));
  }
  return times;
}

function timeToMinutes(time) {
  const [hours, minutes] = String(time || "00:00").split(":").map(Number);
  return (hours * 60) + minutes;
}

function minutesToTime(total) {
  const hours = String(Math.floor(total / 60)).padStart(2, "0");
  const minutes = String(total % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function availabilityLabel(professional) {
  const availability = normalizeAvailability(professional.availability);
  const dayNames = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"];
  return `${availability.weekdays.map((day) => dayNames[day]).join(", ")} · ${availability.start} - ${availability.end}`;
}

function getAvailabilityFromForm() {
  return {
    weekdays: $$("#professionalWeekdays input:checked").map((input) => Number(input.value)),
    start: $("#professionalStartTime").value,
    end: $("#professionalEndTime").value
  };
}

function setWeekdays(days) {
  $$("#professionalWeekdays input").forEach((input) => {
    input.checked = days.includes(Number(input.value));
  });
}

function openModal(id) {
  $(`#${id}`).classList.add("show");
  lucide.createIcons();
}

function closeModal(id) {
  $(`#${id}`).classList.remove("show");
}
