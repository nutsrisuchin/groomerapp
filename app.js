/* ===================================================================
   app.js — Pawfect Grooming Studio
   Views: home / pets / pet detail / bookings / groomers
   Plain JS, no framework. State cached in memory, persisted via DB.
=================================================================== */

/* ---------- constants ---------- */
const SPECIES = { dog: "🐶", cat: "🐱" };
const SERVICES = ["Basic", "Hair Styling"];
// Suggested breeds for the booking form's breed field (a <datalist>, so typing
// anything else — mixed breeds, cats, less common breeds — still works fine).
const BREEDS = [
  "Corgi", "Pomeranian", "Maltipoo", "Poodle", "Siberian Husky", "Labrador Retriever",
  "Golden Retriever", "Shih Tzu", "Chihuahua", "French Bulldog", "Bulldog", "Beagle",
  "Pug", "Maltese", "Schnauzer", "Shiba Inu", "Border Collie", "Dachshund",
  "Yorkshire Terrier", "Cavalier King Charles Spaniel",
];
const RECUR = {
  none:    { label: "One-time",       rrule: null },
  weekly:  { label: "Every week",     rrule: "FREQ=WEEKLY" },
  biweekly:{ label: "Every 2 weeks",  rrule: "FREQ=WEEKLY;INTERVAL=2" },
  monthly: { label: "Every month",    rrule: "FREQ=MONTHLY" },
};
// Maps a booking service label to the key used in a pet profile's typical-time fields
const SERVICE_TIME_KEY = { "Basic": "shower", "Hair Styling": "styling" };
// Weight-tier pricing (THB) from the shop's price sheet. Basic is a range (the sheet notes
// it depends on hair length, which isn't tracked yet, so we show the full range); Full
// Groom (mapped to the app's "Hair Styling" service) is a single fixed price per tier.
const WEIGHT_TIERS = [
  { name: "Tiny",         maxKg: 2,  basic: [300, 350],   fullGroom: 600 },
  { name: "Mini",         maxKg: 5,  basic: [400, 450],   fullGroom: 750 },
  { name: "Small",        maxKg: 10, basic: [500, 550],   fullGroom: 900 },
  { name: "Medium",       maxKg: 15, basic: [650, 700],   fullGroom: 1300 },
  { name: "Large",        maxKg: 20, basic: [750, 850],   fullGroom: 1550 },
  { name: "Extra-Large",  maxKg: 30, basic: [950, 1150],  fullGroom: 1800 },
  { name: "Giant",        maxKg: 40, basic: [1200, 1500], fullGroom: 1900 },
  { name: "Extra-Giant",  maxKg: 50, basic: [1500, 1600], fullGroom: 2500 },
];
function tierForWeight(kg) {
  const n = Number(kg);
  if (!kg || isNaN(n) || n <= 0) return null;
  return WEIGHT_TIERS.find((t) => n <= t.maxKg) || WEIGHT_TIERS[WEIGHT_TIERS.length - 1];
}
// Estimated total for the given services at this pet's weight tier. Returns null if
// weight is unknown or no priced service is selected.
function estimateCost(weightKg, services) {
  const tier = tierForWeight(weightKg);
  if (!tier || !services || !services.length) return null;
  let min = 0, max = 0, matched = false;
  if (services.includes("Basic")) { min += tier.basic[0]; max += tier.basic[1]; matched = true; }
  if (services.includes("Hair Styling")) { min += tier.fullGroom; max += tier.fullGroom; matched = true; }
  if (!matched) return null;
  return { tier: tier.name, min, max, label: min === max ? `฿${min}` : `฿${min}–${max}` };
}
// Palette offered when creating/editing a groomer — the full set of Google Calendar
// event colors (exact hexes), so a groomer's swatch here matches their events later.
const GROOMER_COLORS = [
  { name: "Tomato",    color: "#d50000", calendarColorId: "11" },
  { name: "Tangerine", color: "#f4511e", calendarColorId: "6"  },
  { name: "Banana",    color: "#f6bf26", calendarColorId: "5"  }, // yellow
  { name: "Sage",      color: "#33b679", calendarColorId: "2"  },
  { name: "Basil",     color: "#0b8043", calendarColorId: "10" },
  { name: "Peacock",   color: "#039be5", calendarColorId: "7"  },
  { name: "Blueberry", color: "#3f51b5", calendarColorId: "9"  },
  { name: "Lavender",  color: "#7986cb", calendarColorId: "1"  },
  { name: "Grape",     color: "#8e24aa", calendarColorId: "3"  },
  { name: "Flamingo",  color: "#e67c73", calendarColorId: "4"  },
  { name: "Graphite",  color: "#616161", calendarColorId: "8"  },
];

/* ---------- state ---------- */
const state = { view: "home", petId: null, pets: [], groomers: [], bookings: [], admins: [], settings: [], activity: [], calendarTombstones: [], scheduleDate: "", scheduleHiddenGroomers: [], search: { name: "", breed: "" } };
const getCalendarId = () => (state.settings.find((s) => s.id === "calendar") || {}).calendarId || "";
const getCustomBreeds = () => (state.settings.find((s) => s.id === "breeds") || {}).list || [];
// Static top-20 list plus any breed staff have typed in before, deduped case-insensitively.
function allBreeds() {
  const seen = new Set();
  const out = [];
  [...BREEDS, ...getCustomBreeds()].forEach((b) => {
    const key = b.trim().toLowerCase();
    if (key && !seen.has(key)) { seen.add(key); out.push(b.trim()); }
  });
  return out;
}
// Remembers a newly-typed breed (if it's new) so it shows up as a suggestion next time.
async function rememberBreed(breed) {
  const b = (breed || "").trim();
  if (!b) return;
  const known = allBreeds().map((x) => x.toLowerCase());
  if (known.includes(b.toLowerCase())) return;
  const rec = { id: "breeds", list: [...getCustomBreeds(), b], updatedAt: Date.now() };
  await DB.put("settings", rec);
  upsertLocal("settings", rec);
}

/* ---------- tiny DOM helpers ---------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._t); t._t = setTimeout(() => (t.hidden = true), 2200);
}

// Derives the Firebase Auth login email an admin's name maps to. "Owner" always
// maps to the bootstrap account set up manually in the Firebase Console.
function emailForName(name) {
  const n = name.trim().toLowerCase();
  if (n === "owner") return SHOP_LOGIN_EMAIL;
  const slug = n.replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
  return `${slug}@pawfect.local`;
}
function currentAdminName() {
  if (DB.currentEmail() === SHOP_LOGIN_EMAIL) return "Owner";
  const a = state.admins.find((x) => x.uid === DB.currentUid());
  return a ? a.name : "Someone";
}

/* ---------- notifications / activity log ---------- */
// Best-effort, same spirit as Calendar sync: never blocks or fails the action it's logging.
async function logActivity(type, action, summary) {
  try {
    const rec = { id: DB.uid("act"), type, action, summary, actorName: currentAdminName(), at: Date.now() };
    await DB.put("activity", rec);
    upsertLocal("activity", rec);
  } catch (err) { console.error("Activity log failed", err); }
}
function timeAgo(ms) {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day} days ago`;
  return fmtDate(ms);
}
const ACTIVITY_ICON = {
  booking: { created: "📅", updated: "✏️", deleted: "🗑" },
  groomer: { created: "🧑‍🎨", updated: "✏️", deleted: "🗑" },
};

/* ---------- date helpers ---------- */
function fmtDate(d) { return new Date(d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }); }
function fmtTime(d) { return new Date(d).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function dateKey(d) { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; }
function todayKey() { return dateKey(new Date()); }
function addDaysKey(dateStr, n) { const d = new Date(dateStr + "T00:00:00"); d.setDate(d.getDate() + n); return dateKey(d); }
function addMonthsKey(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDate();
  d.setDate(1); // avoid rollover bugs (e.g. Jan 31 + 1 month)
  d.setMonth(d.getMonth() + n);
  const daysInTarget = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, daysInTarget));
  return dateKey(d);
}
function startOfWeekKey(dateStr) { const d = new Date(dateStr + "T00:00:00"); d.setDate(d.getDate() - d.getDay()); return dateKey(d); }
// 6 full weeks (42 days) starting the Sunday on/before the 1st of the month — a stable grid size.
function monthGridDates(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  start.setDate(start.getDate() - start.getDay());
  const dates = [];
  for (let i = 0; i < 42; i++) { const cur = new Date(start); cur.setDate(start.getDate() + i); dates.push(dateKey(cur)); }
  return dates;
}
function fmtDateKey(dateStr) { return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short", year: "numeric" }); }
function fmtWeekRange(dateStr) {
  const start = startOfWeekKey(dateStr), end = addDaysKey(start, 6);
  const s = new Date(start + "T00:00:00"), e = new Date(end + "T00:00:00");
  const sameMonth = s.getMonth() === e.getMonth();
  const sFmt = s.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const eFmt = e.toLocaleDateString(undefined, sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" });
  return `${sFmt} – ${eFmt}, ${e.getFullYear()}`;
}
function fmtMonthKey(dateStr) { return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" }); }
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_NAMES_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* ---------- business hours + schedule/free-slot helpers ---------- */
function getBusinessHours() {
  const s = state.settings.find((x) => x.id === "hours");
  return s || { open: "10:00", close: "19:00", closedDays: [2] }; // default: closed Tuesdays
}
function toMinutes(hhmm) { const [h, m] = hhmm.split(":").map(Number); return h * 60 + (m || 0); }
function fmtMinutes(min) {
  const h = Math.floor(min / 60), m = min % 60;
  const d = new Date(); d.setHours(h, m, 0, 0);
  return fmtTime(d);
}

// Does `booking` occur on `dateStr` ("YYYY-MM-DD")? Returns the occurrence's
// start Date (same time-of-day as the booking, on that date) or null.
function occurrenceOnDate(booking, dateStr) {
  const start = new Date(booking.start);
  const startKey = dateKey(start);
  if (dateStr < startKey) return null;
  if (booking.recurrenceUntil && dateStr > booking.recurrenceUntil) return null;
  const rec = booking.recurrence || "none";
  if (rec === "none") { if (dateStr !== startKey) return null; }
  else {
    const startOnly = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const viewed = new Date(dateStr + "T00:00:00");
    const diffDays = Math.round((viewed - startOnly) / 86400000);
    let matches = false;
    if (rec === "weekly") matches = diffDays >= 0 && diffDays % 7 === 0;
    else if (rec === "biweekly") matches = diffDays >= 0 && diffDays % 14 === 0;
    else if (rec === "monthly") matches = diffDays >= 0 && viewed.getDate() === startOnly.getDate();
    if (!matches) return null;
  }
  const occ = new Date(dateStr + "T00:00:00");
  occ.setHours(start.getHours(), start.getMinutes(), 0, 0);
  return occ;
}

// Free minute-ranges within [openMin, closeMin), given sorted busy {startMin, endMin} blocks.
function freeSlots(busy, openMin, closeMin) {
  const free = [];
  let cursor = openMin;
  for (const b of busy) {
    const s = Math.max(b.startMin, openMin), e = Math.min(b.endMin, closeMin);
    if (s > cursor) free.push({ startMin: cursor, endMin: s });
    cursor = Math.max(cursor, e);
  }
  if (cursor < closeMin) free.push({ startMin: cursor, endMin: closeMin });
  return free;
}

// All bookings (any groomer) occurring on `dateStr`, each with its occurrence time and duration.
function bookingsOnDate(dateStr) {
  return state.bookings
    .map((b) => {
      const occ = occurrenceOnDate(b, dateStr);
      if (!occ) return null;
      const startMin = occ.getHours() * 60 + occ.getMinutes();
      const dur = bookingDurationHours(b) || 1;
      return { booking: b, groomer: groomerById(b.groomerId), startMin, endMin: startMin + Math.round(dur * 60) };
    })
    .filter(Boolean)
    .sort((a, b) => a.startMin - b.startMin);
}

// Next occurrence >= today for a (possibly recurring) booking.
// Returns null once a "repeat until" date exists and the series has ended.
function nextOccurrence(b) {
  const first = new Date(b.start);
  const today = startOfToday();
  const until = b.recurrenceUntil ? new Date(b.recurrenceUntil + "T23:59:59") : null;
  if (until && first > until) return null;
  if (first >= today || b.recurrence === "none" || !b.recurrence) return first;
  const d = new Date(first);
  const guard = 400;
  for (let i = 0; i < guard; i++) {
    if (d >= today) return d;
    if (b.recurrence === "weekly") d.setDate(d.getDate() + 7);
    else if (b.recurrence === "biweekly") d.setDate(d.getDate() + 14);
    else if (b.recurrence === "monthly") d.setMonth(d.getMonth() + 1);
    else return first;
    if (until && d > until) return null;
  }
  return d;
}
function bookingDurationHours(b) {
  if (!b.serviceHours) return 0;
  const sum = Object.values(b.serviceHours).reduce((a, v) => a + (Number(v) || 0), 0);
  return Math.round(sum * 100) / 100;
}

/* ---------- lookups ---------- */
const groomerById = (id) => state.groomers.find((g) => g.id === id);
function groomerColor(id) { const g = groomerById(id); return g ? g.color : "#c3c8d4"; }
function groomerName(id) { const g = groomerById(id); return g ? g.name : "Unassigned"; }
function findMatchingPets(query, limit = 6) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return state.pets
    .filter((p) => p.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.toLowerCase().indexOf(q) - b.name.toLowerCase().indexOf(q))
    .slice(0, limit);
}
// One-time fixup: pet "typical time" used to be stored in minutes; now it's hours
// (matching bookings). No realistic grooming service takes over 12 hours, so any
// stored value that large is almost certainly a leftover minutes value — convert
// it in place, once. Naturally becomes a no-op forever after the first pass.
async function migratePetTimesToHours() {
  for (const p of state.pets) {
    const t = p.times || {};
    let changed = false;
    ["shower", "clipping", "styling"].forEach((k) => {
      if (t[k] != null && t[k] > 12) { t[k] = Math.round((t[k] / 60) * 4) / 4; changed = true; }
    });
    if (changed) { await DB.put("pets", p); upsertLocal("pets", p); }
  }
}

// One-time fixup: the "Shower" service was renamed to "Basic" — existing bookings still
// have the old label baked into their services array/serviceHours keys, which would
// otherwise show as an unchecked, empty-hours "Basic" box when reopened for editing.
async function migrateShowerLabelToBasic() {
  for (const b of state.bookings) {
    if (!b.services || !b.services.includes("Shower")) continue;
    const services = b.services.map((s) => (s === "Shower" ? "Basic" : s));
    const serviceHours = {};
    Object.keys(b.serviceHours || {}).forEach((k) => { serviceHours[k === "Shower" ? "Basic" : k] = b.serviceHours[k]; });
    const rec = { ...b, services, serviceHours, calendarDirty: true };
    await DB.put("bookings", rec);
    upsertLocal("bookings", rec);
  }
}

/* ---------- image resize ---------- */
function fileToResizedDataURL(file, max = 640) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > max) { height = height * (max / width); width = max; }
        else if (height > max) { width = width * (max / height); height = max; }
        const c = document.createElement("canvas");
        c.width = width; c.height = height;
        c.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ===================================================================
   RENDER
=================================================================== */
// Optimistic local patch so the UI updates instantly after a write, without
// waiting on the Firestore round-trip. DB.watch() reconciles state shortly
// after anyway (and is what carries changes made from *other* devices).
function upsertLocal(name, rec) {
  const idx = state[name].findIndex((x) => x.id === rec.id);
  if (idx >= 0) state[name][idx] = rec; else state[name].push(rec);
}
function removeLocal(name, id) {
  state[name] = state[name].filter((x) => x.id !== id);
}

function render() {
  $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.nav === state.view));
  const v = $("#view");
  if (state.view === "home") v.innerHTML = viewHome();
  else if (state.view === "pets") v.innerHTML = viewPets();
  else if (state.view === "pet") v.innerHTML = viewPetDetail();
  else if (state.view === "bookings") v.innerHTML = viewBookings();
  else if (state.view === "groomers") v.innerHTML = viewGroomers();
  else if (state.view === "admins") v.innerHTML = viewAdmins();
  else if (state.view === "calendar") v.innerHTML = viewCalendarSettings();
  else if (state.view === "schedule") v.innerHTML = viewSchedule();
  bindView();
  window.scrollTo({ top: 0 });
}

function go(view, petId = null) { state.view = view; state.petId = petId; render(); }

/* ---------- HOME ---------- */
function viewHome() {
  const results = filteredPets();
  const searching = state.search.name || state.search.breed;
  const upcoming = upcomingBookings(6);
  const recent = [...state.activity].sort((a, b) => b.at - a.at).slice(0, 8);

  return `
  <div class="page-head">
    <div><h1>Welcome back 🐾</h1><div class="muted">Your Grooming Partner.</div></div>
    <button class="btn primary" data-action="new-booking">＋ New Booking</button>
  </div>

  <div class="card pad" style="margin-bottom:16px">
    <h3 class="section-title">Search pets</h3>
    <div class="searchbar">
      <input id="q-name"  placeholder="Name (e.g. Milo)"        value="${esc(state.search.name)}">
      <input id="q-breed" placeholder="Breed (e.g. Poodle)"     value="${esc(state.search.breed)}">
      <button class="btn" data-action="clear-search">Clear</button>
    </div>
    ${searching ? `
      <div class="divider"></div>
      <div class="muted" style="margin-bottom:12px">${results.length} match${results.length === 1 ? "" : "es"}</div>
      <div class="grid pets">${results.map(petCard).join("") || emptyInline("No pets match that search.")}</div>
    ` : ""}
  </div>

  <div class="grid home">
    <div class="card pad">
      <div class="spread" style="margin-bottom:6px">
        <h3 class="section-title" style="margin:0">Upcoming bookings</h3>
        <button class="link" data-nav="bookings">View all</button>
      </div>
      ${upcoming.length ? upcoming.map(bookingRow).join("") : emptyInline("No upcoming bookings yet.")}
    </div>

    <div class="stack" style="gap:16px">
      <div class="card pad">
        <h3 class="section-title">Notifications</h3>
        <div class="stack" style="gap:2px">
          ${recent.length ? recent.map(activityRow).join("") : emptyInline("No recent activity yet.")}
        </div>
      </div>
      <div class="card pad">
        <h3 class="section-title">Quick actions</h3>
        <div class="stack" style="gap:10px">
          <button class="btn block" data-action="new-pet">＋ Add a pet profile</button>
          <button class="btn block" data-action="new-booking">＋ New booking</button>
        </div>
      </div>
      <div class="card pad">
        <div class="spread"><h3 class="section-title" style="margin:0">Groomers</h3>
          <button class="link" data-nav="groomers">Manage</button></div>
        <div class="stack" style="gap:10px; margin-top:10px">
          ${state.groomers.map((g) => `
            <div class="row"><span class="dot" style="background:${g.color}"></span><strong>${esc(g.name)}</strong></div>
          `).join("") || emptyInline("No groomers yet.")}
        </div>
      </div>
    </div>
  </div>`;
}

/* ---------- PETS LIST ---------- */
function viewPets() {
  const pets = [...state.pets].sort((a, b) => a.name.localeCompare(b.name));
  return `
  <div class="page-head">
    <h1>Pets <span class="faint" style="font-weight:600">(${pets.length})</span></h1>
    <button class="btn primary" data-action="new-pet">＋ Add pet</button>
  </div>
  ${pets.length ? `<div class="grid pets">${pets.map(petCard).join("")}</div>`
    : emptyBlock("🐾", "No pet profiles yet", "Add your first furry client to get started.", "new-pet", "Add a pet")}`;
}

function petCard(p) {
  const photo = p.photo ? `style="background-image:url('${p.photo}')"` : "";
  return `
  <div class="card pet-card" data-open-pet="${p.id}">
    <div class="photo" ${photo}><span class="species">${SPECIES[p.species] || "🐾"}</span></div>
    <div class="body">
      <p class="name">${esc(p.name)}</p>
      <div class="breed">${esc(p.breed || "Unknown breed")}</div>
      <div class="meta">
        <span class="dot" style="background:${groomerColor(p.groomerId)}"></span>${esc(groomerName(p.groomerId))}
        ${p.weight ? `· ${esc(p.weight)} kg` : ""}
      </div>
    </div>
  </div>`;
}

/* ---------- PET DETAIL ---------- */
function viewPetDetail() {
  const p = state.pets.find((x) => x.id === state.petId);
  if (!p) return emptyBlock("🐾", "Pet not found", "", "go-pets", "Back to pets");
  const t = p.times || {};
  const history = [...(p.history || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
  const photo = p.photo ? `style="background-image:url('${p.photo}')"` : "";
  const priceTier = tierForWeight(p.weight);

  return `
  <button class="btn ghost sm" data-nav="pets">← All pets</button>
  <div class="card pad" style="margin-top:12px">
    <div class="row" style="align-items:flex-start; gap:22px">
      <div class="avatar" ${photo}>${p.photo ? "" : SPECIES[p.species] || "🐾"}</div>
      <div class="grow">
        <div class="spread">
          <div>
            <h1 style="margin:0 0 2px">${esc(p.name)} <span style="font-size:22px">${SPECIES[p.species] || ""}</span></h1>
            <div class="muted">${esc(p.breed || "Unknown breed")}${p.weight ? ` · ${esc(p.weight)} kg` : ""}</div>
            <div class="groomer-tag" style="margin-top:8px"><span class="dot" style="background:${groomerColor(p.groomerId)}"></span>${esc(groomerName(p.groomerId))}</div>
          </div>
          <div class="row">
            <button class="btn sm" data-action="edit-pet" data-id="${p.id}">Edit</button>
            <button class="btn sm primary" data-action="book-pet" data-id="${p.id}">Book</button>
          </div>
        </div>
        <div class="divider"></div>
        <h3 class="section-title">Typical time consumed</h3>
        <div class="time-pills">
          <span class="time-pill">🚿 Basic · ${t.shower ? t.shower + "h" : "—"}</span>
          <span class="time-pill">💈 Styling · ${t.styling ? t.styling + "h" : "—"}</span>
        </div>
        ${priceTier ? `
          <h3 class="section-title" style="margin-top:14px">Estimated pricing (${priceTier.name}, ${esc(p.weight)}kg)</h3>
          <div class="time-pills">
            <span class="time-pill">🚿 Basic · ฿${priceTier.basic[0]}–${priceTier.basic[1]}</span>
            <span class="time-pill">💈 Full Groom · ฿${priceTier.fullGroom}</span>
          </div>` : ""}
      </div>
    </div>
  </div>

  <div class="card pad" style="margin-top:16px">
    <div class="spread"><h3 class="section-title" style="margin:0">Service history</h3>
      <button class="btn sm" data-action="add-history" data-id="${p.id}">＋ Add record</button></div>
    <div style="margin-top:8px">
      ${history.length ? history.map((h, i) => `
        <div class="history-item">
          <div class="h-date">${fmtDate(h.date)}</div>
          <div class="h-body">
            <div class="row spread">
              <div><strong>${(h.services || []).map(esc).join(", ") || "Service"}</strong>
                <span class="groomer-tag" style="margin-left:8px"><span class="dot" style="background:${groomerColor(h.groomerId)}"></span>${esc(groomerName(h.groomerId))}</span></div>
              <button class="icon-btn" data-action="del-history" data-id="${p.id}" data-idx="${i}" title="Delete">🗑</button>
            </div>
            ${h.notes ? `<div class="muted" style="font-size:13px; margin-top:4px">${esc(h.notes)}</div>` : ""}
          </div>
        </div>`).join("")
        : emptyInline("No service records yet.")}
    </div>
  </div>`;
}

/* ---------- BOOKINGS ---------- */
function viewBookings() {
  const list = [...state.bookings].sort((a, b) => {
    const wa = nextOccurrence(a), wb = nextOccurrence(b);
    if (wa === null && wb === null) return new Date(b.start) - new Date(a.start);
    if (wa === null) return 1;
    if (wb === null) return -1;
    return wa - wb;
  });
  return `
  <div class="page-head">
    <h1>Bookings <span class="faint" style="font-weight:600">(${list.length})</span></h1>
    <button class="btn primary" data-action="new-booking">＋ New booking</button>
  </div>
  ${list.length ? `<div class="card">${list.map(bookingRow).join("")}</div>`
    : emptyBlock("📅", "No bookings yet", "Create a booking — it's ready to sync to Google Calendar later.", "new-booking", "New booking")}`;
}

function activityRow(a) {
  const icon = (ACTIVITY_ICON[a.type] && ACTIVITY_ICON[a.type][a.action]) || "•";
  return `
  <div class="activity-row">
    <span class="activity-icon">${icon}</span>
    <div class="grow">
      <div style="font-size:13px">${esc(a.summary)}</div>
      <div class="faint" style="font-size:12px">${esc(a.actorName || "Someone")} · ${timeAgo(a.at)}</div>
    </div>
  </div>`;
}

function bookingRow(b) {
  const when = nextOccurrence(b);
  const ended = when === null;
  const shown = when || new Date(b.start);
  const recur = RECUR[b.recurrence] || RECUR.none;
  const svcText = (b.services && b.services.length)
    ? b.services.map((s) => `${esc(s)}${b.serviceHours && b.serviceHours[s] ? ` (${b.serviceHours[s]}h)` : ""}`).join(", ")
    : "";
  const total = bookingDurationHours(b);
  const pet = b.petId ? state.pets.find((p) => p.id === b.petId) : null;
  const cost = pet ? estimateCost(pet.weight, b.services) : null;
  return `
  <div class="booking">
    <div class="stripe" style="background:${groomerColor(b.groomerId)}"></div>
    <div class="when"><div class="date">${fmtDate(shown)}</div><div class="time">${ended ? "Series ended" : fmtTime(shown)}</div></div>
    <div class="who">
      <div class="pet">${esc(b.petName)}${b.breed ? ` · <span class="muted" style="font-weight:500">${esc(b.breed)}</span>` : ""}</div>
      <div class="sub">
        <span class="groomer-tag"><span class="dot" style="background:${groomerColor(b.groomerId)}"></span>${esc(groomerName(b.groomerId))}</span>
        ${svcText ? " · " + svcText : ""}
        ${total ? ` · ${total}h total` : ""}
        ${cost ? ` · <strong>${cost.label}</strong>` : ""}
        ${b.recurrence && b.recurrence !== "none" ? ` <span class="recur-badge">${recur.label}${b.recurrenceUntil ? ` until ${fmtDate(b.recurrenceUntil)}` : ""}</span>` : ""}
      </div>
    </div>
    <div class="booking-actions">
      <button class="btn sm" data-action="edit-booking" data-id="${b.id}">Edit</button>
      <button class="icon-btn" data-action="copy-confirm" data-id="${b.id}" title="Copy confirmation message">📋</button>
      <button class="icon-btn" data-action="del-booking" data-id="${b.id}" title="Delete">🗑</button>
    </div>
  </div>`;
}

// "confirmed น้อง {name} {breed} {date & time}" — ready to paste to a customer.
// Uses the upcoming occurrence for recurring bookings (same date bookingRow shows), not the original start.
function bookingConfirmMessage(b) {
  const when = nextOccurrence(b) || new Date(b.start);
  return ["confirmed", "น้อง", b.petName, b.breed, `${fmtDate(when)} ${fmtTime(when)}`].filter(Boolean).join(" ");
}

/* ---------- GROOMERS ---------- */
function viewGroomers() {
  return `
  <div class="page-head">
    <h1>Groomers</h1>
    <button class="btn primary" data-action="new-groomer">＋ Add groomer</button>
  </div>
  <div class="card pad">
    <div class="muted" style="margin-bottom:6px">Each groomer's color is used on bookings and (later) on Google Calendar.</div>
    ${state.groomers.map((g) => {
      const count = state.bookings.filter((b) => b.groomerId === g.id).length;
      return `
      <div class="groomer-row">
        <span class="swatch" style="background:${g.color}"></span>
        <div class="grow"><strong>${esc(g.name)}</strong>
          <div class="faint" style="font-size:12px">${count} booking${count === 1 ? "" : "s"}</div></div>
        <button class="btn sm" data-action="edit-groomer" data-id="${g.id}">Edit</button>
        <button class="btn sm danger" data-action="del-groomer" data-id="${g.id}">Remove</button>
      </div>`;
    }).join("") || emptyInline("No groomers yet.")}
  </div>`;
}

/* ---------- ADMINS ---------- */
function viewAdmins() {
  const myUid = DB.currentUid();
  return `
  <div class="page-head">
    <h1>Admins</h1>
    <button class="btn primary" data-action="new-admin">＋ Add admin</button>
  </div>
  <div class="card pad">
    <div class="muted" style="margin-bottom:6px">Each admin signs in with their own name + PIN. Removing an admin here revokes their access immediately.</div>
    <div class="groomer-row">
      <span class="swatch" style="background:var(--brand)"></span>
      <div class="grow"><strong>Owner</strong>${DB.currentEmail() === SHOP_LOGIN_EMAIL ? ' <span class="chip">you</span>' : ""}
        <div class="faint" style="font-size:12px">Master account, set up in the Firebase Console</div></div>
    </div>
    ${state.admins.map((a) => `
      <div class="groomer-row">
        <span class="swatch" style="background:var(--brand)"></span>
        <div class="grow"><strong>${esc(a.name)}</strong>${a.uid === myUid ? ' <span class="chip">you</span>' : ""}
          <div class="faint" style="font-size:12px">${esc(a.email)}</div></div>
        <button class="btn sm danger" data-action="del-admin" data-id="${a.uid}" ${a.uid === myUid ? "disabled" : ""}>Remove</button>
      </div>`).join("") || emptyInline("No additional admins yet.")}
  </div>`;
}

/* ---------- CALENDAR SETTINGS ---------- */
// Persistent banner (not a one-shot modal — those are too easy to miss or accidentally
// dismiss with a stray click on the backdrop) shown on every page whenever Calendar sync
// is configured (a Calendar ID is set) but this browser isn't connected — e.g. the
// browser/tab was closed and the in-memory OAuth connection was lost, including on a
// plain refresh where Firebase silently resumes the session. Stays up until connected,
// or dismissed for the current session (resets on next login).
let gcalBannerDismissed = false;
function updateGcalBanner() {
  const el = $("#gcal-banner");
  if (!el) return;
  el.hidden = gcalBannerDismissed || !getCalendarId() || GCal.isConnected();
}
$("#gcal-banner-connect").addEventListener("click", async () => {
  const btn = $("#gcal-banner-connect");
  btn.disabled = true; btn.textContent = "Connecting…";
  try { await GCal.connect(); toast("Connected to Google Calendar"); }
  catch (err) { toast("Couldn't connect — check your pop-up blocker and try again."); }
  finally { btn.disabled = false; btn.textContent = "Connect"; }
});
$("#gcal-banner-dismiss").addEventListener("click", () => { gcalBannerDismissed = true; updateGcalBanner(); });

function viewCalendarSettings() {
  const calendarId = getCalendarId();
  const connected = GCal.isConnected();
  const pendingBookings = state.bookings.filter((b) => b.calendarDirty || !b.calendarEventId);
  const pendingTombs = state.calendarTombstones;
  const pendingCount = pendingBookings.length + pendingTombs.length;
  return `
  <div class="page-head"><h1>Google Calendar</h1></div>
  <div class="card pad">
    <div class="spread" style="margin-bottom:14px; gap:16px">
      <div>
        <strong>${connected ? "🟢 Connected" : "⚪ Not connected"}</strong>
        <div class="faint" style="font-size:12px">${connected
          ? "Bookings created or edited in this browser will sync to the calendar below."
          : "Connect once per browser session — the connection lasts about an hour, then just reconnect."}</div>
      </div>
      <button class="btn ${connected ? "" : "primary"}" data-action="gcal-connect">${connected ? "Reconnect" : "Connect Google Calendar"}</button>
    </div>
    ${pendingCount > 0 ? `
      <div class="card pad" style="background:var(--surface-2); margin-bottom:14px">
        <div class="spread" style="margin-bottom:8px">
          <strong style="font-size:13px">${pendingCount} item${pendingCount === 1 ? "" : "s"} not yet synced</strong>
          <button class="btn sm" data-action="gcal-sync-now" ${connected ? "" : "disabled"}>Sync now</button>
        </div>
        <div class="stack" style="gap:4px">
          ${pendingBookings.map((b) => `<div style="font-size:12px"><strong>${esc(b.petName)}</strong>${b.calendarSyncError ? ` <span class="faint">— ${esc(b.calendarSyncError)}</span>` : ` <span class="faint">— waiting to sync</span>`}</div>`).join("")}
          ${pendingTombs.map((t) => `<div style="font-size:12px"><strong>${esc(t.petName || "booking")} (delete)</strong>${t.calendarSyncError ? ` <span class="faint">— ${esc(t.calendarSyncError)}</span>` : ` <span class="faint">— waiting to delete</span>`}</div>`).join("")}
        </div>
      </div>` : ""}
    <div class="divider"></div>
    <div class="field"><label>Shared Calendar ID</label>
      <input id="gcal-id" value="${esc(calendarId)}" placeholder="e.g. abc123@group.calendar.google.com">
      <div class="help">Find it under that calendar's Settings → Integrate calendar → Calendar ID.
        Every booking syncs here, regardless of who connects — the groomer's color tells them apart.</div>
    </div>
    <button class="btn primary sm" data-action="gcal-save-id">Save Calendar ID</button>
  </div>`;
}

/* ---------- SCHEDULE (Google-Calendar-style: sidebar + toolbar + views) ---------- */
const PX_PER_HOUR = 60;

function sameMonth(dateStr, refDateStr) {
  const a = new Date(dateStr + "T00:00:00"), b = new Date(refDateStr + "T00:00:00");
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}
function visibleGroomers() { return state.groomers.filter((g) => !state.scheduleHiddenGroomers.includes(g.id)); }
function nowMinutesToday() { const n = new Date(); return { dateStr: dateKey(n), min: n.getHours() * 60 + n.getMinutes() }; }

function viewSchedule() {
  if (!state.scheduleDate) state.scheduleDate = todayKey();
  if (!state.scheduleMode) state.scheduleMode = "day";
  const mode = state.scheduleMode, dateStr = state.scheduleDate;
  const title = mode === "day" ? fmtDateKey(dateStr) : mode === "week" ? fmtWeekRange(dateStr) : fmtMonthKey(dateStr);

  const sidebar = `
  <aside class="gcal-sidebar">
    <div class="mini-cal">
      <div class="mini-cal-head">
        <strong>${fmtMonthKey(dateStr)}</strong>
        <div class="row" style="gap:2px">
          <button class="icon-btn" data-action="mini-cal-prev" aria-label="Previous month">‹</button>
          <button class="icon-btn" data-action="mini-cal-next" aria-label="Next month">›</button>
        </div>
      </div>
      <div class="mini-cal-grid">
        ${DAY_NAMES_SHORT.map((d) => `<div class="mini-dow">${d[0]}</div>`).join("")}
        ${monthGridDates(dateStr).map((d) => {
          const inMonth = sameMonth(d, dateStr);
          const isToday = d === todayKey();
          const isSel = d === dateStr;
          return `<button class="mini-day ${inMonth ? "" : "outside"} ${isToday ? "today" : ""} ${isSel ? "selected" : ""}" data-action="sched-jump" data-date="${d}">${new Date(d + "T00:00:00").getDate()}</button>`;
        }).join("")}
      </div>
    </div>
    <div class="sidebar-groomers">
      <div class="section-title" style="margin:16px 0 8px">My groomers</div>
      ${state.groomers.map((g) => `
        <label class="groomer-toggle">
          <input type="checkbox" class="sched-groomer-toggle" data-id="${g.id}" ${state.scheduleHiddenGroomers.includes(g.id) ? "" : "checked"}>
          <span class="dot" style="background:${g.color}"></span> ${esc(g.name)}
        </label>`).join("") || emptyInline("No groomers yet.")}
    </div>
    <button class="btn sm block" style="margin-top:14px" data-action="edit-hours">Edit hours</button>
  </aside>`;

  const toolbar = `
  <div class="card pad gcal-toolbar">
    <div class="row">
      <button class="btn sm" data-action="sched-today">Today</button>
      <button class="icon-btn" data-action="sched-prev" aria-label="Previous">‹</button>
      <button class="icon-btn" data-action="sched-next" aria-label="Next">›</button>
      <div class="gcal-title">${title}</div>
    </div>
    <select id="sched-mode-select" class="sched-mode-select">
      <option value="day" ${mode === "day" ? "selected" : ""}>Day</option>
      <option value="week" ${mode === "week" ? "selected" : ""}>Week</option>
      <option value="month" ${mode === "month" ? "selected" : ""}>Month</option>
    </select>
  </div>`;

  const body = mode === "day" ? scheduleBodyDay(dateStr) : mode === "week" ? scheduleBodyWeek(dateStr) : scheduleBodyMonth(dateStr);

  return `
  <div class="page-head"><h1>Schedule</h1></div>
  <div class="gcal-layout">
    ${sidebar}
    <div class="gcal-main">
      ${toolbar}
      ${body}
    </div>
  </div>`;
}

// Splits genuinely time-overlapping items into side-by-side lanes within the same column
// so one booking never fully hides another; non-overlapping items keep the full width.
function layoutLanes(items) {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const laneEnds = []; // laneEnds[i] = endMin of whichever item currently occupies lane i
  const placed = sorted.map((it) => {
    let lane = laneEnds.findIndex((end) => end <= it.startMin);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.endMin); }
    else laneEnds[lane] = it.endMin;
    return Object.assign({}, it, { lane });
  });
  placed.forEach((it) => {
    const cluster = placed.filter((o) => o.startMin < it.endMin && o.endMin > it.startMin);
    it.laneCount = Math.max(...cluster.map((o) => o.lane + 1));
  });
  return placed;
}

function scheduleBlockHtml(it, openMin, closeMin, color) {
  const top = ((Math.max(it.startMin, openMin) - openMin) / 60) * PX_PER_HOUR;
  const rawH = ((Math.min(it.endMin, closeMin) - Math.max(it.startMin, openMin)) / 60) * PX_PER_HOUR;
  const h = Math.max(rawH, 24);
  const b = it.booking;
  const laneCount = it.laneCount || 1, lane = it.lane || 0;
  const widthPct = 100 / laneCount;
  const left = `calc(${widthPct * lane}% + ${lane === 0 ? 4 : 2}px)`;
  const width = `calc(${widthPct}% - ${laneCount === 1 ? 8 : 4}px)`;
  const timeLabel = `${fmtMinutes(it.startMin)}–${fmtMinutes(it.endMin)}`;
  // Inset top/height by 1-2px so back-to-back bookings show a visible seam instead of blending together.
  return `<div class="schedule-block" style="top:${top + 1}px; height:${Math.max(h - 2, 20)}px; left:${left}; width:${width}; background:${color}" data-action="edit-booking" data-id="${b.id}" title="${esc(b.petName)}${b.breed ? " " + esc(b.breed) : ""} · ${timeLabel}">
    <div class="sb-time">${timeLabel}</div>
    <strong>${esc(b.petName)}</strong>${(b.services || []).length ? `<br>${esc(b.services.join(", "))}` : ""}
  </div>`;
}

function scheduleBodyDay(dateStr) {
  const hours = getBusinessHours();
  const dow = new Date(dateStr + "T00:00:00").getDay();
  if ((hours.closedDays || []).includes(dow)) return emptyBlock("🌙", "Closed", `The shop is closed on ${DAY_NAMES[dow]}s.`, null, null);
  const groomers = visibleGroomers();
  if (!groomers.length) {
    return state.groomers.length
      ? emptyBlock("🙈", "All groomers hidden", "Check a groomer in the sidebar to see their schedule.", null, null)
      : emptyBlock("🧑‍🎨", "No groomers yet", "Add a groomer to see their schedule here.", "new-groomer", "Add groomer");
  }

  const openMin = toMinutes(hours.open), closeMin = toMinutes(hours.close);
  const hourMarks = []; for (let m = openMin; m <= closeMin; m += 60) hourMarks.push(m);
  const all = bookingsOnDate(dateStr);
  const columns = groomers.map((g) => {
    const items = all.filter((it) => it.booking.groomerId === g.id);
    return { groomer: g, items: layoutLanes(items), free: freeSlots(items, openMin, closeMin) };
  });
  const gridHeight = ((closeMin - openMin) / 60) * PX_PER_HOUR;
  const now = nowMinutesToday();
  const nowLine = (now.dateStr === dateStr && now.min >= openMin && now.min <= closeMin)
    ? `<div class="now-line" style="top:${((now.min - openMin) / 60) * PX_PER_HOUR}px; left:56px; right:0"><span class="now-dot"></span></div>` : "";

  const grid = `
  <div class="card pad" style="overflow-x:auto">
    <div class="schedule-grid" style="height:${gridHeight}px">
      <div class="schedule-axis">
        ${hourMarks.map((m) => `<div class="axis-mark" style="top:${((m - openMin) / 60) * PX_PER_HOUR}px">${fmtMinutes(m)}</div>`).join("")}
      </div>
      ${columns.map((col) => `
        <div class="schedule-col">
          <div class="schedule-col-head"><span class="dot" style="background:${col.groomer.color}"></span>${esc(col.groomer.name)}</div>
          <div class="schedule-col-body" style="height:${gridHeight}px">
            ${col.items.map((it) => scheduleBlockHtml(it, openMin, closeMin, col.groomer.color)).join("")}
          </div>
        </div>`).join("")}
      ${nowLine}
    </div>
  </div>`;

  const summary = `
  <div class="card pad" style="margin-top:16px">
    <h3 class="section-title">Open slots</h3>
    ${columns.map((col) => `
      <div class="groomer-row">
        <span class="swatch" style="background:${col.groomer.color}"></span>
        <div class="grow"><strong>${esc(col.groomer.name)}</strong>
          <div class="faint" style="font-size:13px">${col.free.length
            ? col.free.map((f) => `${fmtMinutes(f.startMin)}–${fmtMinutes(f.endMin)}`).join(", ")
            : "Fully booked"}</div>
        </div>
      </div>`).join("")}
  </div>`;

  return grid + summary;
}

function scheduleBodyWeek(dateStr) {
  const hours = getBusinessHours();
  const openMin = toMinutes(hours.open), closeMin = toMinutes(hours.close);
  const weekStart = startOfWeekKey(dateStr);
  const days = [...Array(7)].map((_, i) => addDaysKey(weekStart, i));
  const hourMarks = []; for (let m = openMin; m <= closeMin; m += 60) hourMarks.push(m);
  const gridHeight = ((closeMin - openMin) / 60) * PX_PER_HOUR;
  const today = todayKey();
  const hiddenIds = state.scheduleHiddenGroomers;
  const now = nowMinutesToday();

  const cols = days.map((d) => {
    const dow = new Date(d + "T00:00:00").getDay();
    const closed = (hours.closedDays || []).includes(dow);
    const items = closed ? [] : layoutLanes(bookingsOnDate(d).filter((it) => !hiddenIds.includes(it.booking.groomerId)));
    return { dateStr: d, dow, closed, items };
  });

  return `
  <div class="card pad" style="overflow-x:auto">
    <div class="schedule-grid" style="height:${gridHeight}px">
      <div class="schedule-axis">
        ${hourMarks.map((m) => `<div class="axis-mark" style="top:${((m - openMin) / 60) * PX_PER_HOUR}px">${fmtMinutes(m)}</div>`).join("")}
      </div>
      ${cols.map((col) => `
        <div class="schedule-col">
          <div class="schedule-col-head week" data-action="goto-day" data-date="${col.dateStr}" style="cursor:pointer">
            <div class="day-name">${DAY_NAMES_SHORT[col.dow]}</div>
            <span class="day-num ${col.dateStr === today ? "today" : ""}">${new Date(col.dateStr + "T00:00:00").getDate()}</span>
          </div>
          <div class="schedule-col-body" style="height:${gridHeight}px">
            ${col.closed ? `<div class="closed-overlay">Closed</div>`
              : col.items.map((it) => scheduleBlockHtml(it, openMin, closeMin, groomerColor(it.booking.groomerId))).join("")}
            ${(col.dateStr === now.dateStr && now.min >= openMin && now.min <= closeMin)
              ? `<div class="now-line" style="top:${((now.min - openMin) / 60) * PX_PER_HOUR}px; left:0; right:0"><span class="now-dot"></span></div>` : ""}
          </div>
        </div>`).join("")}
    </div>
  </div>`;
}

function scheduleBodyMonth(dateStr) {
  const hours = getBusinessHours();
  const viewedMonth = new Date(dateStr + "T00:00:00").getMonth();
  const today = todayKey();
  const maxShow = 3;
  const hiddenIds = state.scheduleHiddenGroomers;

  const cells = monthGridDates(dateStr).map((d) => {
    const dow = new Date(d + "T00:00:00").getDay();
    const closed = (hours.closedDays || []).includes(dow);
    const inMonth = new Date(d + "T00:00:00").getMonth() === viewedMonth;
    const items = bookingsOnDate(d).filter((it) => !hiddenIds.includes(it.booking.groomerId));
    const shown = items.slice(0, maxShow);
    const more = items.length - shown.length;
    return `
      <div class="month-cell ${inMonth ? "" : "outside"}" data-action="goto-day" data-date="${d}">
        <div class="month-cell-date"><span class="day-num ${d === today ? "today" : ""}">${new Date(d + "T00:00:00").getDate()}</span>${closed ? " 🌙" : ""}</div>
        <div class="month-cell-items">
          ${shown.map((it) => `<div class="month-pill" style="background:${groomerColor(it.booking.groomerId)}">${esc(fmtMinutes(it.startMin))} ${esc(it.booking.petName)}</div>`).join("")}
          ${more > 0 ? `<div class="month-more">+${more} more</div>` : ""}
        </div>
      </div>`;
  }).join("");

  return `
  <div class="card pad">
    <div class="month-grid">
      ${DAY_NAMES_SHORT.map((d) => `<div class="month-dow">${d}</div>`).join("")}
      ${cells}
    </div>
  </div>`;
}

/* ---------- Business hours editor ---------- */
function hoursModal() {
  const h = getBusinessHours();
  openModal(`
    <h2>Business hours</h2>
    <div class="field-row">
      <div class="field"><label>Opens</label><input id="h-open" type="time" value="${esc(h.open)}"></div>
      <div class="field"><label>Closes</label><input id="h-close" type="time" value="${esc(h.close)}"></div>
    </div>
    <div class="field"><label>Closed on</label>
      <div class="tag-list">${DAY_NAMES.map((d, i) => `<label class="chip"><input type="checkbox" class="h-closed" value="${i}" ${(h.closedDays || []).includes(i) ? "checked" : ""}> ${d}</label>`).join("")}</div>
    </div>
    <div class="row" style="justify-content:flex-end; margin-top:8px">
      <button class="btn" data-close-modal>Cancel</button>
      <button class="btn primary" id="save-hours">Save</button>
    </div>`);
  $("#save-hours").onclick = async () => {
    const rec = {
      id: "hours",
      open: $("#h-open").value || "10:00",
      close: $("#h-close").value || "19:00",
      closedDays: $$(".h-closed").filter((c) => c.checked).map((c) => Number(c.value)),
      updatedAt: Date.now(),
    };
    await DB.put("settings", rec); upsertLocal("settings", rec);
    closeModal(); toast("Hours saved"); render();
  };
}

/* ---------- shared empty states ---------- */
function emptyInline(msg) { return `<div class="empty">${esc(msg)}</div>`; }
function emptyBlock(icon, title, sub, action, label) {
  return `<div class="card pad empty"><div class="big">${icon}</div>
    <h3 style="margin:0 0 4px">${esc(title)}</h3>
    <div class="muted" style="margin-bottom:16px">${esc(sub)}</div>
    ${action ? `<button class="btn primary" data-action="${action}">${esc(label)}</button>` : ""}</div>`;
}

/* ---------- filtering ---------- */
function filteredPets() {
  const n = state.search.name.trim().toLowerCase();
  const br = state.search.breed.trim().toLowerCase();
  return state.pets.filter((p) =>
    (!n || (p.name || "").toLowerCase().includes(n)) &&
    (!br || (p.breed || "").toLowerCase().includes(br)));
}
function upcomingBookings(limit) {
  const today = startOfToday();
  return state.bookings
    .map((b) => ({ b, when: nextOccurrence(b) }))
    .filter((x) => x.when && x.when >= today)
    .sort((a, b) => a.when - b.when)
    .slice(0, limit)
    .map((x) => x.b);
}

/* ===================================================================
   MODALS
=================================================================== */
const modalHost = () => $("#modal-host");
function openModal(html) { $("#modal-body").innerHTML = html; modalHost().hidden = false; }
function closeModal() { modalHost().hidden = true; $("#modal-body").innerHTML = ""; }

/* ---------- Pet editor ---------- */
function petEditorModal(pet) {
  const p = pet || { species: "dog", times: {} };
  const t = p.times || {};
  const opt = (val, cur, label) => `<option value="${val}" ${cur === val ? "selected" : ""}>${label}</option>`;
  openModal(`
    <h2>${pet ? "Edit pet" : "New pet profile"}</h2>
    <div class="muted" style="margin-bottom:16px">Photo, details and typical grooming times.</div>
    <div class="row" style="align-items:center; gap:18px; margin-bottom:16px">
      <div class="avatar" id="pet-avatar" ${p.photo ? `style="background-image:url('${p.photo}')"` : ""}>${p.photo ? "" : "📷"}</div>
      <div class="stack">
        <button class="btn sm" id="pick-photo">Upload photo</button>
        ${p.photo ? `<button class="btn sm ghost" id="clear-photo">Remove</button>` : ""}
        <div class="help">JPG/PNG, auto-resized.</div>
      </div>
      <input type="file" id="photo-input" accept="image/*" hidden>
    </div>
    <div class="field-row">
      <div class="field"><label>Name</label><input id="f-name" value="${esc(p.name || "")}" placeholder="Milo"></div>
      <div class="field"><label>Species</label><select id="f-species">${opt("dog", p.species, "🐶 Dog")}${opt("cat", p.species, "🐱 Cat")}</select></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Breed</label>
        <input id="f-breed" list="breed-list" value="${esc(p.breed || "")}" placeholder="Poodle, or type your own">
        <datalist id="breed-list">${allBreeds().map((b) => `<option value="${esc(b)}">`).join("")}</datalist>
      </div>
      <div class="field"><label>Weight (kg)</label><input id="f-weight" type="number" step="0.1" value="${esc(p.weight || "")}" placeholder="8.5"></div>
    </div>
    <div class="field"><label>Assigned groomer</label>
      <select id="f-groomer"><option value="">— Unassigned —</option>
        ${state.groomers.map((g) => `<option value="${g.id}" ${p.groomerId === g.id ? "selected" : ""}>${esc(g.name)}</option>`).join("")}
      </select></div>
    <h3 class="section-title" style="margin-top:6px">Typical time consumed (hours)</h3>
    <div class="field-row">
      <div class="field"><label>🚿 Basic</label><input id="f-shower" type="number" min="0" step="0.25" value="${esc(t.shower ?? "")}"></div>
      <div class="field"><label>💈 Styling</label><input id="f-styling" type="number" min="0" step="0.25" value="${esc(t.styling ?? "")}"></div>
    </div>
    <div class="row spread" style="margin-top:12px">
      ${pet ? `<button class="btn danger" data-action="del-pet" data-id="${p.id}">Delete pet</button>` : "<span></span>"}
      <div class="row"><button class="btn" data-close-modal>Cancel</button>
      <button class="btn primary" id="save-pet">Save</button></div>
    </div>`);

  // photo pick
  let photoData = p.photo || null;
  const avatar = $("#pet-avatar");
  $("#pick-photo").onclick = () => $("#photo-input").click();
  $("#photo-input").onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    photoData = await fileToResizedDataURL(file);
    avatar.style.backgroundImage = `url('${photoData}')`; avatar.textContent = "";
  };
  if ($("#clear-photo")) $("#clear-photo").onclick = () => { photoData = null; avatar.style.backgroundImage = ""; avatar.textContent = "📷"; };

  $("#save-pet").onclick = async () => {
    const name = $("#f-name").value.trim();
    if (!name) { toast("Please enter a name"); return; }
    const rec = {
      id: p.id || DB.uid("pet"),
      createdAt: p.createdAt || Date.now(),
      photo: photoData,
      name,
      species: $("#f-species").value,
      breed: $("#f-breed").value.trim(),
      weight: $("#f-weight").value.trim(),
      groomerId: $("#f-groomer").value || null,
      times: {
        shower: numOrNull($("#f-shower").value),
        styling: numOrNull($("#f-styling").value),
      },
      history: p.history || [],
    };
    await DB.put("pets", rec);
    upsertLocal("pets", rec);
    closeModal();
    toast(pet ? "Pet updated" : "Pet added");
    go("pet", rec.id);
    rememberBreed(rec.breed);
  };
  // Buttons inside a modal aren't covered by the generic [data-action] delegation (that
  // only runs on the main page render), so this needs its own explicit handler.
  const delBtn = $('[data-action="del-pet"]');
  if (delBtn) delBtn.onclick = () => handleAction("del-pet", { id: p.id });
}
const numOrNull = (v) => (v === "" || v == null ? null : Number(v));

/* ---------- Add service-history record ---------- */
function historyModal(pet) {
  const today = new Date().toISOString().slice(0, 10);
  openModal(`
    <h2>Add service record</h2>
    <div class="muted" style="margin-bottom:16px">${esc(pet.name)}</div>
    <div class="field-row">
      <div class="field"><label>Date</label><input id="h-date" type="date" value="${today}"></div>
      <div class="field"><label>Groomer</label>
        <select id="h-groomer">${state.groomers.map((g) => `<option value="${g.id}" ${pet.groomerId === g.id ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select></div>
    </div>
    <div class="field"><label>Services</label>
      <div class="tag-list">${SERVICES.map((s) => `<label class="chip"><input type="checkbox" class="h-svc" value="${s}"> ${s}</label>`).join("")}</div></div>
    <div class="field"><label>Notes</label><textarea id="h-notes" placeholder="Coat condition, behavior, products used…"></textarea></div>
    <div class="row" style="justify-content:flex-end; margin-top:8px">
      <button class="btn" data-close-modal>Cancel</button>
      <button class="btn primary" id="save-history">Save record</button>
    </div>`);
  $("#save-history").onclick = async () => {
    const rec = {
      date: $("#h-date").value || new Date().toISOString().slice(0, 10),
      groomerId: $("#h-groomer").value || null,
      services: $$(".h-svc").filter((c) => c.checked).map((c) => c.value),
      notes: $("#h-notes").value.trim(),
    };
    pet.history = pet.history || [];
    pet.history.push(rec);
    await DB.put("pets", pet);
    upsertLocal("pets", pet);
    closeModal(); toast("Record added"); render();
  };
}

/* ---------- Booking editor ---------- */
function bookingModal(booking, prefillPet) {
  const b = booking || {};
  const now = new Date(Date.now() + 60 * 60 * 1000); now.setMinutes(0, 0, 0);
  const startVal = b.start ? toLocalInput(b.start) : toLocalInput(now);

  // Resolve the initial matched pet: editing an existing booking, or opened via "Book" on a pet profile
  let matchedPet = prefillPet || (b.petId ? state.pets.find((p) => p.id === b.petId) : null) || null;
  let isNewPet = false;
  let newPetPhoto = null;
  const touchedHours = {}; // service label -> true once the user has hand-edited its hour field

  const initialName = b.petName || (matchedPet ? matchedPet.name : "");
  const initialBreed = b.breed || (matchedPet ? matchedPet.breed : "");
  const initialGroomer = b.groomerId || (matchedPet ? matchedPet.groomerId : "") || "";
  const initialWeight = matchedPet ? (matchedPet.weight || "") : "";
  const initialServices = b.services || [];
  const initialHours = b.serviceHours || {};

  openModal(`
    <h2>${booking ? "Edit booking" : "New booking"}</h2>
    <div class="muted" style="margin-bottom:16px">Appears on Google Calendar later with the groomer's color.</div>

    <div class="row" style="align-items:flex-start; gap:16px; margin-bottom:6px">
      <div class="mini-avatar" id="bk-avatar">🐾</div>
      <div class="grow" style="position:relative">
        <div class="field" style="margin-bottom:0">
          <label>Pet name</label>
          <input id="b-pet" autocomplete="off" value="${esc(initialName)}" placeholder="Type a pet name…">
        </div>
        <div id="pet-suggest" class="suggest-list" hidden></div>
        <div class="help" id="pet-status" style="margin-top:6px"></div>
      </div>
    </div>

    <div id="new-pet-box" class="card pad" style="margin:10px 0; background:var(--surface-2); border-style:dashed" hidden>
      <div class="spread" style="margin-bottom:8px"><strong>New pet profile</strong>
        <span class="faint" style="font-size:12px">Created together with this booking</span></div>
      <div class="field"><label>Species</label>
        <select id="np-species"><option value="dog">🐶 Dog</option><option value="cat">🐱 Cat</option></select></div>
      <button class="btn sm" id="np-photo-btn" type="button">Upload photo</button>
      <input type="file" id="np-photo-input" accept="image/*" hidden>
    </div>

    <div class="field-row three">
      <div class="field"><label>Breed</label>
        <input id="b-breed" list="breed-list" value="${esc(initialBreed)}" placeholder="Poodle, or type your own">
        <datalist id="breed-list">${allBreeds().map((b) => `<option value="${esc(b)}">`).join("")}</datalist>
      </div>
      <div class="field"><label>Groomer</label>
        <select id="b-groomer"><option value="">— Choose —</option>
          ${state.groomers.map((g) => `<option value="${g.id}" ${initialGroomer === g.id ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Weight (kg)</label>
        <input id="b-weight" type="number" step="0.1" placeholder="8.5" value="${esc(initialWeight)}">
      </div>
    </div>
    <div class="field-row">
      <div class="field"><label>Date & time</label><input id="b-start" type="datetime-local" value="${startVal}"></div>
      <div class="field"><label>Repeat</label>
        <select id="b-recur">${Object.entries(RECUR).map(([k, v]) => `<option value="${k}" ${(b.recurrence || "none") === k ? "selected" : ""}>${v.label}</option>`).join("")}</select></div>
    </div>
    <div class="field" id="b-until-field" ${(b.recurrence && b.recurrence !== "none") ? "" : "hidden"}>
      <label>Period — repeat until</label>
      <input id="b-until" type="date" value="${esc(b.recurrenceUntil || "")}">
      <div class="help">Leave blank to repeat with no set end date.</div>
    </div>

    <div class="field"><label>Services &amp; time (hours) — shown on Google Calendar</label>
      <div class="stack" style="gap:8px">
        ${SERVICES.map((s) => `
          <div class="service-row">
            <label class="chip"><input type="checkbox" class="b-svc" data-svc="${esc(s)}" ${initialServices.includes(s) ? "checked" : ""}> ${s}</label>
            <input type="number" class="b-hr" data-svc="${esc(s)}" min="0" step="0.25" placeholder="hrs"
              value="${esc(initialHours[s] ?? "")}" ${initialServices.includes(s) ? "" : "disabled"}>
          </div>`).join("")}
      </div>
      <div class="help" id="duration-total" style="margin-top:6px"></div>
      <div class="help" id="cost-estimate" style="margin-top:2px; font-weight:600"></div>
    </div>

    <div class="field"><label>Notes</label><textarea id="b-notes" placeholder="Anything the groomer should know…">${esc(b.notes || "")}</textarea></div>
    <div class="row" style="justify-content:flex-end; margin-top:8px">
      <button class="btn" data-close-modal>Cancel</button>
      <button class="btn primary" id="save-booking">${booking ? "Save" : "Create booking"}</button>
    </div>`);

  const avatarEl = $("#bk-avatar");
  const petInput = $("#b-pet");
  const suggestBox = $("#pet-suggest");
  const statusEl = $("#pet-status");
  const newPetBox = $("#new-pet-box");

  function paintAvatar() {
    if (matchedPet && matchedPet.photo) { avatarEl.style.backgroundImage = `url('${matchedPet.photo}')`; avatarEl.textContent = ""; }
    else if (isNewPet && newPetPhoto) { avatarEl.style.backgroundImage = `url('${newPetPhoto}')`; avatarEl.textContent = ""; }
    else if (isNewPet) { avatarEl.style.backgroundImage = ""; avatarEl.textContent = "📷"; }
    else if (matchedPet) { avatarEl.style.backgroundImage = ""; avatarEl.textContent = SPECIES[matchedPet.species] || "🐾"; }
    else { avatarEl.style.backgroundImage = ""; avatarEl.textContent = "🐾"; }
  }
  function paintStatus() {
    if (matchedPet) statusEl.innerHTML = `Existing pet selected · <button class="link" id="unmatch-pet" type="button">not this pet?</button>`;
    else if (isNewPet) statusEl.innerHTML = `Creating a new pet profile · <button class="link" id="unmatch-pet" type="button">search instead</button>`;
    else statusEl.textContent = "Start typing to find an existing pet, or add a new one.";
    const um = $("#unmatch-pet");
    if (um) um.onclick = () => { matchedPet = null; isNewPet = false; newPetBox.hidden = true; paintAvatar(); paintStatus(); petInput.focus(); updateCostEstimate(); };
  }
  function applyMatch(pet) {
    matchedPet = pet; isNewPet = false; newPetBox.hidden = true;
    petInput.value = pet.name;
    if (pet.breed) $("#b-breed").value = pet.breed;
    if (pet.groomerId) $("#b-groomer").value = pet.groomerId;
    if (pet.weight) $("#b-weight").value = pet.weight;
    suggestBox.hidden = true; suggestBox.innerHTML = "";
    paintAvatar(); paintStatus();
    prefillHoursFromPet();
  }
  function startNewPet() {
    matchedPet = null; isNewPet = true; newPetBox.hidden = false;
    suggestBox.hidden = true; suggestBox.innerHTML = "";
    paintAvatar(); paintStatus(); updateCostEstimate();
  }
  function renderSuggestions() {
    const q = petInput.value;
    if (matchedPet && q.trim().toLowerCase() === matchedPet.name.toLowerCase()) { suggestBox.hidden = true; return; }
    if (!q.trim()) { suggestBox.hidden = true; return; }
    const matches = findMatchingPets(q);
    const items = matches.map((p) => `
      <div class="suggest-item" data-pet-id="${p.id}">
        <div class="s-photo" ${p.photo ? `style="background-image:url('${p.photo}')"` : ""}>${p.photo ? "" : (SPECIES[p.species] || "🐾")}</div>
        <div class="s-info"><div class="s-name">${esc(p.name)}</div><div class="s-breed">${esc(p.breed || "—")}</div></div>
      </div>`).join("");
    const createItem = `<div class="suggest-item create" data-create="1">＋ Create new pet "${esc(q.trim())}"</div>`;
    suggestBox.innerHTML = items + createItem;
    suggestBox.hidden = false;
    $$(".suggest-item[data-pet-id]", suggestBox).forEach((el) => el.onclick = () => applyMatch(state.pets.find((p) => p.id === el.dataset.petId)));
    const createEl = suggestBox.querySelector(".suggest-item.create");
    if (createEl) createEl.onclick = startNewPet;
  }
  function prefillHoursFromPet() {
    if (!matchedPet) return;
    $$(".b-svc").forEach((cb) => {
      if (!cb.checked) return;
      const svc = cb.dataset.svc;
      if (touchedHours[svc]) return;
      const hrInput = $(`.b-hr[data-svc="${svc}"]`);
      const hrs = matchedPet.times && matchedPet.times[SERVICE_TIME_KEY[svc]];
      if (hrs != null && hrInput && !hrInput.value) hrInput.value = hrs;
    });
    updateTotal();
  }
  function updateTotal() {
    let sum = 0;
    $$(".b-svc").forEach((cb) => { if (cb.checked) sum += Number($(`.b-hr[data-svc="${cb.dataset.svc}"]`).value) || 0; });
    $("#duration-total").textContent = sum ? `Total on calendar: ${Math.round(sum * 100) / 100} hr` : "Enter hours for each selected service.";
    updateCostEstimate();
  }
  function updateCostEstimate() {
    const el = $("#cost-estimate");
    if (!el) return;
    const weight = $("#b-weight").value;
    const services = $$(".b-svc").filter((cb) => cb.checked).map((cb) => cb.dataset.svc);
    if (!services.length) { el.textContent = ""; return; }
    const est = estimateCost(weight, services);
    el.textContent = est ? `Estimated cost: ${est.label} (${est.tier})` : "Add the pet's weight to estimate cost.";
  }

  petInput.addEventListener("input", () => {
    if (matchedPet && petInput.value !== matchedPet.name) matchedPet = null;
    if (isNewPet) { isNewPet = false; newPetBox.hidden = true; }
    paintAvatar(); paintStatus(); renderSuggestions();
  });
  petInput.addEventListener("focus", renderSuggestions);

  $$(".b-svc").forEach((cb) => cb.addEventListener("change", () => {
    const svc = cb.dataset.svc;
    const hrInput = $(`.b-hr[data-svc="${svc}"]`);
    hrInput.disabled = !cb.checked;
    if (cb.checked) prefillHoursFromPet(); else { hrInput.value = ""; delete touchedHours[svc]; }
    updateTotal();
  }));
  $$(".b-hr").forEach((inp) => inp.addEventListener("input", () => { touchedHours[inp.dataset.svc] = true; updateTotal(); }));

  $("#b-recur").addEventListener("change", () => { $("#b-until-field").hidden = $("#b-recur").value === "none"; });

  $("#np-photo-btn").onclick = () => $("#np-photo-input").click();
  $("#np-photo-input").onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    newPetPhoto = await fileToResizedDataURL(file);
    paintAvatar();
  };
  $("#b-weight").addEventListener("input", updateCostEstimate);

  paintAvatar(); paintStatus();
  if (matchedPet) prefillHoursFromPet(); else updateTotal();

  $("#save-booking").onclick = async () => {
    const petName = petInput.value.trim();
    if (!petName) { toast("Please enter a pet"); return; }
    if (!$("#b-groomer").value) { toast("Please choose a groomer"); return; }
    const checkedServices = $$(".b-svc").filter((c) => c.checked);
    if (checkedServices.length === 0) { toast("Please select at least one service"); return; }
    for (const cb of checkedServices) {
      const hrInput = $(`.b-hr[data-svc="${cb.dataset.svc}"]`);
      if (!hrInput.value || Number(hrInput.value) <= 0) { toast(`Please enter hours for ${cb.dataset.svc}`); hrInput.focus(); return; }
    }

    const groomerId = $("#b-groomer").value;
    const breed = $("#b-breed").value.trim();
    const weight = $("#b-weight").value.trim();
    let petId = matchedPet ? matchedPet.id : null;

    if (!matchedPet) {
      const times = {};
      checkedServices.forEach((cb) => {
        const hrs = Number($(`.b-hr[data-svc="${cb.dataset.svc}"]`).value) || 0;
        times[SERVICE_TIME_KEY[cb.dataset.svc]] = hrs;
      });
      const newPet = {
        id: DB.uid("pet"), createdAt: Date.now(),
        photo: newPetPhoto, name: petName,
        species: ($("#np-species") && $("#np-species").value) || "dog",
        breed, weight,
        groomerId, times, history: [],
      };
      await DB.put("pets", newPet);
      upsertLocal("pets", newPet);
      petId = newPet.id;
    } else if (weight && weight !== String(matchedPet.weight || "")) {
      // Keep the pet's profile in sync if weight was updated right here in the booking form.
      const updatedPet = { ...matchedPet, weight };
      await DB.put("pets", updatedPet);
      upsertLocal("pets", updatedPet);
    }

    const serviceHours = {};
    checkedServices.forEach((cb) => { serviceHours[cb.dataset.svc] = Number($(`.b-hr[data-svc="${cb.dataset.svc}"]`).value) || 0; });

    const recurrence = $("#b-recur").value;
    const rec = {
      id: b.id || DB.uid("bk"),
      createdAt: b.createdAt || Date.now(),
      petId, petName, breed, groomerId,
      start: fromLocalInput($("#b-start").value),
      recurrence,
      recurrenceUntil: recurrence !== "none" ? ($("#b-until").value || null) : null,
      services: checkedServices.map((c) => c.dataset.svc),
      serviceHours,
      notes: $("#b-notes").value.trim(),
      calendarEventId: b.calendarEventId || null,
      calendarDirty: true, // cleared once any connected device successfully syncs it — see reconcileCalendar()
    };
    await DB.put("bookings", rec);
    upsertLocal("bookings", rec);
    closeModal(); toast(booking ? "Booking updated" : "Booking created"); render();
    reconcileCalendar();
    rememberBreed(rec.breed);
    logActivity("booking", booking ? "updated" : "created",
      `${rec.petName}${rec.breed ? ` (${rec.breed})` : ""} with ${groomerName(rec.groomerId)} — ${fmtDate(rec.start)} ${fmtTime(rec.start)}`);
  };
}

/* ---------- Google Calendar reconciliation ----------
   Sync no longer depends on "whoever made the change happened to be connected."
   Every booking create/update marks itself calendarDirty; every delete of a synced
   booking leaves a tombstone (calendarTombstones). ANY device that's currently
   connected — triggered by its own actions, by live updates from other devices, or
   right after connecting/silently renewing — processes the backlog: deletes
   tombstoned events, then creates/updates anything dirty or never-synced. This means
   a change made on an unconnected device still reaches Calendar as soon as any other
   connected device (or that same device, once reconnected) sees it. */
let reconciling = false;
let reconcilePending = false; // set when a trigger arrives while a pass is already running
async function reconcileCalendar() {
  if (reconciling) { reconcilePending = true; return; } // don't drop it — a follow-up pass will pick it up
  if (!GCal.isConnected()) return;
  const calendarId = getCalendarId();
  if (!calendarId) return;
  reconciling = true;
  try {
    for (const t of state.calendarTombstones) {
      try {
        await GCal.deleteBooking(t.calendarId || calendarId, t.eventId);
        await DB.del("calendarTombstones", t.id);
        removeLocal("calendarTombstones", t.id);
      } catch (err) {
        console.error("Tombstone sync failed", t, err);
        const rec = { ...t, calendarSyncError: err.message || String(err) };
        await DB.put("calendarTombstones", rec).catch(() => {});
        upsertLocal("calendarTombstones", rec);
      }
    }
    const pending = state.bookings.filter((b) => b.calendarDirty || !b.calendarEventId);
    for (const b of pending) {
      try {
        const eventId = await GCal.syncBooking(calendarId, b, groomerById(b.groomerId));
        b.calendarEventId = eventId;
        b.calendarDirty = false;
        b.calendarSyncError = null;
        await DB.put("bookings", b);
        upsertLocal("bookings", b);
      } catch (err) {
        console.error("Booking sync failed", b, err);
        b.calendarSyncError = err.message || String(err);
        await DB.put("bookings", b).catch(() => {});
        upsertLocal("bookings", b);
      }
    }
  } finally {
    reconciling = false;
    if (reconcilePending) { reconcilePending = false; reconcileCalendar(); }
  }
}
function toLocalInput(d) {
  const dt = new Date(d); const p = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}T${p(dt.getHours())}:${p(dt.getMinutes())}`;
}
function fromLocalInput(v) { return new Date(v).toISOString(); }

/* ---------- Groomer editor ---------- */
function groomerModal(groomer) {
  const g = groomer || { color: GROOMER_COLORS[0].color, calendarColorId: GROOMER_COLORS[0].calendarColorId };
  openModal(`
    <h2>${groomer ? "Edit groomer" : "Add groomer"}</h2>
    <div class="field"><label>Name</label><input id="g-name" value="${esc(g.name || "")}" placeholder="e.g. Nina"></div>
    <div class="field"><label>Color</label>
      <div class="color-pick" id="color-pick">
        ${GROOMER_COLORS.map((c) => `<div class="color-opt ${c.color === g.color ? "sel" : ""}" data-color="${c.color}" data-cal="${c.calendarColorId}" style="background:${c.color}" title="${esc(c.name)}"></div>`).join("")}
      </div>
      <div class="help">Used on booking stripes and Google Calendar events.</div></div>
    <div class="row" style="justify-content:flex-end; margin-top:8px">
      <button class="btn" data-close-modal>Cancel</button>
      <button class="btn primary" id="save-groomer">Save</button>
    </div>`);
  let color = g.color, cal = g.calendarColorId;
  $$("#color-pick .color-opt").forEach((el) => el.onclick = () => {
    $$("#color-pick .color-opt").forEach((x) => x.classList.remove("sel"));
    el.classList.add("sel"); color = el.dataset.color; cal = el.dataset.cal;
  });
  $("#save-groomer").onclick = async () => {
    const name = $("#g-name").value.trim();
    if (!name) { toast("Please enter a name"); return; }
    const rec = { id: g.id || DB.uid("grm"), createdAt: g.createdAt || Date.now(), name, color, calendarColorId: cal };
    await DB.put("groomers", rec);
    upsertLocal("groomers", rec);
    closeModal(); toast(groomer ? "Groomer updated" : "Groomer added"); render();
    logActivity("groomer", groomer ? "updated" : "created", rec.name);
  };
}

/* ---------- Admin editor (create only — see viewAdmins for remove) ---------- */
function adminModal() {
  openModal(`
    <h2>Add admin</h2>
    <div class="muted" style="margin-bottom:16px">They'll sign in with this name and PIN from now on.</div>
    <div class="field"><label>Name</label><input id="a-name" placeholder="e.g. Nina" autocomplete="off"></div>
    <div class="field"><label>PIN</label><input id="a-pin" type="password" inputmode="numeric" placeholder="6+ characters" autocomplete="new-password"></div>
    <div class="field"><label>Confirm PIN</label><input id="a-pin2" type="password" inputmode="numeric" placeholder="Repeat the PIN" autocomplete="new-password"></div>
    <div class="help" id="admin-error" style="color:var(--danger); font-weight:600"></div>
    <div class="row" style="justify-content:flex-end; margin-top:8px">
      <button class="btn" data-close-modal>Cancel</button>
      <button class="btn primary" id="save-admin">Add admin</button>
    </div>`);

  $("#save-admin").onclick = async () => {
    const name = $("#a-name").value.trim();
    const pin = $("#a-pin").value;
    const pin2 = $("#a-pin2").value;
    const errEl = $("#admin-error");
    errEl.textContent = "";
    if (!name) { errEl.textContent = "Please enter a name."; return; }
    if (name.trim().toLowerCase() === "owner") { errEl.textContent = "\"Owner\" is reserved for the master account."; return; }
    if (pin.length < 6) { errEl.textContent = "PIN must be at least 6 characters."; return; }
    if (pin !== pin2) { errEl.textContent = "PINs don't match."; return; }

    const btn = $("#save-admin");
    btn.disabled = true; btn.textContent = "Adding…";
    try {
      const rec = await DB.createAdmin({ name, email: emailForName(name), pin });
      upsertLocal("admins", rec);
      closeModal(); toast("Admin added"); render();
    } catch (err) {
      errEl.textContent = err.code === "auth/email-already-in-use"
        ? "That name is already taken — try a different one."
        : `Couldn't add admin (${err.code || err.message}).`;
      btn.disabled = false; btn.textContent = "Add admin";
    }
  };
}

/* ===================================================================
   EVENT BINDING
=================================================================== */
function bindView() {
  // navigation
  $$("[data-nav]").forEach((el) => el.onclick = () => { go(el.dataset.nav); closeMobileNav(); });
  // open pet cards
  $$("[data-open-pet]").forEach((el) => el.onclick = () => go("pet", el.dataset.openPet));

  // live search on home
  const qn = $("#q-name"), qb = $("#q-breed");
  if (qn) qn.oninput = () => { state.search.name = qn.value; renderHomeResults(); };
  if (qb) qb.oninput = () => { state.search.breed = qb.value; renderHomeResults(); };

  // schedule view-mode dropdown + groomer visibility toggles
  const schedMode = $("#sched-mode-select");
  if (schedMode) schedMode.onchange = () => { state.scheduleMode = schedMode.value; render(); };
  $$(".sched-groomer-toggle").forEach((cb) => cb.onchange = () => {
    const id = cb.dataset.id;
    state.scheduleHiddenGroomers = cb.checked
      ? state.scheduleHiddenGroomers.filter((x) => x !== id)
      : [...state.scheduleHiddenGroomers, id];
    render();
  });

  // actions
  $$("[data-action]").forEach((el) => el.onclick = () => handleAction(el.dataset.action, el.dataset));
}

// Re-render only home so the search inputs keep focus/caret
function renderHomeResults() {
  if (state.view !== "home") return;
  const focused = document.activeElement && document.activeElement.id;
  const selStart = focused ? document.activeElement.selectionStart : null;
  render();
  if (focused) { const el = $("#" + focused); if (el) { el.focus(); if (selStart != null) try { el.setSelectionRange(selStart, selStart); } catch (_) {} } }
}

async function handleAction(action, data) {
  switch (action) {
    case "new-pet": petEditorModal(null); break;
    case "edit-pet": petEditorModal(state.pets.find((p) => p.id === data.id)); break;
    case "del-pet":
      if (confirm("Delete this pet profile? This cannot be undone.")) {
        await DB.del("pets", data.id); removeLocal("pets", data.id); closeModal(); toast("Pet deleted"); go("pets");
      } break;
    case "add-history": historyModal(state.pets.find((p) => p.id === data.id)); break;
    case "del-history": {
      const pet = state.pets.find((p) => p.id === data.id);
      pet.history.splice(Number(data.idx), 1);
      await DB.put("pets", pet); upsertLocal("pets", pet); render();
    } break;
    case "new-booking": bookingModal(null); break;
    case "book-pet": bookingModal(null, state.pets.find((p) => p.id === data.id)); break;
    case "edit-booking": bookingModal(state.bookings.find((b) => b.id === data.id)); break;
    case "copy-confirm": {
      const b = state.bookings.find((x) => x.id === data.id);
      if (!b) break;
      const msg = bookingConfirmMessage(b);
      try { await navigator.clipboard.writeText(msg); toast("Copied — ready to paste to the customer"); }
      catch (err) { toast(`Couldn't copy automatically — here it is: ${msg}`); }
    } break;
    case "del-booking":
      if (confirm("Delete this booking?")) {
        const deleted = state.bookings.find((b) => b.id === data.id);
        await DB.del("bookings", data.id); removeLocal("bookings", data.id); toast("Booking deleted"); render();
        if (deleted && deleted.calendarEventId) {
          // Always queue a tombstone, connected or not — whichever device is connected
          // (this one now, or another one later) will pick it up via reconcileCalendar().
          const tomb = { id: DB.uid("tomb"), calendarId: getCalendarId() || null, eventId: deleted.calendarEventId, petName: deleted.petName, deletedAt: Date.now() };
          await DB.put("calendarTombstones", tomb);
          upsertLocal("calendarTombstones", tomb);
          reconcileCalendar();
        }
        if (deleted) logActivity("booking", "deleted", `${deleted.petName}${deleted.breed ? ` (${deleted.breed})` : ""} with ${groomerName(deleted.groomerId)}`);
      }
      break;
    case "new-groomer": groomerModal(null); break;
    case "edit-groomer": groomerModal(state.groomers.find((g) => g.id === data.id)); break;
    case "del-groomer": {
      const removed = state.groomers.find((g) => g.id === data.id);
      const count = state.bookings.filter((b) => b.groomerId === data.id).length;
      const msg = count ? `This groomer has ${count} booking(s). Remove anyway? Bookings stay but show as unassigned.` : "Remove this groomer?";
      if (confirm(msg)) {
        await DB.del("groomers", data.id); removeLocal("groomers", data.id); toast("Groomer removed"); render();
        if (removed) logActivity("groomer", "deleted", removed.name);
      }
    } break;
    case "new-admin": adminModal(); break;
    case "del-admin":
      if (data.id === DB.currentUid()) { toast("You can't remove yourself while signed in."); break; }
      if (confirm("Remove this admin? They'll immediately lose access.")) {
        await DB.removeAdmin(data.id); removeLocal("admins", data.id); toast("Admin removed"); render();
      } break;
    case "gcal-connect":
      try { await GCal.connect(); toast("Connected to Google Calendar"); render(); }
      catch (err) { toast("Couldn't connect — check your pop-up blocker and try again."); }
      break;
    case "gcal-save-id": {
      const id = $("#gcal-id").value.trim();
      if (!id) { toast("Please enter a Calendar ID"); break; }
      const rec = { id: "calendar", calendarId: id, updatedAt: Date.now() };
      await DB.put("settings", rec); upsertLocal("settings", rec); toast("Calendar ID saved"); render();
    } break;
    case "gcal-sync-now":
      toast("Syncing…");
      await reconcileCalendar();
      toast("Sync complete");
      render();
      break;
    case "sched-prev": {
      const cur = state.scheduleDate || todayKey(), m = state.scheduleMode;
      state.scheduleDate = m === "week" ? addDaysKey(cur, -7) : m === "month" ? addMonthsKey(cur, -1) : addDaysKey(cur, -1);
      render();
    } break;
    case "sched-next": {
      const cur = state.scheduleDate || todayKey(), m = state.scheduleMode;
      state.scheduleDate = m === "week" ? addDaysKey(cur, 7) : m === "month" ? addMonthsKey(cur, 1) : addDaysKey(cur, 1);
      render();
    } break;
    case "sched-today": state.scheduleDate = todayKey(); render(); break;
    case "goto-day": state.scheduleDate = data.date; state.scheduleMode = "day"; render(); break;
    case "sched-jump": state.scheduleDate = data.date; render(); break;
    case "mini-cal-prev": state.scheduleDate = addMonthsKey(state.scheduleDate || todayKey(), -1); render(); break;
    case "mini-cal-next": state.scheduleDate = addMonthsKey(state.scheduleDate || todayKey(), 1); render(); break;
    case "edit-hours": hoursModal(); break;
    case "clear-search": state.search = { name: "", breed: "" }; render(); break;
    case "go-pets": go("pets"); break;
  }
}

/* ---------- global chrome (modal close, brand) ---------- */
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-close-modal]")) closeModal();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
document.addEventListener("click", (e) => {
  const box = document.getElementById("pet-suggest");
  const input = document.getElementById("b-pet");
  if (box && !box.hidden && e.target !== input && !box.contains(e.target)) box.hidden = true;
});

// Mobile nav dropdown (the tab bar collapses behind a hamburger under 820px)
function closeMobileNav() { const t = document.getElementById("topnav"); if (t) t.classList.remove("open"); }
$("#nav-toggle").addEventListener("click", (e) => {
  e.stopPropagation();
  document.getElementById("topnav").classList.toggle("open");
});
document.addEventListener("click", (e) => {
  const t = document.getElementById("topnav");
  if (t && t.classList.contains("open") && !t.contains(e.target) && e.target.id !== "nav-toggle") closeMobileNav();
});

/* ===================================================================
   AUTH GATE + BOOT
=================================================================== */
const COLLECTIONS = ["pets", "groomers", "bookings", "admins", "settings", "activity", "calendarTombstones"];
let watchers = [];

function startWatchers() {
  watchers = COLLECTIONS.map((name) =>
    DB.watch(name, async (changed) => {
      state[changed] = await DB.getAll(changed);
      render();
      // Someone else's change (or this device's own) may need syncing to Calendar —
      // reconcileCalendar() no-ops instantly if this device isn't connected.
      if (changed === "bookings" || changed === "calendarTombstones") reconcileCalendar();
      // The very first read right after login can race ahead of Firestore's live data
      // (Promise.all below just snapshots the cache, it doesn't wait for it) — so the
      // banner's initial check might see an empty settings array and miss the Calendar
      // ID. Re-check every time settings actually arrives/changes, not just once.
      if (changed === "settings") updateGcalBanner();
    })
  );
}
function stopWatchers() {
  watchers.forEach((unsub) => unsub && unsub());
  watchers = [];
}

function showLoginError(msg) {
  const el = $("#login-error");
  el.textContent = msg; el.hidden = false;
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#login-name").value.trim();
  const pin = $("#login-pin").value.trim();
  if (!name || !pin) return;
  const btn = $("#login-btn");
  btn.disabled = true; btn.textContent = "Checking…";
  $("#login-error").hidden = true;
  try {
    await DB.login(emailForName(name), pin);
  } catch (err) {
    const wrongPin = ["auth/wrong-password", "auth/invalid-credential", "auth/user-not-found"].includes(err.code);
    showLoginError(wrongPin ? "Incorrect name or PIN. Please try again."
      : `Sign-in failed (${err.code || err.message}). Check firebase-config.js and your Firebase project setup.`);
    $("#login-pin").value = ""; $("#login-pin").focus();
  } finally {
    btn.disabled = false; btn.textContent = "Enter";
  }
});

$("#logout-btn").addEventListener("click", () => DB.logout());

// Keeps the Calendar tab's badge and the banner live across renewals.
GCal.onStatusChange((connected) => {
  if (state.view === "calendar") render();
  updateGcalBanner();
  if (connected) reconcileCalendar(); // catch up on anything that piled up while disconnected
});

DB.onAuthChange(async (user) => {
  if (!user) {
    stopWatchers();
    $("#app-shell").hidden = true;
    $("#login-gate").hidden = false;
    $("#login-pin").value = "";
    $("#login-name").focus();
    return;
  }
  try {
    await DB.seed();
    startWatchers();
    [state.pets, state.groomers, state.bookings, state.admins, state.settings, state.activity, state.calendarTombstones] = await Promise.all(
      COLLECTIONS.map((name) => DB.getAll(name))
    );
    $("#login-gate").hidden = true;
    $("#app-shell").hidden = false;
    gcalBannerDismissed = false;
    render();
    migratePetTimesToHours();
    migrateShowerLabelToBasic();
    updateGcalBanner();
  } catch (err) {
    // Most likely a revoked admin: their login still works, but Firestore rules deny them.
    stopWatchers();
    await DB.logout();
    showLoginError(err.code === "permission-denied"
      ? "Your access has been removed. Contact an admin."
      : `Couldn't load data (${err.code || err.message}).`);
  }
});
