/* ===================================================================
   app.js — Pawfect Grooming Studio
   Views: home / pets / pet detail / bookings / groomers
   Plain JS, no framework. State cached in memory, persisted via DB.
=================================================================== */

/* ---------- constants ---------- */
const SPECIES = { dog: "🐶", cat: "🐱" };
const SERVICES = ["Basic", "Hair Styling"];
// Display-only rename ("Hair Styling" -> "Styling"): SERVICES stays as-is since it's the
// literal string stored in every booking's services array/serviceHours keys — renaming the
// stored value would silently break cost/surcharge lookups on every existing booking. This
// only swaps what staff actually see.
const SERVICE_DISPLAY_LABELS = { "Hair Styling": "Styling" };
function serviceLabel(s) { return SERVICE_DISPLAY_LABELS[s] || s; }
// Suggested breeds for the booking form's breed field (a <datalist>, so typing
// anything else — mixed breeds, less common breeds — still works fine). Shown list
// depends on the selected species (dog vs cat).
const DOG_BREEDS = [
  "Corgi", "Pomeranian", "Maltipoo", "Poodle", "Siberian Husky", "Labrador Retriever",
  "Golden Retriever", "Shih Tzu", "Chihuahua", "French Bulldog", "Bulldog", "Beagle",
  "Pug", "Maltese", "Schnauzer", "Shiba Inu", "Border Collie", "Dachshund",
  "Yorkshire Terrier", "Cavalier King Charles Spaniel", "Bichon Frise", "Coton de Tulear",
];
const CAT_BREEDS = [
  "Domestic Shorthair", "Domestic Longhair", "Persian", "Siamese", "British Shorthair",
  "Scottish Fold", "Maine Coon", "Ragdoll", "American Shorthair", "Exotic Shorthair",
  "Sphynx", "Bengal", "Munchkin", "Burmese", "Himalayan",
  "Russian Blue", "Norwegian Forest Cat", "Abyssinian", "Turkish Angora", "Manx",
];
function breedsForSpecies(species) { return species === "cat" ? CAT_BREEDS : DOG_BREEDS; }
const RECUR = {
  none:    { label: "One-time",       rrule: null },
  weekly:  { label: "Every week",     rrule: "FREQ=WEEKLY" },
  biweekly:{ label: "Every 2 weeks",  rrule: "FREQ=WEEKLY;INTERVAL=2" },
  monthly: { label: "Every month",    rrule: "FREQ=MONTHLY" },
};
// Maps a booking service label to the key used in a pet profile's typical-time fields
const SERVICE_TIME_KEY = { "Basic": "shower", "Hair Styling": "styling" };
// Weight-tier pricing (THB) from the shop's price sheet. Each tier's Basic/Hair Styling
// price is a [short, long] pair. For dogs both are always a single exact figure. For cats,
// the "long" Hair Styling price is sometimes itself a small set of exact prices instead of
// one number (staff picks the one that matches the pet's actual coat/work at booking time)
// — modeled as an array, e.g. fullGroom: [900, [1000, 1100, 1200]], vs. a plain number for
// every other short/long slot.
const DOG_WEIGHT_TIERS = [
  { name: "Tiny",         maxKg: 5,  basic: [450, 500],   fullGroom: [500, 700] },
  { name: "Small",        maxKg: 10, basic: [500, 600],   fullGroom: [700, 850] },
  { name: "Medium",       maxKg: 15, basic: [650, 750],   fullGroom: [850, 1100] },
  { name: "Large",        maxKg: 20, basic: [800, 900],   fullGroom: [1200, 1400] },
  { name: "Extra-Large",  maxKg: 30, basic: [950, 1200],  fullGroom: [1500, 1700] },
  { name: "Giant",        maxKg: 40, basic: [1200, 1500], fullGroom: [1700, 2000] },
  { name: "Extra-Giant",  maxKg: 50, basic: [1500, 1700], fullGroom: [2100, 2500] },
];
const CAT_WEIGHT_TIERS = [
  { name: "Small",        maxKg: 4,        basic: [600, 700], fullGroom: [900, [1000, 1100, 1200]] },
  { name: "Medium-Large", maxKg: Infinity, basic: [700, 900], fullGroom: [1200, [1300, 1400, 1500]] },
];
// Dog-only surcharge for coat-heavy breeds (per the shop's price sheet breed callouts under
// Basic/Hair Styling) — applied automatically regardless of weight tier or hair length.
// Matched by substring so "Toy Poodle", "Bichon Frise", "Coton de Tulear", etc. all qualify.
const PREMIUM_BREED_KEYWORDS = ["bichon", "coton", "maltipoo", "maltese", "poodle"];
const PREMIUM_BREED_SURCHARGE = { "Basic": 100, "Hair Styling": 200 };
function isPremiumBreed(breed) {
  if (!breed) return false;
  const b = breed.toLowerCase();
  return PREMIUM_BREED_KEYWORDS.some((k) => b.includes(k));
}
function premiumSurcharge(species, breed, services) {
  if (species !== "dog" || !isPremiumBreed(breed)) return 0;
  let sur = 0;
  if (services.includes("Basic")) sur += PREMIUM_BREED_SURCHARGE["Basic"];
  if (services.includes("Hair Styling")) sur += PREMIUM_BREED_SURCHARGE["Hair Styling"];
  return sur;
}
function tiersForSpecies(species) { return species === "cat" ? CAT_WEIGHT_TIERS : DOG_WEIGHT_TIERS; }
function tierForWeight(kg, species) {
  const n = Number(kg);
  if (!kg || isNaN(n) || n <= 0) return null;
  const tiers = tiersForSpecies(species);
  return tiers.find((t) => n <= t.maxKg) || tiers[tiers.length - 1];
}
// range[1] may be an array (see CAT_WEIGHT_TIERS' multi-option long Hair Styling price) —
// collapse it to its highest option so the summary pill still reads as a plain low–high range.
function fmtPriceRange(range) {
  const hi = Array.isArray(range[1]) ? Math.max(...range[1]) : range[1];
  return range[0] === hi ? `฿${range[0]}` : `฿${range[0]}–${hi}`;
}
// A tier's long Hair Styling price may be a fixed number or (cats) an array of a few exact
// options — these two helpers make every other call site treat it as a single number without
// caring which.
function tierLongMax(tier) {
  const v = tier.fullGroom[1];
  return Array.isArray(v) ? Math.max(...v) : v;
}
function tierLongPrice(tier, override) {
  const v = tier.fullGroom[1];
  if (!Array.isArray(v)) return v;
  return v.includes(Number(override)) ? Number(override) : v[0];
}
// VIP pets get 10% off Basic + Hair Styling (not Add-on), applied after any premium-breed
// surcharge — e.g. Basic ฿500 + ฿100 breed surcharge = ฿600, VIP price ฿540.
const VIP_DISCOUNT_RATE = 0.10;
// Estimated total for the given services at this pet's weight tier. Returns null if
// weight is unknown or no priced service is selected. Pass hairLength ("short"/"long") to
// collapse the short/long pair to that exact figure; omit it to get the full range
// (min/max), e.g. for a quick display before the user has picked one. `breed` drives the
// premium-breed surcharge (dogs only). `styleLongOverride` picks which exact price to use
// when a cat's long Hair Styling price is a multi-option range (see tierLongPrice above) —
// defaults to the lowest option when omitted or not one of the valid options. `vip` applies
// the 10% VIP discount; the returned `regular` field is the pre-discount price for reference.
function estimateCost(weightKg, services, species, hairLength, breed, styleLongOverride, vip) {
  const tier = tierForWeight(weightKg, species);
  if (!tier || !services || !services.length) return null;
  const idx = hairLength === "long" ? 1 : hairLength === "short" ? 0 : null;
  const styleOptions = Array.isArray(tier.fullGroom[1]) ? tier.fullGroom[1] : null;
  const surcharge = premiumSurcharge(species, breed, services);
  let min = 0, max = 0, matched = false;
  if (services.includes("Basic")) { min += tier.basic[0]; max += tier.basic[1]; matched = true; }
  if (services.includes("Hair Styling")) { min += tier.fullGroom[0]; max += tierLongMax(tier); matched = true; }
  if (!matched) return null;
  min += surcharge; max += surcharge;
  if (idx !== null) {
    const basicPart = services.includes("Basic") ? tier.basic[idx] : 0;
    const stylePart = services.includes("Hair Styling")
      ? (idx === 1 ? tierLongPrice(tier, styleLongOverride) : tier.fullGroom[0])
      : 0;
    const regular = basicPart + stylePart + surcharge;
    const exact = vip ? Math.round(regular * (1 - VIP_DISCOUNT_RATE)) : regular;
    return {
      tier: tier.name, min: exact, max: exact, label: `฿${exact}`, surcharge, regular, vip: !!vip,
      styleOptions: (idx === 1 && services.includes("Hair Styling")) ? styleOptions : null,
      styleLongPrice: (idx === 1 && services.includes("Hair Styling")) ? stylePart : null,
    };
  }
  if (vip) { min = Math.round(min * (1 - VIP_DISCOUNT_RATE)); max = Math.round(max * (1 - VIP_DISCOUNT_RATE)); }
  return { tier: tier.name, min, max, label: min === max ? `฿${min}` : `฿${min}–${max}`, surcharge, regular: null, vip: !!vip, styleOptions: null, styleLongPrice: null };
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
const state = { view: "home", petId: null, pets: [], groomers: [], bookings: [], admins: [], settings: [], activity: [], calendarTombstones: [], deletedBookings: [], scheduleDate: "", scheduleHiddenGroomers: [], scheduleMiniCalOpen: false, financialStart: "", financialEnd: "", financialCalMonth: "", financialCalOpen: false, upcomingRange: "day", bookingsOpen: { completed: false, cancelled: false, bin: false }, search: { name: "", breed: "" } };
const getCalendarId = () => (state.settings.find((s) => s.id === "calendar") || {}).calendarId || "";
const getCustomBreeds = () => (state.settings.find((s) => s.id === "breeds") || {}).list || [];

/* ---------- roles & access ----------
   Three levels: App Owner (the fixed bootstrap account, SHOP_LOGIN_EMAIL — always full
   access, not stored in "admins"), Admin (full add/edit/delete within whichever sections
   they can see), Groomer (add/edit within their sections, never delete). Only the App Owner
   can add/remove people or change the per-role section list — enforced here in the UI, and
   again in Firestore Security Rules for delete operations (see README's rules block) so it
   holds even against a direct API call, not just a hidden button. */
const ALL_SECTIONS = [
  { key: "home", label: "Home" },
  { key: "pets", label: "Pets" },
  { key: "bookings", label: "Bookings" },
  { key: "schedule", label: "Schedule" },
  { key: "financial", label: "Financial" },
  { key: "groomers", label: "Groomers" },
  { key: "calendar", label: "Calendar" },
];
// "Admins" is deliberately not a selectable section anywhere — that page is App Owner-only,
// full stop, regardless of what a role's section list contains.
const DEFAULT_ROLE_SECTIONS = {
  admin: ALL_SECTIONS.map((s) => s.key),
  groomer: ["home", "pets", "bookings", "schedule"],
};
const isOwnerSession = () => DB.currentEmail() === SHOP_LOGIN_EMAIL;
const currentAdminDoc = () => state.admins.find((a) => a.uid === DB.currentUid());
// Missing `role` (an admin created before roles existed) defaults to "admin" — preserves
// full access for everyone who already had it, no manual migration needed.
function currentRole() {
  if (isOwnerSession()) return "owner";
  const a = currentAdminDoc();
  return (a && a.role) || "admin";
}
function roleSectionsConfig() {
  const rec = state.settings.find((s) => s.id === "roles");
  return {
    admin: (rec && rec.admin && rec.admin.length) ? rec.admin : DEFAULT_ROLE_SECTIONS.admin,
    groomer: (rec && rec.groomer && rec.groomer.length) ? rec.groomer : DEFAULT_ROLE_SECTIONS.groomer,
  };
}
// The nav/section keys this session may view. "home" is always included — it's the landing
// page every session needs, regardless of role configuration.
function allowedSections() {
  if (isOwnerSession()) return [...ALL_SECTIONS.map((s) => s.key), "admins"];
  const cfg = roleSectionsConfig();
  const sections = cfg[currentRole()] || [];
  return sections.includes("home") ? sections : ["home", ...sections];
}
// "pet" (a single pet's detail page) isn't its own nav section — it's gated by "pets".
function sectionKeyForView(view) { return view === "pet" ? "pets" : view; }
function canAccessView(view) { return isOwnerSession() || allowedSections().includes(sectionKeyForView(view)); }
const canDelete = () => isOwnerSession() || currentRole() === "admin";
// Static per-species list plus any breed staff have typed in before (shared across
// species — a small imprecision, but keeps the "remembered breeds" data model simple),
// deduped case-insensitively.
function allBreeds(species) {
  const seen = new Set();
  const out = [];
  [...breedsForSpecies(species), ...getCustomBreeds()].forEach((b) => {
    const key = b.trim().toLowerCase();
    if (key && !seen.has(key)) { seen.add(key); out.push(b.trim()); }
  });
  return out;
}
// Remembers a newly-typed breed (if it's new) so it shows up as a suggestion next time.
async function rememberBreed(breed) {
  const b = (breed || "").trim();
  if (!b) return;
  const known = [...DOG_BREEDS, ...CAT_BREEDS, ...getCustomBreeds()].map((x) => x.toLowerCase());
  if (known.includes(b.toLowerCase())) return;
  const rec = { id: "breeds", list: [...getCustomBreeds(), b], updatedAt: Date.now() };
  await DB.put("settings", rec);
  upsertLocal("settings", rec);
}

// Every non-empty, in-order run of SERVICES (plus the 2-service combo reversed, in case a
// title lists them the other way round), longest text first — used to greedily match the
// service portion of an imported Calendar event's title. Small by construction (SERVICES
// only has 2 entries today) so this stays cheap even recomputed on every parse.
function serviceCombos() {
  const combos = [];
  for (let i = 0; i < SERVICES.length; i++) {
    for (let j = i; j < SERVICES.length; j++) combos.push(SERVICES.slice(i, j + 1));
  }
  if (SERVICES.length === 2) combos.push([SERVICES[1], SERVICES[0]]);
  return combos.sort((a, b) => b.join(", ").length - a.join(", ").length);
}
// All known breed names (both species + anything staff has typed before), longest first so
// a multi-word breed matches before a shorter one that happens to be its prefix.
function allKnownBreeds() {
  const seen = new Set();
  const out = [];
  [...DOG_BREEDS, ...CAT_BREEDS, ...getCustomBreeds()].forEach((b) => {
    const key = b.trim().toLowerCase();
    if (key && !seen.has(key)) { seen.add(key); out.push(b.trim()); }
  });
  return out.sort((a, b) => b.length - a.length);
}

/* ---------- Calendar-import title parsing helpers ----------
   Real hand-typed Calendar titles drift from the app's own "Name Breed Service Remark"
   format in predictable ways: shorthand service words ("styling" instead of "Hair
   Styling"), breeds spelled without a space ("shihtzu"), and multi-word or "&"/"and"-joined
   pet names. These helpers are additive — none of them touch SERVICES/DOG_BREEDS/CAT_BREEDS/
   getCustomBreeds(), so the normal booking form is completely unaffected; they only make the
   one-time import's best-effort parse recognize more of what staff actually typed. */

// Shorthand words that should count as one of the two real services, in addition to the
// exact labels. Not exhaustive by design — the review step is always there to fix whatever
// this doesn't catch.
const SERVICE_SYNONYMS = {
  "Basic": ["basic", "bath", "shower"],
  "Hair Styling": ["hair styling", "styling", "style", "groom", "full groom"],
};
// serviceCombos()'s multi-service labels, plus every synonym mapped back to its single
// canonical service — longest label first so e.g. "full groom" wins over "groom".
function serviceSynonymEntries() {
  const out = serviceCombos().map((combo) => ({ label: combo.join(", "), services: combo }));
  Object.entries(SERVICE_SYNONYMS).forEach(([canonical, synonyms]) => {
    synonyms.forEach((syn) => out.push({ label: syn, services: [canonical] }));
  });
  return out.sort((a, b) => b.label.length - a.label.length);
}
function matchServicePrefix(text) {
  for (const { label, services } of serviceSynonymEntries()) {
    if (text.toLowerCase().startsWith(label.toLowerCase())) return { services, matchedLength: label.length };
  }
  return null;
}

// Shorthand seen in real Calendar titles, mapped to their canonical breed name (some of
// which — Coton de Tulear, Bichon Frise — are now also real DOG_BREEDS entries; the alias
// here is just what catches the shorthand itself, e.g. "coton" alone, during import parsing).
const BREED_ALIASES = {
  multipoo: "Maltipoo", // already a real DOG_BREEDS entry, just a common alternate spelling
  coton: "Coton de Tulear",
  westie: "West Highland White Terrier",
  bichon: "Bichon Frise",
};
// allKnownBreeds() entries plus BREED_ALIASES keys, longest trigger first.
function breedMatchCandidates() {
  const seen = new Set();
  const out = [];
  const add = (trigger, canonical) => {
    const key = trigger.trim().toLowerCase();
    if (key && !seen.has(key)) { seen.add(key); out.push({ trigger: trigger.trim(), canonical }); }
  };
  allKnownBreeds().forEach((b) => add(b, b));
  Object.entries(BREED_ALIASES).forEach(([alias, canonical]) => add(alias, canonical));
  return out.sort((a, b) => b.trigger.length - a.trigger.length);
}
// Matches a breed at the start of `text`, tolerating missing/extra spaces or hyphens inside
// the breed name (so "shihtzu" still matches "Shih Tzu") — internal whitespace/hyphens in
// the trigger become a flexible [\s-]* run rather than requiring an exact match.
function matchBreedPrefix(text) {
  for (const { trigger, canonical } of breedMatchCandidates()) {
    const pattern = trigger
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/[\s-]+/g, "[\\s-]*");
    const m = new RegExp("^" + pattern, "i").exec(text);
    if (m) return { breed: canonical, matchedLength: m[0].length };
  }
  return null;
}
// Scans forward through the token sequence for the earliest point where a recognizable
// breed or service begins, so a multi-word (or "&"/"and"-joined) pet name gets captured
// whole instead of always assuming the name is exactly one word. Returns null if nothing
// is found anywhere, in which case callers fall back to the one-word assumption.
function findNameAnchor(tokens) {
  for (let k = 1; k < tokens.length; k++) {
    const suffix = tokens.slice(k).join(" ");
    if (matchBreedPrefix(suffix) || matchServicePrefix(suffix)) return k;
  }
  return null;
}

// Best-effort parse of a Calendar event title built as "Name Breed Service[, Service] Remark"
// back into booking fields — used only by the one-time Calendar import tool (see
// calendarImportModal below). Breed and service are matched against known lists (plus the
// synonym/alias tables above); the pet name is whatever precedes the earliest recognized
// breed/service, falling back to just the first word if neither is found anywhere. Never
// throws — worst case everything after the name lands in notes for a human to sort out
// during the review step, which is also where `nameFallback`/`hasNameJoiner` steer the
// "needs attention" grouping (see importCandidateFromEvent).
function parseEventSummary(summary) {
  const text = (summary || "").trim();
  if (!text) return { petName: "", breed: "", services: [], notes: "", nameFallback: false, hasNameJoiner: false };
  const tokens = text.split(/\s+/);
  const anchor = findNameAnchor(tokens);
  const nameTokenCount = anchor ?? 1;
  const petName = tokens.slice(0, nameTokenCount).join(" ");
  let rest = tokens.slice(nameTokenCount).join(" ");

  let breed = "";
  const breedMatch = matchBreedPrefix(rest);
  if (breedMatch) { breed = breedMatch.breed; rest = rest.slice(breedMatch.matchedLength).trim(); }

  let services = [];
  const serviceMatch = matchServicePrefix(rest);
  if (serviceMatch) { services = serviceMatch.services; rest = rest.slice(serviceMatch.matchedLength).trim(); }

  return {
    petName, breed, services, notes: rest,
    nameFallback: anchor === null,
    hasNameJoiner: /&|\band\b/i.test(petName),
  };
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

// Derives the Firebase Auth login email an admin's name maps to. "App Owner" (or the older
// "Owner", kept as an alias so nothing already muscle-memorized breaks) always maps to the
// bootstrap account set up manually in the Firebase Console.
function emailForName(name) {
  const n = name.trim().toLowerCase();
  if (n === "owner" || n === "app owner") return SHOP_LOGIN_EMAIL;
  const slug = n.replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
  return `${slug}@pawfect.local`;
}
function currentAdminName() {
  if (DB.currentEmail() === SHOP_LOGIN_EMAIL) return "App Owner";
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
  booking: { created: "📅", updated: "✏️", deleted: "🗑", restored: "↩️", purged: "🗑" },
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
    .filter((b) => b.status !== "cancelled")
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
// True once a pending (unresolved) booking's date has fully passed — a one-time booking
// whose day is behind us, or a recurring series that has ended (recurrenceUntil passed) —
// and it still needs someone to confirm it as Completed or Cancelled.
function isPastDue(b) {
  if (b.status && b.status !== "pending") return false;
  const occ = nextOccurrence(b);
  if (occ === null) return true; // series ended, never resolved
  if ((!b.recurrence || b.recurrence === "none") && occ < startOfToday()) return true;
  return false;
}
// Restricts an already-upcoming (pending, not-past-due) list to occurrences within N days
// of today; "all" (or an empty list) is returned as-is.
function filterByUpcomingRange(upcoming, range) {
  if (range === "all" || !upcoming.length) return upcoming;
  // +1 so "day" covers today AND tomorrow (not just the remainder of today) — otherwise a
  // shop closed today with bookings starting tomorrow would show zero results for "Next day".
  const days = (range === "week" ? 7 : range === "month" ? 30 : 1) + 1;
  const cutoff = startOfToday();
  cutoff.setDate(cutoff.getDate() + days);
  return upcoming.filter((b) => nextOccurrence(b) < cutoff);
}
function bookingDurationHours(b) {
  if (!b.serviceHours) return 0;
  const sum = Object.values(b.serviceHours).reduce((a, v) => a + (Number(v) || 0), 0);
  return Math.round(sum * 100) / 100;
}

/* ---------- lookups ---------- */
const groomerById = (id) => state.groomers.find((g) => g.id === id);
function groomerColor(id) { const g = groomerById(id); return g ? g.color : "#c3c8d4"; }
// Light background tint for a booking row (kept subtle so black text stays easily readable
// over it) — same alpha level already used for the status-completed/cancelled badge pills.
function hexToRgba(hex, alpha) {
  const h = (hex || "").replace("#", "");
  const r = parseInt(h.substring(0, 2), 16) || 0;
  const g = parseInt(h.substring(2, 4), 16) || 0;
  const b = parseInt(h.substring(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function groomerName(id) { const g = groomerById(id); return g ? g.name : "No preference"; }
const groomerByCalendarColorId = (colorId) => colorId ? state.groomers.find((g) => g.calendarColorId === colorId) : null;
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

// Tracks which "page" was on screen at the last render, so render() can tell a real page
// switch (scroll to top, like a fresh page load) apart from a re-render of the *same* page
// after a background data change (saving/completing/deleting a booking, another device's
// edit arriving via onSnapshot, etc.) — those should leave the user's scroll position alone.
let lastRenderedPage = null;
function render() {
  // Self-heals if a role's access changed while this session was sitting on a page it can
  // no longer see (e.g. the App Owner just unchecked a section for their role, live).
  if (!canAccessView(state.view)) { state.view = "home"; state.petId = null; }
  const allowed = allowedSections();
  $$(".nav-btn").forEach((b) => {
    const key = b.dataset.nav;
    b.hidden = key !== "home" && !allowed.includes(key);
    b.classList.toggle("active", key === state.view);
  });
  const v = $("#view");
  if (state.view === "home") v.innerHTML = viewHome();
  else if (state.view === "pets") v.innerHTML = viewPets();
  else if (state.view === "pet") v.innerHTML = viewPetDetail();
  else if (state.view === "bookings") v.innerHTML = viewBookings();
  else if (state.view === "groomers") v.innerHTML = viewGroomers();
  else if (state.view === "admins") v.innerHTML = viewAdmins();
  else if (state.view === "calendar") v.innerHTML = viewCalendarSettings();
  else if (state.view === "schedule") v.innerHTML = viewSchedule();
  else if (state.view === "financial") v.innerHTML = viewFinancial();
  bindView();
  const page = `${state.view}:${state.petId || ""}`;
  if (page !== lastRenderedPage) window.scrollTo({ top: 0 });
  lastRenderedPage = page;
}

function go(view, petId = null) {
  if (!canAccessView(view)) { toast("You don't have access to that section"); return; }
  state.view = view; state.petId = petId; render();
}

/* ---------- HOME ---------- */
function viewHome() {
  const results = filteredPets();
  const searching = state.search.name || state.search.breed;
  const upcoming = upcomingBookings(); // no limit — Home now lists every upcoming booking, compactly
  const recent = [...state.activity].sort((a, b) => b.at - a.at).slice(0, 8);

  return `
  <div class="page-head">
    <div><h1>Welcome back 🐾</h1><div class="muted">Your Grooming Partner</div></div>
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
      <h3 class="section-title" style="margin:0 0 10px">Upcoming bookings</h3>
      ${upcoming.length
        ? `<div class="home-bookings-list">${homeUpcomingList(upcoming)}</div>`
        : emptyInline("No upcoming bookings yet.")}
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
      <p class="name">${esc(p.name)}${p.vip ? ` <span class="vip-badge">⭐ VIP</span>` : ""}</p>
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
  // "Service history" merges manually-added records with this pet's own completed bookings,
  // so staff see the full picture without having to separately dig through Bookings.
  // origIdx tracks each manual record's real position in p.history (needed for del-history)
  // independent of where it lands after sorting/merging with booking-derived rows.
  const manualHistory = (p.history || []).map((h, idx) => ({
    date: h.date, services: h.services || [], groomerId: h.groomerId, notes: h.notes || "",
    cost: null, fromBooking: false, origIdx: idx,
  }));
  const bookingHistory = state.bookings
    .filter((b) => b.petId === p.id && b.status === "completed")
    .map((b) => ({
      date: b.start, services: b.services || [], groomerId: b.groomerId, notes: b.notes || "",
      cost: b.totalCost, fromBooking: true,
    }));
  const history = [...manualHistory, ...bookingHistory].sort((a, b) => new Date(b.date) - new Date(a.date));
  const photo = p.photo ? `style="background-image:url('${p.photo}')"` : "";
  const priceTier = tierForWeight(p.weight, p.species);

  return `
  <button class="btn ghost sm" data-nav="pets">← All pets</button>
  <div class="card pad" style="margin-top:12px">
    <div class="row" style="align-items:flex-start; gap:22px">
      <div class="avatar" ${photo}>${p.photo ? "" : SPECIES[p.species] || "🐾"}</div>
      <div class="grow">
        <div class="spread">
          <div>
            <h1 style="margin:0 0 2px">${esc(p.name)} <span style="font-size:22px">${SPECIES[p.species] || ""}</span>${p.vip ? ` <span class="vip-badge">⭐ VIP</span>` : ""}</h1>
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
            <span class="time-pill">🚿 Basic · ${fmtPriceRange(priceTier.basic)}</span>
            <span class="time-pill">💈 Full Groom · ${fmtPriceRange(priceTier.fullGroom)}</span>
          </div>` : ""}
      </div>
    </div>
  </div>

  <div class="card pad" style="margin-top:16px">
    <div class="spread"><h3 class="section-title" style="margin:0">Service history</h3>
      <button class="btn sm" data-action="add-history" data-id="${p.id}">＋ Add record</button></div>
    <div style="margin-top:8px">
      ${history.length ? history.map((h) => `
        <div class="history-item">
          <div class="h-date">${fmtDate(h.date)}</div>
          <div class="h-body">
            <div class="row spread">
              <div><strong>${(h.services || []).map(esc).join(", ") || "Service"}</strong>
                <span class="groomer-tag" style="margin-left:8px"><span class="dot" style="background:${groomerColor(h.groomerId)}"></span>${esc(groomerName(h.groomerId))}</span>
                ${h.fromBooking ? ` <span class="recur-badge" style="margin-left:6px">Booking</span>` : ""}
                ${h.cost != null && h.cost !== "" ? ` <span class="muted" style="font-size:13px; margin-left:6px">฿${Number(h.cost).toLocaleString()}</span>` : ""}</div>
              ${!h.fromBooking && canDelete() ? `<button class="icon-btn" data-action="del-history" data-id="${p.id}" data-idx="${h.origIdx}" title="Delete">🗑</button>` : ""}
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
  const byOccurrence = (a, b) => {
    const wa = nextOccurrence(a), wb = nextOccurrence(b);
    if (wa === null && wb === null) return new Date(b.start) - new Date(a.start);
    if (wa === null) return 1;
    if (wb === null) return -1;
    return wa - wb;
  };
  const pending = state.bookings.filter((b) => !b.status || b.status === "pending");
  const pastDue = pending.filter(isPastDue).sort(byOccurrence);
  const upcoming = pending.filter((b) => !isPastDue(b)).sort(byOccurrence);
  const upcomingRange = state.upcomingRange || "day";
  const upcomingShown = filterByUpcomingRange(upcoming, upcomingRange);
  const completed = state.bookings.filter((b) => b.status === "completed").sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  const cancelled = state.bookings.filter((b) => b.status === "cancelled").sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  const bin = [...state.deletedBookings].sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));

  return `
  <div class="page-head">
    <h1>Bookings <span class="faint" style="font-weight:600">(${state.bookings.length})</span></h1>
    <button class="btn primary" data-action="new-booking">＋ New booking</button>
  </div>

  ${pastDue.length ? `
    <div class="card pastdue-card" style="margin-bottom:16px">
      <div class="card pad" style="padding-bottom:0; border:0"><h3 class="section-title pastdue-title">⏰ Past bookings — needs confirmation (${pastDue.length})</h3></div>
      ${pastDue.map((b) => bookingRow(b, { showResolveActions: true })).join("")}
    </div>` : ""}

  <div class="card bookings-section" style="margin-bottom:16px">
    <div class="card pad" style="padding-bottom:0; border:0">
      <div class="row" style="justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px">
        <h3 class="section-title">📆 Upcoming Bookings (${upcomingShown.length})</h3>
        <select class="upcoming-range-select" data-action="set-upcoming-range">
          <option value="day" ${upcomingRange === "day" ? "selected" : ""}>Next day</option>
          <option value="week" ${upcomingRange === "week" ? "selected" : ""}>Next week</option>
          <option value="month" ${upcomingRange === "month" ? "selected" : ""}>Next month</option>
          <option value="all" ${upcomingRange === "all" ? "selected" : ""}>All upcoming</option>
        </select>
      </div>
    </div>
    ${upcomingShown.length ? upcomingShown.map((b) => bookingRow(b, { showResolveActions: true })).join("")
      : emptyBlock("📅", "No upcoming bookings in this range", "Try a wider range above, or create a booking — it's ready to sync to Google Calendar later.", "new-booking", "New booking")}
  </div>

  <details class="card bookings-collapsible" data-open-key="completed" style="margin-bottom:16px" ${state.bookingsOpen.completed ? "open" : ""}>
    <summary>Completed Bookings (${completed.length})</summary>
    ${completed.length ? completed.map((b) => bookingRow(b)).join("") : emptyInline("No completed bookings yet.")}
  </details>

  <details class="card bookings-collapsible" data-open-key="cancelled" ${canDelete() ? 'style="margin-bottom:16px"' : ""} ${state.bookingsOpen.cancelled ? "open" : ""}>
    <summary>Cancelled Bookings (${cancelled.length})</summary>
    ${cancelled.length ? cancelled.map((b) => bookingRow(b)).join("") : emptyInline("No cancelled bookings yet.")}
  </details>

  ${canDelete() ? `
  <details class="card bookings-collapsible" data-open-key="bin" ${state.bookingsOpen.bin ? "open" : ""}>
    <summary>🗑 Bin (${bin.length})</summary>
    ${bin.length ? bin.map((b) => bookingRow(b, { trashActions: true })).join("") : emptyInline("Nothing in the bin.")}
  </details>` : ""}`;
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

function bookingRow(b, opts = {}) {
  const when = nextOccurrence(b);
  const ended = when === null;
  const shown = when || new Date(b.start);
  const recur = RECUR[b.recurrence] || RECUR.none;
  const svcText = (b.services && b.services.length)
    ? b.services.map((s) => `${esc(serviceLabel(s))}${b.serviceHours && b.serviceHours[s] ? ` (${b.serviceHours[s]}h)` : ""}`).join(", ")
    : "";
  const total = bookingDurationHours(b);
  const endTime = total ? new Date(shown.getTime() + total * 3600 * 1000) : null;
  const pet = b.petId ? state.pets.find((p) => p.id === b.petId) : null;
  const estCost = pet ? estimateCost(pet.weight, b.services, pet.species, b.hairLength || "long", b.breed, null, pet.vip) : null;
  const costLabel = (b.totalCost != null && b.totalCost !== "") ? `฿${Number(b.totalCost).toLocaleString()}` : (estCost ? estCost.label : null);
  const statusBadge = b.status === "completed" ? ` <span class="status-badge status-completed">✓ Completed</span>`
    : b.status === "cancelled" ? ` <span class="status-badge status-cancelled">✕ Cancelled</span>` : "";
  return `
  <div class="booking" style="background:${hexToRgba(groomerColor(b.groomerId), 0.12)}">
    <div class="stripe" style="background:${groomerColor(b.groomerId)}"></div>
    <div class="when"><div class="date">${fmtDate(shown)}</div><div class="time">${ended ? "Series ended" : (endTime ? `${fmtTime(shown)}–${fmtTime(endTime)}` : fmtTime(shown))}</div></div>
    <div class="who">
      <div class="pet">${esc(b.petName)}${b.breed ? ` · <span class="muted" style="font-weight:500">${esc(b.breed)}</span>` : ""}${statusBadge}</div>
      <div class="sub">
        <span class="groomer-tag"><span class="dot" style="background:${groomerColor(b.groomerId)}"></span>${esc(groomerName(b.groomerId))}</span>
        ${svcText ? " · " + svcText : ""}
        ${total ? ` · ${total}h total` : ""}
        ${costLabel ? ` · <strong>${costLabel}</strong>` : ""}
        ${b.recurrence && b.recurrence !== "none" ? ` <span class="recur-badge">${recur.label}${b.recurrenceUntil ? ` until ${fmtDate(b.recurrenceUntil)}` : ""}</span>` : ""}
      </div>
      ${opts.trashActions ? `<div class="faint" style="font-size:12px; margin-top:2px">Deleted ${timeAgo(b.deletedAt)}${b.deletedBy ? ` by ${esc(b.deletedBy)}` : ""}</div>` : ""}
    </div>
    <div class="booking-actions">
      ${opts.trashActions ? `
        <button class="btn sm" data-action="restore-booking" data-id="${b.id}">↩ Restore</button>
        <button class="icon-btn" data-action="purge-booking" data-id="${b.id}" title="Delete permanently">🗑</button>
      ` : `
        ${opts.showResolveActions ? `
          <button class="btn sm" data-action="complete-booking" data-id="${b.id}">✓ Complete</button>
          <button class="btn sm danger" data-action="cancel-booking" data-id="${b.id}">✕ Cancel</button>` : ""}
        <button class="btn sm" data-action="edit-booking" data-id="${b.id}">Edit</button>
        <button class="icon-btn" data-action="copy-confirm" data-id="${b.id}" title="Copy confirmation message">📋</button>
        ${canDelete() ? `<button class="icon-btn" data-action="del-booking" data-id="${b.id}" title="Delete">🗑</button>` : ""}
      `}
    </div>
  </div>`;
}

// The Home page's Upcoming list, grouped by day with a Google-Calendar-style date label on
// the left of each day's block of bookings. `bookings` arrives already sorted ascending by
// occurrence (from upcomingBookings()), so grouping in order yields chronological day groups.
function homeUpcomingList(bookings) {
  const groups = [];
  const byKey = new Map();
  bookings.forEach((b) => {
    const when = nextOccurrence(b) || new Date(b.start);
    const key = dateKey(when);
    if (!byKey.has(key)) { const g = { when, items: [] }; byKey.set(key, g); groups.push(g); }
    byKey.get(key).items.push(b);
  });
  return groups.map((g) => `
    <div class="home-day-group">
      <div class="home-day-label">
        <div class="hd-dow">${esc(g.when.toLocaleDateString(undefined, { weekday: "short" }))}</div>
        <div class="hd-num">${g.when.getDate()}</div>
        <div class="hd-mon">${esc(g.when.toLocaleDateString(undefined, { month: "short" }))}</div>
      </div>
      <div class="home-day-bookings">${g.items.map(homeBookingRow).join("")}</div>
    </div>`).join("");
}

// Compact, Google-Calendar-style row used ONLY on the Home page's Upcoming list — solid
// groomer color, ~half the height of a full bookingRow, optional pet thumbnail, and no
// action buttons (bookings are managed from the Bookings page). Tapping the row still opens
// the editor, same as tapping an event block on the Schedule grid. The date is omitted here
// because homeUpcomingList() groups these under a shared day label. bookingRow() above stays
// the full-detail version used on the Bookings/Financial/Bin lists — deliberately not touched.
function homeBookingRow(b) {
  const when = nextOccurrence(b) || new Date(b.start);
  const total = bookingDurationHours(b);
  const end = total ? new Date(when.getTime() + total * 3600 * 1000) : null;
  const timeRange = end ? `${fmtTime(when)}–${fmtTime(end)}` : fmtTime(when);
  const pet = b.petId ? state.pets.find((p) => p.id === b.petId) : null;
  const estCost = pet ? estimateCost(pet.weight, b.services, pet.species, b.hairLength || "long", b.breed, null, pet.vip) : null;
  const costLabel = (b.totalCost != null && b.totalCost !== "") ? `฿${Number(b.totalCost).toLocaleString()}` : (estCost ? estCost.label : null);
  // Top row: time then pet name. Bottom row: breed · service · price.
  const sub = [b.breed, (b.services || []).map(serviceLabel).join(", "), costLabel].filter(Boolean).join(" · ");
  const thumb = (pet && pet.photo) ? `<img class="hb-thumb" src="${pet.photo}" alt="">` : "";
  return `
  <div class="home-booking" style="background:${groomerColor(b.groomerId)}" data-action="edit-booking" data-id="${b.id}">
    <div class="hb-text">
      <div class="hb-top"><span class="hb-time">${timeRange}</span><span class="hb-name">${esc(b.petName)}</span></div>
      ${sub ? `<div class="hb-sub">${esc(sub)}</div>` : ""}
    </div>
    ${thumb}
  </div>`;
}

// "confirmed น้อง {name} {breed} {date & time}" — ready to paste to a customer.
// Uses the upcoming occurrence for recurring bookings (same date bookingRow shows), not the original start.
function bookingConfirmMessage(b) {
  const when = nextOccurrence(b) || new Date(b.start);
  const services = (b.services || []).map(serviceLabel).join(", ");
  return ["confirmed", `N'${b.petName}`, b.breed, services, `${fmtDate(when)} ${fmtTime(when)}`].filter(Boolean).join(" ");
}

// Confirming "Complete" also doubles as the last chance to fix the price — one modal
// instead of editing the booking separately and then confirming, since in practice the
// final price is often only known once the service is actually done. Pre-filled with
// whatever price the booking already has (or the weight-tier estimate), so doing nothing
// just keeps that value; leaving it genuinely blank clears it, same as the booking form.
function completeBookingModal(b) {
  const pet = b.petId ? state.pets.find((p) => p.id === b.petId) : null;
  const est = pet ? estimateCost(pet.weight, b.services, pet.species, b.hairLength || "long", b.breed, null, pet.vip) : null;
  const prefill = (b.totalCost != null && b.totalCost !== "") ? b.totalCost : (est ? est.min : "");
  openModal(`
    <h2>Complete booking</h2>
    <div class="muted" style="margin-bottom:16px">
      Mark ${esc(b.petName)}${b.breed ? ` (${esc(b.breed)})` : ""}'s booking as completed.
    </div>
    <div class="field">
      <label>Total cost (฿) — optional</label>
      <input id="cb-cost" type="number" min="0" step="1" placeholder="0" value="${esc(prefill)}">
      ${est ? `<div class="help">Estimated: ${est.label} (${est.tier})</div>` : ""}
    </div>
    <div class="row" style="justify-content:flex-end; margin-top:8px">
      <button class="btn" data-close-modal>Cancel</button>
      <button class="btn primary" id="confirm-complete">✓ Mark completed</button>
    </div>`);

  $("#confirm-complete").onclick = async () => {
    const costVal = $("#cb-cost").value;
    const rec = { ...b, status: "completed", completedAt: Date.now(), totalCost: costVal === "" ? null : Number(costVal) };
    await DB.put("bookings", rec); upsertLocal("bookings", rec);
    state.bookingsOpen.completed = true; // so the booking just completed is visible without re-expanding
    closeModal(); toast("Booking completed"); render();
    logActivity("booking", "completed", `${b.petName}${b.breed ? ` (${b.breed})` : ""} with ${groomerName(b.groomerId)}`);
  };
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
        ${canDelete() ? `<button class="btn sm danger" data-action="del-groomer" data-id="${g.id}">Remove</button>` : ""}
      </div>`;
    }).join("") || emptyInline("No groomers yet.")}
  </div>`;
}

/* ---------- ADMINS ---------- */
function viewAdmins() {
  // render() already redirects anyone who isn't the App Owner away from this view before it
  // ever gets called — this is just defense in depth against a future bug elsewhere.
  if (!isOwnerSession()) return `<div class="page-head"><h1>Admins</h1></div><div class="card pad">Only the App Owner can manage admins.</div>`;
  const myUid = DB.currentUid();
  const cfg = roleSectionsConfig();
  const roleLabel = (r) => (r === "groomer" ? "Groomer" : "Admin");
  return `
  <div class="page-head">
    <h1>Admins</h1>
    <button class="btn primary" data-action="new-admin">＋ Add person</button>
  </div>
  <div class="card pad" style="margin-bottom:16px">
    <div class="muted" style="margin-bottom:6px">Each person signs in with their own name + PIN. Only the App Owner can add, remove, or change someone's role.</div>
    <div class="groomer-row">
      <span class="swatch" style="background:var(--brand)"></span>
      <div class="grow"><strong>App Owner</strong> <span class="chip">you</span>
        <div class="faint" style="font-size:12px">Master account, set up in the Firebase Console — always has full access to every section</div></div>
    </div>
    ${state.admins.map((a) => {
      const role = a.role || "admin";
      return `
      <div class="groomer-row">
        <span class="swatch" style="background:var(--brand)"></span>
        <div class="grow"><strong>${esc(a.name)}</strong>${a.uid === myUid ? ' <span class="chip">you</span>' : ""}
          <div class="faint" style="font-size:12px">${esc(a.email)}</div></div>
        <select data-action="set-role" data-id="${a.uid}" style="width:auto">
          <option value="admin" ${role === "admin" ? "selected" : ""}>Admin</option>
          <option value="groomer" ${role === "groomer" ? "selected" : ""}>Groomer</option>
        </select>
        <button class="btn sm danger" data-action="del-admin" data-id="${a.uid}" ${a.uid === myUid ? "disabled" : ""}>Remove</button>
      </div>`;
    }).join("") || emptyInline("No additional people yet.")}
    <div class="help" style="margin-top:10px">
      Forgot someone's PIN? Firebase doesn't allow changing it from inside the app — go to
      Firebase Console → Authentication → Users → find their email (shown above) → Reset password.
    </div>
  </div>

  <div class="card pad">
    <h3 class="section-title">Role access</h3>
    <div class="muted" style="margin-bottom:14px">
      Which sections each role can see. Admin can add, edit, and delete within them; Groomer
      can add and edit but never delete. The Admins section itself is always App Owner-only,
      regardless of what's checked below.
    </div>
    ${["admin", "groomer"].map((role) => `
      <div style="margin-bottom:16px">
        <div style="font-weight:700; margin-bottom:8px">${roleLabel(role)}</div>
        <div class="row" style="flex-wrap:wrap; gap:14px">
          ${ALL_SECTIONS.map((s) => `
            <label class="row" style="gap:6px; font-size:13px">
              <input type="checkbox" class="role-section" data-role="${role}" data-section="${s.key}" ${cfg[role].includes(s.key) ? "checked" : ""}>
              ${esc(s.label)}
            </label>`).join("")}
        </div>
      </div>`).join("")}
    <button class="btn primary sm" data-action="save-roles">Save role access</button>
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
  </div>
  ${calendarId ? `
    <div class="card pad" style="margin-top:16px">
      <strong>Import existing bookings</strong>
      <div class="faint" style="font-size:12px; margin:4px 0 12px">
        Already have bookings sitting in this calendar from before? Pull them in as bookings here —
        safe to run more than once, already-imported events are skipped automatically.
      </div>
      <button class="btn sm" data-action="gcal-import">Import from Calendar</button>
    </div>` : ""}`;
}

/* ---------- SCHEDULE (Google-Calendar-style: sidebar + toolbar + views) ---------- */
const PX_PER_HOUR = 72; // taller blocks = more room for the pet name/services text to stay readable

function sameMonth(dateStr, refDateStr) {
  const a = new Date(dateStr + "T00:00:00"), b = new Date(refDateStr + "T00:00:00");
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}
function visibleGroomers() { return state.groomers.filter((g) => !state.scheduleHiddenGroomers.includes(g.id)); }
function nowMinutesToday() { const n = new Date(); return { dateStr: dateKey(n), min: n.getHours() * 60 + n.getMinutes() }; }

function viewSchedule() {
  if (!state.scheduleDate) state.scheduleDate = todayKey();
  if (!state.scheduleMode) state.scheduleMode = "week";
  const mode = state.scheduleMode, dateStr = state.scheduleDate;
  const title = mode === "day" ? fmtDateKey(dateStr) : mode === "week" ? fmtWeekRange(dateStr) : fmtMonthKey(dateStr);

  // Mini-calendar for quick date-jumping. Only rendered in Day view (which has spare
  // horizontal room next to its one-per-groomer columns); Week/Month give the grid the full
  // page width instead, and reach other dates via the week/month arrows or by clicking a day
  // in Month view (which jumps to that day). See the layout assembly at the end.
  const miniCal = `
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
  </div>`;

  // Groomer visibility filters + Edit hours, moved out of the old left sidebar into a full-
  // width row above the grid so the grid itself can span the whole page.
  const filters = `
  <div class="sched-filter-row">
    <div class="sched-groomer-chips">
      ${state.groomers.map((g) => `
        <label class="sched-chip">
          <input type="checkbox" class="sched-groomer-toggle" data-id="${g.id}" ${state.scheduleHiddenGroomers.includes(g.id) ? "" : "checked"}>
          <span class="dot" style="background:${g.color}"></span> ${esc(g.name)}
        </label>`).join("") || emptyInline("No groomers yet.")}
    </div>
    <button class="btn sm" data-action="edit-hours">Edit hours</button>
  </div>`;

  // No mode has a persistent mini-calendar anymore — every view gets the grid's full page
  // width, and the title itself is a click target that pops the same mini-calendar open
  // right under the toolbar, letting staff jump to any day/week/month by picking a date in
  // it rather than only stepping one at a time via the arrows.
  const toolbar = `
  <div class="card pad gcal-toolbar">
    <div class="row" style="position:relative">
      <button class="btn sm" data-action="sched-today">Today</button>
      <button class="icon-btn" data-action="sched-prev" aria-label="Previous">‹</button>
      <button class="icon-btn" data-action="sched-next" aria-label="Next">›</button>
      <div class="gcal-title" data-action="toggle-mini-cal" style="cursor:pointer">${title}</div>
      ${state.scheduleMiniCalOpen ? `<div class="mini-cal-popover">${miniCal}</div>` : ""}
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
  ${toolbar}
  ${filters}
  ${body}`;
}

function fmtMonthOnly(monthKey) { return new Date(monthKey + "-01T00:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" }); }
function addMonthsToMonthKey(monthKey, n) { return addMonthsKey(monthKey + "-01", n).slice(0, 7); }
function lastDayOfMonthKey(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return `${monthKey}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
}
function fmtDateFull(key) { return new Date(key + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); }
// "14 ก.ค. 2026" for a single day, "1 ก.ค. – 14 ก.ค. 2026" for a range. Kept fully spelled on
// both ends (even within one month) so it's never ambiguous across month/year boundaries.
function fmtFinancialRange(start, end) {
  return start === end ? fmtDateFull(start) : `${fmtDateFull(start)} – ${fmtDateFull(end)}`;
}

// Revenue for a completed/cancelled-irrelevant booking: the staff-entered total if set,
// otherwise the exact weight-tier estimate (defaults to long-hair pricing if the booking
// predates the hair-length field — matches what the booking form shows).
function bookingRevenue(b) {
  if (b.totalCost != null && b.totalCost !== "") return Number(b.totalCost);
  const pet = b.petId ? state.pets.find((p) => p.id === b.petId) : null;
  const est = pet ? estimateCost(pet.weight, b.services, pet.species, b.hairLength || "long", b.breed, null, pet.vip) : null;
  return est ? est.min : 0;
}

// Mini-calendar for the Financial date-range picker, with the selected day/range highlighted.
// Navigates by month via fin-cal-prev/next; each day is a fin-pick-day target.
function financialMiniCal(rangeStart, rangeEnd) {
  const calMonth = state.financialCalMonth || todayKey().slice(0, 7);
  return `
  <div class="mini-cal">
    <div class="mini-cal-head">
      <strong>${fmtMonthOnly(calMonth)}</strong>
      <div class="row" style="gap:2px">
        <button class="icon-btn" data-action="fin-cal-prev" aria-label="Previous month">‹</button>
        <button class="icon-btn" data-action="fin-cal-next" aria-label="Next month">›</button>
      </div>
    </div>
    <div class="mini-cal-grid">
      ${DAY_NAMES_SHORT.map((d) => `<div class="mini-dow">${d[0]}</div>`).join("")}
      ${monthGridDates(calMonth + "-01").map((d) => {
        const inMonth = sameMonth(d, calMonth + "-01");
        const isToday = d === todayKey();
        const inRange = d >= rangeStart && d <= rangeEnd;
        const isEnd = d === rangeStart || d === rangeEnd;
        return `<button class="mini-day ${inMonth ? "" : "outside"} ${isToday ? "today" : ""} ${inRange ? "in-range" : ""} ${isEnd ? "selected" : ""}" data-action="fin-pick-day" data-date="${d}">${new Date(d + "T00:00:00").getDate()}</button>`;
      }).join("")}
    </div>
    <div class="help" style="margin-top:8px">Click one day for a single day, or a second day to set a range.</div>
  </div>`;
}

function viewFinancial() {
  // Range model: financialStart/End are day keys (YYYY-MM-DD). A single-day selection leaves
  // financialEnd blank until a second day is picked, so one click = one day. Default to the
  // current calendar month on first open.
  if (!state.financialStart) {
    const mk = todayKey().slice(0, 7);
    state.financialStart = mk + "-01";
    state.financialEnd = lastDayOfMonthKey(mk);
  }
  if (!state.financialCalMonth) state.financialCalMonth = (state.financialEnd || state.financialStart).slice(0, 7);
  const rangeStart = state.financialStart;
  const rangeEnd = state.financialEnd || state.financialStart;
  // Grouped by when a booking was marked complete (completedAt), not its scheduled date —
  // a recurring booking's original date can be far in the past by the time it's resolved.
  const completed = state.bookings.filter((b) => {
    if (b.status !== "completed" || !b.completedAt) return false;
    const k = dateKey(new Date(b.completedAt));
    return k >= rangeStart && k <= rangeEnd;
  });
  const totalRevenue = completed.reduce((sum, b) => sum + bookingRevenue(b), 0);

  const byGroomer = {};
  completed.forEach((b) => {
    const key = b.groomerId || "none";
    if (!byGroomer[key]) byGroomer[key] = { count: 0, revenue: 0 };
    byGroomer[key].count++;
    byGroomer[key].revenue += bookingRevenue(b);
  });
  const groomerRows = Object.entries(byGroomer)
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .map(([gid, stats]) => {
      const name = gid === "none" ? "No preference" : groomerName(gid);
      const color = gid === "none" ? "#9aa3b2" : groomerColor(gid);
      return `
      <div class="fin-groomer-row">
        <span class="groomer-tag"><span class="dot" style="background:${color}"></span>${esc(name)}</span>
        <span class="faint">${stats.count} booking${stats.count === 1 ? "" : "s"}</span>
        <strong>฿${stats.revenue.toLocaleString()}</strong>
      </div>`;
    }).join("");

  const toolbar = `
  <div class="card pad fin-toolbar">
    <div class="row" style="flex-wrap:wrap; gap:8px">
      <button class="btn sm" data-action="fin-preset-today">Today</button>
      <button class="btn sm" data-action="fin-preset-week">This week</button>
      <button class="btn sm" data-action="fin-preset-month">This month</button>
    </div>
    <div class="row" style="position:relative">
      <div class="gcal-title" data-action="fin-toggle-cal" style="cursor:pointer">📅 ${fmtFinancialRange(rangeStart, rangeEnd)}</div>
      ${state.financialCalOpen ? `<div class="mini-cal-popover fin-cal-popover">${financialMiniCal(rangeStart, rangeEnd)}</div>` : ""}
    </div>
  </div>`;

  return `
  <div class="page-head"><h1>Financial</h1></div>
  ${toolbar}
  <div class="fin-stats">
    <div class="card pad fin-stat">
      <div class="section-title">Revenue</div>
      <div class="fin-stat-value">฿${totalRevenue.toLocaleString()}</div>
    </div>
    <div class="card pad fin-stat">
      <div class="section-title">Customers served</div>
      <div class="fin-stat-value">${completed.length}</div>
    </div>
  </div>
  <div class="card pad" style="margin-top:16px">
    <div class="section-title">By groomer</div>
    ${groomerRows || emptyInline("No completed bookings in this range yet.")}
  </div>
  <div class="card bookings-section" style="margin-top:16px">
    <div class="card pad" style="padding-bottom:0; border:0"><div class="section-title">All Bookings (${completed.length})</div></div>
    ${completed.length
      ? [...completed].sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)).map((b) => bookingRow(b)).join("")
      : emptyBlock("📅", "No completed bookings in this range", "Pick a different day or period above, or complete a booking to see it here.")}
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

// Week view mixes every groomer's bookings into one day-column (unlike Day view, which
// gives each groomer their own dedicated column) — plain layoutLanes() assigns lanes by
// first-available-by-time, so the same groomer can land in a different lane (and therefore
// a different horizontal position) on different days, making it hard to visually track one
// groomer's slots down the week. This assigns lanes by a fixed groomer order instead (the
// same order as the "My groomers" sidebar list, "No preference" last), so a groomer's color
// always renders in the same relative position whenever they appear — but only reserves
// lanes for groomers who actually have a booking THAT day, not the full roster, so a light
// day with one or two groomers still gets full-width blocks instead of mostly-empty slivers.
function scheduleGroomerOrder() {
  return [...visibleGroomers().map((g) => g.id), null];
}
function layoutLanesByGroomer(items) {
  const order = scheduleGroomerOrder();
  const laneOf = (gid) => { const i = order.indexOf(gid); return i === -1 ? order.length : i; };
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const placed = sorted.map((it) => ({ ...it }));
  const activeIds = [...new Set(placed.map((it) => it.booking.groomerId))].sort((a, b) => laneOf(a) - laneOf(b));
  const rank = new Map(activeIds.map((gid, i) => [gid, i]));
  placed.forEach((it) => { it.lane = rank.get(it.booking.groomerId); });
  // Same-groomer double-bookings (rare) would otherwise fully overlap in the same lane —
  // push any later, still-overlapping duplicate one lane over instead of hiding the conflict.
  placed.forEach((it, i) => {
    const bumped = placed.slice(0, i)
      .filter((o) => o.lane === it.lane && o.startMin < it.endMin && o.endMin > it.startMin).length;
    it.lane += bumped;
  });
  const laneCount = Math.max(activeIds.length, ...placed.map((it) => it.lane + 1));
  placed.forEach((it) => { it.laneCount = laneCount; });
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
    <div class="sb-name">${esc(b.petName)}</div>
    ${(b.services || []).length ? `<div class="sb-services">${esc(b.services.map(serviceLabel).join(", "))}</div>` : ""}
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
  // "No preference" bookings don't belong to any real groomer's column — give them their
  // own in the grid (but not the Open Slots summary below, which only makes sense per
  // actual person), only when there's actually one to show, so it doesn't clutter every day.
  const unassignedItems = all.filter((it) => !it.booking.groomerId);
  const gridColumns = unassignedItems.length
    ? [...columns, { groomer: { name: "No preference", color: "#9aa3b2" }, items: layoutLanes(unassignedItems) }]
    : columns;
  const gridHeight = ((closeMin - openMin) / 60) * PX_PER_HOUR;
  const now = nowMinutesToday();
  const nowLine = (now.dateStr === dateStr && now.min >= openMin && now.min <= closeMin)
    ? `<div class="now-line" style="top:${((now.min - openMin) / 60) * PX_PER_HOUR}px; left:56px; right:0"><span class="now-dot"></span></div>` : "";

  // Headers and bodies are two separate flex rows (not one column-head+column-body pair per
  // groomer) specifically so the hour axis and the "now" line — which sit outside any single
  // column — line up with the actual gridlines/blocks below the headers, not with the grid's
  // outer top edge. Splitting them out removes the header-height mismatch that used to push
  // axis times and the now-line above where the row lines actually are.
  const grid = `
  <div class="card pad" style="overflow-x:auto">
    <div class="schedule-grid">
      <div class="schedule-head-row">
        <div class="schedule-axis-head"></div>
        ${gridColumns.map((col) => `
          <div class="schedule-col-head"><span class="dot" style="background:${col.groomer.color}"></span>${esc(col.groomer.name)}</div>`).join("")}
      </div>
      <div class="schedule-body-row" style="height:${gridHeight}px">
        <div class="schedule-axis-body">
          ${hourMarks.map((m) => `<div class="axis-mark" style="top:${((m - openMin) / 60) * PX_PER_HOUR}px">${fmtMinutes(m)}</div>`).join("")}
        </div>
        ${gridColumns.map((col) => `
          <div class="schedule-col-body" data-date="${dateStr}" data-groomer-id="${col.groomer.id || ""}">
            ${col.items.map((it) => scheduleBlockHtml(it, openMin, closeMin, col.groomer.color)).join("")}
          </div>`).join("")}
        ${nowLine}
      </div>
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
    const items = closed ? [] : layoutLanesByGroomer(bookingsOnDate(d).filter((it) => !hiddenIds.includes(it.booking.groomerId)));
    return { dateStr: d, dow, closed, items };
  });

  return `
  <div class="card pad" style="overflow-x:auto">
    <div class="schedule-grid">
      <div class="schedule-head-row">
        <div class="schedule-axis-head"></div>
        ${cols.map((col) => `
          <div class="schedule-col-head week" data-action="goto-day" data-date="${col.dateStr}" style="cursor:pointer">
            <div class="day-name">${DAY_NAMES_SHORT[col.dow]}</div>
            <span class="day-num ${col.dateStr === today ? "today" : ""}">${new Date(col.dateStr + "T00:00:00").getDate()}</span>
          </div>`).join("")}
      </div>
      <div class="schedule-body-row" style="height:${gridHeight}px">
        <div class="schedule-axis-body">
          ${hourMarks.map((m) => `<div class="axis-mark" style="top:${((m - openMin) / 60) * PX_PER_HOUR}px">${fmtMinutes(m)}</div>`).join("")}
        </div>
        ${cols.map((col) => `
          <div class="schedule-col-body" data-date="${col.dateStr}">
            ${col.closed ? `<div class="closed-overlay">Closed</div>`
              : col.items.map((it) => scheduleBlockHtml(it, openMin, closeMin, groomerColor(it.booking.groomerId))).join("")}
            ${(col.dateStr === now.dateStr && now.min >= openMin && now.min <= closeMin)
              ? `<div class="now-line" style="top:${((now.min - openMin) / 60) * PX_PER_HOUR}px; left:0; right:0"><span class="now-dot"></span></div>` : ""}
          </div>`).join("")}
      </div>
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
    .filter((b) => !b.status || b.status === "pending")
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
        <input id="f-breed" list="breed-list" value="${esc(p.breed || "")}" placeholder="${(p.species || "dog") === "cat" ? "Persian, or type your own" : "Poodle, or type your own"}">
        <datalist id="breed-list">${allBreeds(p.species || "dog").map((b) => `<option value="${esc(b)}">`).join("")}</datalist>
      </div>
      <div class="field"><label>Weight (kg)</label><input id="f-weight" type="number" step="0.1" value="${esc(p.weight || "")}" placeholder="8.5"></div>
    </div>
    <div class="field"><label>Assigned groomer</label>
      <select id="f-groomer"><option value="">— Unassigned —</option>
        ${state.groomers.map((g) => `<option value="${g.id}" ${p.groomerId === g.id ? "selected" : ""}>${esc(g.name)}</option>`).join("")}
      </select></div>
    <label class="row" style="gap:8px; align-items:center; margin:4px 0 12px">
      <input type="checkbox" id="f-vip" ${p.vip ? "checked" : ""}>
      <span>⭐ VIP customer — 10% off Basic &amp; Styling</span>
    </label>
    <h3 class="section-title" style="margin-top:6px">Typical time consumed (hours)</h3>
    <div class="field-row">
      <div class="field"><label>🚿 Basic</label><input id="f-shower" type="number" min="0" step="0.25" value="${esc(t.shower ?? "")}"></div>
      <div class="field"><label>💈 Styling</label><input id="f-styling" type="number" min="0" step="0.25" value="${esc(t.styling ?? "")}"></div>
    </div>
    <div class="row spread" style="margin-top:12px">
      ${pet && canDelete() ? `<button class="btn danger" data-action="del-pet" data-id="${p.id}">Delete pet</button>` : "<span></span>"}
      <div class="row"><button class="btn" data-close-modal>Cancel</button>
      <button class="btn primary" id="save-pet">Save</button></div>
    </div>`);

  $("#f-species").addEventListener("change", () => {
    const isCat = $("#f-species").value === "cat";
    $("#breed-list").innerHTML = allBreeds($("#f-species").value).map((b) => `<option value="${esc(b)}">`).join("");
    $("#f-breed").placeholder = isCat ? "Persian, or type your own" : "Poodle, or type your own";
  });

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
      vip: $("#f-vip").checked,
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
      <div class="tag-list">${SERVICES.map((s) => `<label class="chip"><input type="checkbox" class="h-svc" value="${s}"> ${esc(serviceLabel(s))}</label>`).join("")}</div></div>
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
// slotPrefill (only used for a brand-new booking, never when editing): { start: Date,
// groomerId: string|null } — set when opened by clicking an empty spot on the Schedule
// grid, so the date/time/groomer are already filled in instead of defaulting to "now".
function bookingModal(booking, prefillPet, slotPrefill) {
  const b = booking || {};
  const now = new Date(Date.now() + 60 * 60 * 1000); now.setMinutes(0, 0, 0);
  const startVal = b.start ? toLocalInput(b.start) : toLocalInput((slotPrefill && slotPrefill.start) || now);

  // Resolve the initial matched pet: editing an existing booking, or opened via "Book" on a pet profile
  let matchedPet = prefillPet || (b.petId ? state.pets.find((p) => p.id === b.petId) : null) || null;
  let isNewPet = false;
  let newPetPhoto = null;
  const touchedHours = {}; // service label -> true once the user has hand-edited its hour field
  let costTouched = !!(b.totalCost != null && b.totalCost !== ""); // don't clobber a saved/edited cost
  let hairLength = b.hairLength || "long"; // "short" | "long" — defaults long so an estimate is always exact, never an in-between average
  let styleLongOverride = null; // cat-only: which exact long Hair Styling price staff picked, when the tier offers more than one

  const initialName = b.petName || (matchedPet ? matchedPet.name : "");
  const initialBreed = b.breed || (matchedPet ? matchedPet.breed : "");
  // Editing an existing booking: preserve an explicit "no preference" (null) rather than
  // silently substituting the pet's usual groomer. New booking: prefill from the pet, then
  // from the clicked Schedule slot's groomer column, as before.
  const initialGroomer = booking ? (b.groomerId ?? "none")
    : (b.groomerId || (matchedPet ? matchedPet.groomerId : "") || (slotPrefill ? (slotPrefill.groomerId || "none") : ""));
  const initialWeight = matchedPet ? (matchedPet.weight || "") : "";
  const initialSpecies = matchedPet ? (matchedPet.species || "dog") : "dog";
  const initialServices = b.services || [];
  const initialHours = b.serviceHours || {};
  const initialAddOnNote = b.addOnNote || "";
  const initialAddOnPrice = b.addOnPrice || "";
  const initialAddOnEnabled = !!(initialAddOnNote || initialAddOnPrice);

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
      <button class="btn sm" id="np-photo-btn" type="button">Upload photo</button>
      <input type="file" id="np-photo-input" accept="image/*" hidden>
    </div>

    <div class="field-row">
      <div class="field"><label>Species</label>
        <select id="b-species"><option value="dog" ${initialSpecies === "dog" ? "selected" : ""}>🐶 Dog</option><option value="cat" ${initialSpecies === "cat" ? "selected" : ""}>🐱 Cat</option></select></div>
      <div class="field"><label>Breed</label>
        <input id="b-breed" list="breed-list" value="${esc(initialBreed)}" placeholder="${initialSpecies === "cat" ? "Persian, or type your own" : "Poodle, or type your own"}">
        <datalist id="breed-list">${allBreeds(initialSpecies).map((b) => `<option value="${esc(b)}">`).join("")}</datalist>
      </div>
    </div>
    <div class="field-row">
      <div class="field"><label>Groomer</label>
        <select id="b-groomer">
          <option value="">— Choose —</option>
          <option value="none" ${initialGroomer === "none" ? "selected" : ""}>No preference</option>
          ${state.groomers.map((g) => `<option value="${g.id}" ${initialGroomer === g.id ? "selected" : ""}>${esc(g.name)}</option>`).join("")}
        </select></div>
      <div class="field"><label>Weight (kg)</label>
        <input id="b-weight" type="number" step="0.1" placeholder="8.5" value="${esc(initialWeight)}">
      </div>
    </div>
    <div class="field">
      <label>Hair length</label>
      <div class="row" id="hair-length-pick" style="gap:8px">
        <button type="button" class="btn sm ${hairLength === "short" ? "primary" : ""}" data-hair="short">Short</button>
        <button type="button" class="btn sm ${hairLength === "long" ? "primary" : ""}" data-hair="long">Long</button>
      </div>
      <div class="help">Basic/Styling prices are a short/long-hair pair — pick one for an exact price instead of a range.</div>
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
          <label class="svc-row">
            <input type="checkbox" class="b-svc svc-real-checkbox" data-svc="${esc(s)}" ${initialServices.includes(s) ? "checked" : ""}>
            <span class="svc-box" aria-hidden="true"></span>
            <span class="svc-name">${esc(serviceLabel(s))}</span>
            <input type="number" class="b-hr" data-svc="${esc(s)}" min="0" step="0.25" placeholder="hrs"
              value="${esc(initialHours[s] ?? "")}" ${initialServices.includes(s) ? "" : "disabled"}>
          </label>`).join("")}
        <label class="svc-row">
          <input type="checkbox" id="b-addon-check" class="svc-real-checkbox" ${initialAddOnEnabled ? "checked" : ""}>
          <span class="svc-box" aria-hidden="true"></span>
          <span class="svc-name">Add-on</span>
        </label>
        <div class="field-row" id="addon-fields" style="margin-top:-2px" ${initialAddOnEnabled ? "" : "hidden"}>
          <input id="b-addon-note" placeholder="What's the add-on? e.g. Nail clipping" value="${esc(initialAddOnNote)}">
          <input id="b-addon-price" type="number" min="0" step="1" placeholder="Price ฿" value="${esc(initialAddOnPrice)}">
        </div>
      </div>
      <div class="help" id="duration-total" style="margin-top:6px"></div>
    </div>

    <div class="field">
      <label>Total cost (฿)</label>
      <input id="b-cost" type="number" min="0" step="1" placeholder="0" value="${esc(b.totalCost ?? "")}">
      <div class="help" id="cost-estimate" style="margin-top:4px"></div>
      <div class="row" id="style-price-pick" style="gap:6px; margin-top:6px" hidden></div>
    </div>

    <div class="field"><label>Notes</label><textarea id="b-notes" placeholder="Anything the groomer should know…">${esc(b.notes || "")}</textarea></div>
    <div class="${booking && canDelete() ? "spread" : "row"}" style="margin-top:8px; flex-wrap:wrap; row-gap:10px; ${booking && canDelete() ? "" : "justify-content:flex-end"}">
      ${booking && canDelete() ? `<button class="btn danger" id="delete-booking-btn">🗑 Delete</button>` : ""}
      <div class="row" style="flex-wrap:wrap; row-gap:10px">
        <button class="btn" data-close-modal>Cancel</button>
        <button class="btn primary" id="save-booking">${booking ? "Save" : "Create booking"}</button>
      </div>
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
  function refreshBreedDatalist() {
    $("#breed-list").innerHTML = allBreeds($("#b-species").value).map((b) => `<option value="${esc(b)}">`).join("");
  }
  function applyMatch(pet) {
    matchedPet = pet; isNewPet = false; newPetBox.hidden = true;
    petInput.value = pet.name;
    if (pet.breed) $("#b-breed").value = pet.breed;
    if (pet.groomerId) $("#b-groomer").value = pet.groomerId;
    if (pet.weight) $("#b-weight").value = pet.weight;
    $("#b-species").value = pet.species || "dog";
    refreshBreedDatalist();
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
    const pickEl = $("#style-price-pick");
    if (!el) return;
    const weight = $("#b-weight").value;
    const species = $("#b-species").value;
    const breed = $("#b-breed").value.trim();
    const services = $$(".b-svc").filter((cb) => cb.checked).map((cb) => cb.dataset.svc);
    const addOnOn = $("#b-addon-check").checked;
    const addOnPrice = addOnOn ? (Number($("#b-addon-price").value) || 0) : 0;
    if (!services.length && !addOnOn) { el.textContent = ""; pickEl.hidden = true; return; }

    // hairLength always has a value (defaults "long"), so this is always the exact price —
    // never a range or an in-between average.
    const vip = !!(matchedPet && matchedPet.vip);
    const est = services.length ? estimateCost(weight, services, species, hairLength, breed, styleLongOverride, vip) : null;
    if (services.length && !est) { el.textContent = "Add the pet's weight to estimate cost."; pickEl.hidden = true; return; }

    // A cat's long Hair Styling price can be one of a few exact options instead of a single
    // number — surface a small picker so staff choose which applies, defaulting to the
    // lowest so the total is always exact even before anyone touches it.
    if (est && est.styleOptions) {
      if (!est.styleOptions.includes(styleLongOverride)) styleLongOverride = est.styleOptions[0];
      pickEl.hidden = false;
      pickEl.innerHTML = `<span class="faint" style="font-size:12px; align-self:center">Styling price:</span>` +
        est.styleOptions.map((p) => `<button type="button" class="btn sm ${p === styleLongOverride ? "primary" : ""}" data-style-price="${p}">฿${p}</button>`).join("");
      $$("[data-style-price]", pickEl).forEach((btn) => btn.onclick = () => {
        styleLongOverride = Number(btn.dataset.stylePrice);
        updateCostEstimate();
      });
    } else {
      pickEl.hidden = true;
    }

    const total = (est ? est.min : 0) + addOnPrice;
    const parts = [];
    if (est) parts.push(`${est.label} (${est.tier})`);
    if (est && est.surcharge) parts.push(`incl. ฿${est.surcharge} breed surcharge`);
    if (est && est.vip && est.regular != null) parts.push(`⭐ VIP -10% · regular ฿${est.regular.toLocaleString()}`);
    if (addOnOn && addOnPrice) parts.push(`+ ฿${addOnPrice.toLocaleString()} add-on`);
    el.innerHTML = `Estimated: ฿${total.toLocaleString()}${parts.length ? ` — ${parts.join(" ")}` : ""}${costTouched ? ' · <button class="link" id="use-estimate" type="button">use this</button>' : ""}`;
    if (!costTouched) $("#b-cost").value = total;
    const useBtn = $("#use-estimate");
    if (useBtn) useBtn.onclick = () => { costTouched = false; $("#b-cost").value = total; updateCostEstimate(); };
  }
  function paintHairLength() {
    $$("#hair-length-pick button").forEach((btn) => btn.classList.toggle("primary", btn.dataset.hair === hairLength));
  }
  $$("#hair-length-pick button").forEach((btn) => btn.onclick = () => {
    hairLength = btn.dataset.hair; // always exactly one of short/long selected, never neither
    paintHairLength();
    updateCostEstimate();
  });

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

  $("#b-addon-check").addEventListener("change", (e) => {
    $("#addon-fields").hidden = !e.target.checked;
    if (!e.target.checked) { $("#b-addon-note").value = ""; $("#b-addon-price").value = ""; }
    updateCostEstimate();
  });
  $("#b-addon-price").addEventListener("input", updateCostEstimate);
  $("#b-breed").addEventListener("input", updateCostEstimate); // breed drives the premium-breed surcharge

  $("#b-recur").addEventListener("change", () => { $("#b-until-field").hidden = $("#b-recur").value === "none"; });
  $("#b-species").addEventListener("change", () => {
    refreshBreedDatalist();
    $("#b-breed").placeholder = $("#b-species").value === "cat" ? "Persian, or type your own" : "Poodle, or type your own";
    updateCostEstimate();
  });

  $("#np-photo-btn").onclick = () => $("#np-photo-input").click();
  $("#np-photo-input").onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    newPetPhoto = await fileToResizedDataURL(file);
    paintAvatar();
  };
  $("#b-weight").addEventListener("input", updateCostEstimate);
  $("#b-cost").addEventListener("input", () => { costTouched = true; updateCostEstimate(); });

  paintAvatar(); paintStatus();
  if (matchedPet) prefillHoursFromPet(); else updateTotal();

  const deleteBtn = $("#delete-booking-btn");
  if (deleteBtn) deleteBtn.onclick = async () => { closeModal(); await handleAction("del-booking", { id: b.id }); };

  $("#save-booking").onclick = async () => {
    const petName = petInput.value.trim();
    if (!petName) { toast("Please enter a pet"); return; }
    if (!$("#b-groomer").value) { toast("Please choose a groomer"); return; }
    const checkedServices = $$(".b-svc").filter((c) => c.checked);
    if (checkedServices.length === 0 && !$("#b-addon-check").checked) { toast("Please select at least one service"); return; }
    for (const cb of checkedServices) {
      const hrInput = $(`.b-hr[data-svc="${cb.dataset.svc}"]`);
      if (!hrInput.value || Number(hrInput.value) <= 0) { toast(`Please enter hours for ${cb.dataset.svc}`); hrInput.focus(); return; }
    }

    const groomerId = $("#b-groomer").value === "none" ? null : $("#b-groomer").value;
    const breed = $("#b-breed").value.trim();
    const weight = $("#b-weight").value.trim();
    const species = $("#b-species").value;
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
        species, breed, weight,
        groomerId, times, history: [],
      };
      await DB.put("pets", newPet);
      upsertLocal("pets", newPet);
      petId = newPet.id;
    } else if ((weight && weight !== String(matchedPet.weight || "")) || species !== (matchedPet.species || "dog")) {
      // Keep the pet's profile in sync if weight/species were updated right here in the booking form.
      const updatedPet = { ...matchedPet, weight: weight || matchedPet.weight, species };
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
      hairLength,
      addOnNote: $("#b-addon-check").checked ? $("#b-addon-note").value.trim() : "",
      addOnPrice: $("#b-addon-check").checked ? (Number($("#b-addon-price").value) || 0) : 0,
      totalCost: $("#b-cost").value === "" ? null : Number($("#b-cost").value),
      notes: $("#b-notes").value.trim(),
      calendarEventId: b.calendarEventId || null,
      calendarDirty: true, // cleared once any connected device successfully syncs it — see reconcileCalendar()
      status: b.status || "pending",
      completedAt: b.completedAt || null,
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

/* ---------- Calendar import (one-time: pulls existing Calendar events into bookings) ---------
   Normal sync only ever writes to Calendar, never reads it back — this is the one place the
   app looks at what's already there, and only when explicitly asked. Every imported booking
   is stamped with the source event's id (calendarEventId) and calendarDirty:false, so it's
   "adopted" rather than duplicated: future edits in the app PATCH that same event instead of
   creating a second one, and re-running the import later naturally skips it. ---------- */
const alreadyImportedEventIds = () => new Set(state.bookings.filter((b) => b.calendarEventId).map((b) => b.calendarEventId));
// Google Calendar's own hex for a given event colorId, using the same 11-color palette
// GROOMER_COLORS already encodes — lets an import row show the event's real Calendar color
// even for colorIds no current groomer happens to use.
const calendarColorHex = (colorId) => { const c = GROOMER_COLORS.find((g) => g.calendarColorId === colorId); return c ? c.color : null; };

function importCandidateFromEvent(ev) {
  const timed = ev.start && ev.start.dateTime;
  const allDayDate = ev.start && ev.start.date;
  if (!timed && !allDayDate) return null; // no usable date at all
  // All-day events (created by just typing a title into a day, no time set) carry no time —
  // default to a plausible slot and flag it so the review step calls out that it needs a
  // real look, rather than silently importing a booking at midnight.
  const startIso = timed || `${allDayDate}T10:00:00`;
  const endIso = ev.end && ev.end.dateTime;
  const parsed = parseEventSummary(ev.summary);
  const hours = endIso ? Math.max(0.5, Math.round(((new Date(endIso) - new Date(startIso)) / 3600000) * 2) / 2) : 1;
  const serviceHours = {};
  if (parsed.services.length) {
    const each = Math.round((hours / parsed.services.length) * 2) / 2 || 0.5;
    parsed.services.forEach((s) => { serviceHours[s] = each; });
  }
  const nameMatches = parsed.petName
    ? state.pets.filter((p) => p.name.trim().toLowerCase() === parsed.petName.trim().toLowerCase())
    : [];
  const matchedPet = nameMatches.length === 1 ? nameMatches[0] : null;
  const groomer = groomerByCalendarColorId(ev.colorId);
  const breed = parsed.breed || (matchedPet ? matchedPet.breed || "" : "");

  // Reasons this row needs a human look before importing, computed from the *final* resolved
  // state (not the raw parse) so e.g. a title with no breed but an exact single pet match
  // (which backfills breed from that pet's profile) doesn't get flagged unnecessarily. Drives
  // the "Special attention" grouping in renderImportReview — see importRow for how each is shown.
  const attentionReasons = [];
  if (nameMatches.length > 1) attentionReasons.push({ key: "ambiguous-pet", label: `name matches ${nameMatches.length} pets` });
  if (parsed.nameFallback) attentionReasons.push({ key: "name-fallback", label: "couldn't confidently parse the title — check name/services" });
  else if (!breed) attentionReasons.push({ key: "no-breed", label: "no breed recognized — check it" });
  if (parsed.hasNameJoiner) attentionReasons.push({ key: "multi-name", label: "name contains \"&\"/\"and\" — may be more than one pet" });

  return {
    eventId: ev.id,
    start: startIso,
    allDay: !timed,
    colorId: ev.colorId || null, // Calendar's own color id for this event, e.g. "10" — see calendarColorHex()
    petId: matchedPet ? matchedPet.id : null,
    // More than one pet shares this name — don't guess which one, surface it for a human
    // to pick instead (see "special attention" grouping in renderImportReview).
    ambiguousPets: nameMatches.length > 1 ? nameMatches : null,
    attentionReasons,
    petName: parsed.petName,
    breed,
    services: parsed.services,
    serviceHours,
    notes: parsed.notes,
    groomerId: groomer ? groomer.id : null,
  };
}

function calendarImportModal() {
  const calendarId = getCalendarId();
  if (!calendarId) { toast("Save a Calendar ID first"); return; }
  const defaultFrom = addMonthsKey(todayKey(), -24);
  const defaultTo = addMonthsKey(todayKey(), 24);
  openModal(`
    <h2>Import bookings from Calendar</h2>
    <div class="muted" style="margin-bottom:14px">
      Pulls events from the connected calendar into bookings here, parsed from each title
      (Name · Breed · Service · Remark). Events already linked to an existing booking are
      skipped automatically — safe to re-run any time.
    </div>
    <div class="field-row">
      <div class="field"><label>From</label><input id="imp-from" type="text" inputmode="numeric" placeholder="YYYY-MM-DD" value="${defaultFrom}"></div>
      <div class="field"><label>To</label><input id="imp-to" type="text" inputmode="numeric" placeholder="YYYY-MM-DD" value="${defaultTo}"></div>
    </div>
    <div class="help">Type each date as YYYY-MM-DD (e.g. 2024-01-31). Covers both past and upcoming events by default — widen it if some of your bookings fall outside this range.</div>
    <div class="help" id="imp-status"></div>
    <div class="row" style="justify-content:flex-end; margin-top:8px">
      <button class="btn" data-close-modal>Cancel</button>
      <button class="btn primary" id="imp-fetch">Fetch events</button>
    </div>`);

  const isValidDateStr = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && dateKey(new Date(s + "T00:00:00")) === s;

  $("#imp-fetch").onclick = async () => {
    const fromV = $("#imp-from").value.trim(), toV = $("#imp-to").value.trim();
    if (!isValidDateStr(fromV) || !isValidDateStr(toV)) { toast("Please enter both dates as YYYY-MM-DD"); return; }
    const btn = $("#imp-fetch");
    btn.disabled = true; btn.textContent = "Fetching…";
    $("#imp-status").textContent = "";
    try {
      if (!GCal.isConnected()) await GCal.connect(); // must run inside this click handler for the popup
      const events = await GCal.listEvents(calendarId, {
        timeMin: new Date(fromV + "T00:00:00").toISOString(),
        timeMax: new Date(toV + "T23:59:59").toISOString(),
      });
      const known = alreadyImportedEventIds();
      const candidates = events
        .filter((ev) => ev.status !== "cancelled" && !known.has(ev.id))
        .map(importCandidateFromEvent)
        .filter(Boolean);
      renderImportReview(candidates, events.length);
    } catch (err) {
      $("#imp-status").textContent = `Couldn't fetch events (${err.message || err}).`;
      btn.disabled = false; btn.textContent = "Fetch events";
    }
  };
}

function importRow(c, i) {
  // Every reason except "ambiguous-pet" gets a plain notice line here — that one keeps its
  // own dedicated picker block below instead, since it needs a choice, not just a warning.
  const otherReasons = c.attentionReasons.filter((r) => r.key !== "ambiguous-pet");
  return `
  <div class="card pad imp-row">
    <div class="row" style="justify-content:space-between; align-items:center; gap:10px">
      <label class="row" style="gap:8px; align-items:center; flex:1; min-width:0">
        <input type="checkbox" class="imp-row-check" id="imp-check-${i}" checked>
        <input id="imp-name-${i}" value="${esc(c.petName)}" placeholder="Pet name" style="flex:1">
      </label>
      <input id="imp-start-${i}" type="datetime-local" value="${toLocalInput(c.start)}" style="width:auto">
    </div>
    ${c.allDay ? `<div class="faint" style="font-size:11px; color:#a8710a; margin-top:4px">⚠ This was an all-day event on Calendar — no time was set, so 10:00 was guessed. Check it.</div>` : ""}
    ${otherReasons.length ? `<div class="faint" style="font-size:11px; color:#a8710a; margin-top:4px">⚠ ${otherReasons.map((r) => esc(r.label)).join(" · ")}</div>` : ""}
    ${c.ambiguousPets ? `
      <div class="field" style="margin-top:8px">
        <label style="color:#a8710a">${c.ambiguousPets.length} pets are named "${esc(c.petName)}" — which one is this?</label>
        <select id="imp-petpick-${i}">
          <option value="">— Not sure, don't link to a pet profile —</option>
          ${c.ambiguousPets.map((p) => `<option value="${p.id}">${esc(p.name)} · ${esc(p.breed || "no breed on file")}${p.weight ? ` · ${p.weight}kg` : ""} · ${esc(groomerName(p.groomerId))}</option>`).join("")}
        </select>
      </div>` : ""}
    <div class="field-row" style="margin-top:8px">
      <input id="imp-breed-${i}" value="${esc(c.breed)}" placeholder="Breed">
      <div>
        <div class="row" style="gap:8px">
          <span class="dot" style="background:${calendarColorHex(c.colorId) || "#c3c8d4"}"></span>
          <select id="imp-groomer-${i}" style="flex:1">
            <option value="">— Choose —</option>
            <option value="none" ${!c.groomerId ? "selected" : ""}>No preference</option>
            ${state.groomers.map((g) => `<option value="${g.id}" ${c.groomerId === g.id ? "selected" : ""}>${esc(g.name)}</option>`).join("")}
          </select>
        </div>
        <div class="faint" style="font-size:11px; margin-top:3px">
          ${c.groomerId ? `matched by color` : (c.colorId ? "event has a color, but no groomer uses it" : "no color on this event")}
        </div>
      </div>
    </div>
    <div class="row" style="gap:14px; font-size:13px; margin-top:8px">
      ${SERVICES.map((s) => `<label class="row" style="gap:6px"><input type="checkbox" class="imp-svc" data-idx="${i}" data-svc="${esc(s)}" ${c.services.includes(s) ? "checked" : ""}> ${esc(serviceLabel(s))}</label>`).join("")}
    </div>
    <div class="field-row" style="margin-top:8px">
      <input id="imp-cost-${i}" type="number" min="0" step="1" placeholder="Total cost ฿ (optional)">
      <input id="imp-notes-${i}" value="${esc(c.notes)}" placeholder="Remark">
    </div>
  </div>`;
}

function renderImportReview(candidates, totalFetched) {
  const skipped = totalFetched - candidates.length;
  if (!candidates.length) {
    openModal(`
      <h2>Import bookings from Calendar</h2>
      <div class="muted">${totalFetched === 0
        ? `No events came back for that date range at all. Double-check the <strong>Calendar ID</strong>
           saved on this tab actually matches the calendar you're looking at in Google Calendar
           (Settings → that calendar → Integrate calendar → Calendar ID) — a mismatch there returns
           zero events with no error. Also confirm the range covers the events' actual dates.`
        : `Found ${totalFetched} event${totalFetched === 1 ? "" : "s"} in that range — all
           ${totalFetched === 1 ? "is" : "are"} already linked to a booking here, or had no usable start
           time. Nothing new to import.`}</div>
      <div class="row" style="justify-content:flex-end; margin-top:14px"><button class="btn primary" data-close-modal>Close</button></div>`);
    return;
  }
  const indexed = candidates.map((c, i) => ({ c, i }));
  const special = indexed.filter((x) => x.c.attentionReasons.length);
  const normal = indexed.filter((x) => !x.c.attentionReasons.length);
  // If every flagged row shares the same single reason, name it specifically; a mixed batch
  // (e.g. some ambiguous-pet, some no-breed) falls back to one generic heading — each row's
  // own reason(s) are still spelled out inline via importRow's notice line either way.
  const REASON_HEADINGS = {
    "ambiguous-pet": "name matches more than one pet",
    "no-breed": "no breed could be recognized",
    "name-fallback": "the title couldn't be confidently parsed",
    "multi-name": "the name may contain more than one pet",
  };
  const reasonKeys = new Set(special.flatMap((x) => x.c.attentionReasons.map((r) => r.key)));
  const specialHeading = reasonKeys.size === 1 ? REASON_HEADINGS[[...reasonKeys][0]] : "needs a closer look before importing";

  openModal(`
    <h2>Review ${candidates.length} booking${candidates.length === 1 ? "" : "s"} to import</h2>
    <div class="muted" style="margin-bottom:12px">
      Fix anything that looks off, untick anything that isn't really a booking, then import.
      ${skipped > 0 ? `<br><span class="faint">${skipped} event${skipped === 1 ? "" : "s"} already linked to an existing booking ${skipped === 1 ? "was" : "were"} skipped.</span>` : ""}
    </div>
    <div class="stack" id="imp-rows" style="gap:14px; max-height:55vh; overflow:auto; padding-right:4px">
      ${special.length ? `
        <div class="card pastdue-card" style="padding-bottom:2px">
          <div class="card pad" style="padding-bottom:0; border:0">
            <h3 class="section-title pastdue-title">⚠ Special attention — ${esc(specialHeading)} (${special.length})</h3>
          </div>
          <div class="stack" style="gap:10px; padding:0 16px 16px">
            ${special.map((x) => importRow(x.c, x.i)).join("")}
          </div>
        </div>` : ""}
      ${normal.length ? `<div class="stack" style="gap:10px">${normal.map((x) => importRow(x.c, x.i)).join("")}</div>` : ""}
    </div>
    <div class="row" style="justify-content:space-between; margin-top:14px; align-items:center">
      <label class="row" style="gap:6px; font-size:13px"><input type="checkbox" id="imp-select-all" checked> Select all</label>
      <div class="row">
        <button class="btn" data-close-modal>Cancel</button>
        <button class="btn primary" id="imp-confirm">Import selected</button>
      </div>
    </div>`);

  $("#imp-select-all").onchange = (e) => { $$(".imp-row-check").forEach((cb) => cb.checked = e.target.checked); };

  // Picking a specific pet for an ambiguous row fills in its breed too, same convenience
  // the normal booking form gives when a pet is matched.
  indexed.filter((x) => x.c.ambiguousPets).forEach(({ c, i }) => {
    const pick = $(`#imp-petpick-${i}`);
    if (!pick) return;
    pick.onchange = () => {
      const chosen = c.ambiguousPets.find((p) => p.id === pick.value);
      if (chosen && chosen.breed) $(`#imp-breed-${i}`).value = chosen.breed;
    };
  });

  $("#imp-confirm").onclick = async () => {
    const selected = candidates.map((c, i) => i).filter((i) => $(`#imp-check-${i}`).checked);
    if (!selected.length) { toast("Nothing selected"); return; }
    const btn = $("#imp-confirm");
    btn.disabled = true; btn.textContent = "Importing…";
    let count = 0;
    for (const i of selected) {
      const c = candidates[i];
      const petName = $(`#imp-name-${i}`).value.trim();
      if (!petName) continue;
      const startVal = $(`#imp-start-${i}`).value;
      if (!startVal) continue;
      const startIso = fromLocalInput(startVal);
      const breed = $(`#imp-breed-${i}`).value.trim();
      const groomerVal = $(`#imp-groomer-${i}`).value;
      const groomerId = groomerVal === "none" || groomerVal === "" ? null : groomerVal;
      const services = $$(".imp-svc").filter((cb) => cb.dataset.idx === String(i) && cb.checked).map((cb) => cb.dataset.svc);
      const notes = $(`#imp-notes-${i}`).value.trim();
      const costVal = $(`#imp-cost-${i}`).value;
      const totalHours = Object.keys(c.serviceHours).length ? Object.values(c.serviceHours).reduce((a, v) => a + v, 0) : services.length;
      const serviceHours = {};
      if (services.length) {
        const each = Math.round((totalHours / services.length) * 2) / 2 || 1;
        services.forEach((s) => { serviceHours[s] = each; });
      }
      const isPast = new Date(startIso) < new Date();
      const petId = c.ambiguousPets ? ($(`#imp-petpick-${i}`).value || null) : c.petId;
      const rec = {
        id: DB.uid("bk"),
        createdAt: Date.now(),
        petId,
        petName,
        breed,
        groomerId,
        start: startIso,
        recurrence: "none",
        recurrenceUntil: null,
        services,
        serviceHours,
        totalCost: costVal === "" ? null : Number(costVal),
        notes,
        calendarEventId: c.eventId,
        // All-day events had no real time — once given one here, push it back so the Calendar
        // event itself becomes a proper timed event instead of staying a vague all-day block.
        // Already-timed events already match what's on Calendar, so leave those alone.
        calendarDirty: c.allDay,
        status: isPast ? "completed" : "pending",
        completedAt: isPast ? new Date(startIso).getTime() : null,
      };
      await DB.put("bookings", rec);
      upsertLocal("bookings", rec);
      count++;
    }
    closeModal();
    toast(`Imported ${count} booking${count === 1 ? "" : "s"}`);
    render();
    if (count) logActivity("booking", "created", `Imported ${count} booking${count === 1 ? "" : "s"} from Calendar`);
  };
}

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
    <h2>Add person</h2>
    <div class="muted" style="margin-bottom:16px">They'll sign in with this name and PIN from now on.</div>
    <div class="field"><label>Name</label><input id="a-name" placeholder="e.g. Nina" autocomplete="off"></div>
    <div class="field"><label>Role</label>
      <select id="a-role">
        <option value="groomer" selected>Groomer — can add/edit within their sections, never delete</option>
        <option value="admin">Admin — full add/edit/delete within their sections</option>
      </select>
    </div>
    <div class="field"><label>PIN</label><input id="a-pin" type="password" inputmode="numeric" placeholder="6+ characters" autocomplete="new-password"></div>
    <div class="field"><label>Confirm PIN</label><input id="a-pin2" type="password" inputmode="numeric" placeholder="Repeat the PIN" autocomplete="new-password"></div>
    <div class="help" id="admin-error" style="color:var(--danger); font-weight:600"></div>
    <div class="row" style="justify-content:flex-end; margin-top:8px">
      <button class="btn" data-close-modal>Cancel</button>
      <button class="btn primary" id="save-admin">Add person</button>
    </div>`);

  $("#save-admin").onclick = async () => {
    const name = $("#a-name").value.trim();
    const role = $("#a-role").value;
    const pin = $("#a-pin").value;
    const pin2 = $("#a-pin2").value;
    const errEl = $("#admin-error");
    errEl.textContent = "";
    if (!name) { errEl.textContent = "Please enter a name."; return; }
    if (["owner", "app owner"].includes(name.trim().toLowerCase())) { errEl.textContent = "\"App Owner\" is reserved for the master account."; return; }
    if (pin.length < 6) { errEl.textContent = "PIN must be at least 6 characters."; return; }
    if (pin !== pin2) { errEl.textContent = "PINs don't match."; return; }

    const btn = $("#save-admin");
    btn.disabled = true; btn.textContent = "Adding…";
    try {
      const rec = await DB.createAdmin({ name, email: emailForName(name), pin, role });
      upsertLocal("admins", rec);
      closeModal(); toast("Person added"); render();
    } catch (err) {
      errEl.textContent = err.code === "auth/email-already-in-use"
        ? "That name is already taken — try a different one."
        : `Couldn't add that person (${err.code || err.message}).`;
      btn.disabled = false; btn.textContent = "Add person";
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

  // Completed/Cancelled/Bin collapsibles on Bookings — remember open/closed across re-renders
  // (completing/editing/cancelling a booking re-renders the whole page, which would otherwise
  // reset every <details> to closed and lose the staff member's place mid-review).
  $$("[data-open-key]").forEach((el) => el.ontoggle = () => { state.bookingsOpen[el.dataset.openKey] = el.open; });

  // Click an empty spot on the Schedule grid (Day/Week) to open "New booking" prefilled with
  // that date/time and groomer column, if any. Snaps to the start of whichever hour row was
  // clicked, not a finer-grained nearest-15-min — the grid only draws hour gridlines, so
  // snapping to anything sub-hour is invisible/unpredictable (a click anywhere in the "11:00"
  // row could silently land on 11:15/11:30 depending on exact pixel position). Existing
  // booking blocks (data-action="edit-booking") and the "closed" overlay sit on top and
  // capture their own clicks first, so e.target !== el there — this only fires on the empty
  // background itself.
  $$(".schedule-col-body").forEach((el) => {
    el.onclick = (e) => {
      if (e.target !== el || !el.dataset.date) return;
      const hours = getBusinessHours();
      const openMin = toMinutes(hours.open), closeMin = toMinutes(hours.close);
      const offsetY = e.clientY - el.getBoundingClientRect().top;
      const rawMin = openMin + (offsetY / PX_PER_HOUR) * 60;
      const snappedMin = Math.max(openMin, Math.min(closeMin, Math.floor(rawMin / 60) * 60));
      const start = new Date(`${el.dataset.date}T00:00:00`);
      start.setHours(Math.floor(snappedMin / 60), snappedMin % 60, 0, 0);
      bookingModal(null, null, { start, groomerId: el.dataset.groomerId || null });
    };
  });

  // schedule view-mode dropdown + groomer visibility toggles
  const schedMode = $("#sched-mode-select");
  if (schedMode) schedMode.onchange = () => { state.scheduleMode = schedMode.value; state.scheduleMiniCalOpen = false; render(); };
  $$(".sched-groomer-toggle").forEach((cb) => cb.onchange = () => {
    const id = cb.dataset.id;
    state.scheduleHiddenGroomers = cb.checked
      ? state.scheduleHiddenGroomers.filter((x) => x !== id)
      : [...state.scheduleHiddenGroomers, id];
    render();
  });

  // actions
  $$("[data-action]").forEach((el) => {
    // A <select> reports its choice via "change", not "click" — and el.dataset alone
    // doesn't carry the chosen value, so pass it through separately.
    const fire = () => handleAction(el.dataset.action, el.tagName === "SELECT" ? { ...el.dataset, value: el.value } : el.dataset);
    if (el.tagName === "SELECT") el.onchange = fire; else el.onclick = fire;
  });
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
      if (confirm("Delete this booking? It'll move to the Bin, where it can be restored later.")) {
        const deleted = state.bookings.find((b) => b.id === data.id);
        if (deleted) {
          // Soft delete: the full record moves to deletedBookings (same id, so restoring is
          // just moving it back) instead of being destroyed outright — see the Bin section.
          // Best-effort like Calendar sync: the backup copy must never block the actual
          // deletion (e.g. if deletedBookings' security rule isn't published yet).
          try {
            const trashed = { ...deleted, deletedAt: Date.now(), deletedBy: currentAdminName() };
            await DB.put("deletedBookings", trashed);
            upsertLocal("deletedBookings", trashed);
          } catch (err) {
            console.error("Couldn't back up to Bin (deleting anyway)", err);
          }
        }
        await DB.del("bookings", data.id); removeLocal("bookings", data.id); toast("Booking moved to Bin"); render();
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
    case "restore-booking": {
      const rec = state.deletedBookings.find((b) => b.id === data.id);
      if (rec) {
        const { deletedAt, deletedBy, ...rest } = rec;
        // The old Calendar event was tombstoned when this was deleted (and may be long
        // gone) — calendarDirty:true + no calendarEventId makes reconcileCalendar() create
        // a fresh one, same "gone means recreate" pattern used for any other sync gap.
        const restored = { ...rest, calendarEventId: null, calendarDirty: true };
        await DB.put("bookings", restored); upsertLocal("bookings", restored);
        await DB.del("deletedBookings", data.id); removeLocal("deletedBookings", data.id);
        toast("Booking restored"); render(); reconcileCalendar();
        logActivity("booking", "restored", `${restored.petName}${restored.breed ? ` (${restored.breed})` : ""} with ${groomerName(restored.groomerId)}`);
      }
      break;
    }
    case "purge-booking":
      if (confirm("Permanently delete this booking? This cannot be undone.")) {
        const purged = state.deletedBookings.find((b) => b.id === data.id);
        await DB.del("deletedBookings", data.id); removeLocal("deletedBookings", data.id);
        toast("Booking permanently deleted"); render();
        if (purged) logActivity("booking", "purged", `${purged.petName}${purged.breed ? ` (${purged.breed})` : ""}`);
      }
      break;
    case "complete-booking": {
      const b = state.bookings.find((x) => x.id === data.id);
      if (b) completeBookingModal(b);
      break;
    }
    case "cancel-booking": {
      const b = state.bookings.find((x) => x.id === data.id);
      if (b && confirm(`Cancel ${b.petName}'s booking?`)) {
        const rec = { ...b, status: "cancelled", completedAt: Date.now() };
        await DB.put("bookings", rec); upsertLocal("bookings", rec); toast("Booking cancelled"); render();
        if (b.calendarEventId) {
          const tomb = { id: DB.uid("tomb"), calendarId: getCalendarId() || null, eventId: b.calendarEventId, petName: b.petName, deletedAt: Date.now() };
          await DB.put("calendarTombstones", tomb);
          upsertLocal("calendarTombstones", tomb);
          reconcileCalendar();
        }
        logActivity("booking", "cancelled", `${b.petName}${b.breed ? ` (${b.breed})` : ""} with ${groomerName(b.groomerId)}`);
      }
      break;
    }
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
    case "new-admin": if (isOwnerSession()) adminModal(); break;
    case "del-admin":
      if (!isOwnerSession()) break;
      if (data.id === DB.currentUid()) { toast("You can't remove yourself while signed in."); break; }
      if (confirm("Remove this person? They'll immediately lose access.")) {
        await DB.removeAdmin(data.id); removeLocal("admins", data.id); toast("Removed"); render();
      } break;
    case "set-role": {
      if (!isOwnerSession()) break;
      const a = state.admins.find((x) => x.uid === data.id);
      if (!a) break;
      const rec = { ...a, role: data.value };
      await DB.put("admins", rec); upsertLocal("admins", rec);
      toast(`${a.name} is now ${data.value === "groomer" ? "a Groomer" : "an Admin"}`);
      render();
    } break;
    case "save-roles": {
      if (!isOwnerSession()) break;
      const admin = $$('.role-section[data-role="admin"]').filter((cb) => cb.checked).map((cb) => cb.dataset.section);
      const groomer = $$('.role-section[data-role="groomer"]').filter((cb) => cb.checked).map((cb) => cb.dataset.section);
      const rec = { id: "roles", admin, groomer, updatedAt: Date.now() };
      await DB.put("settings", rec); upsertLocal("settings", rec);
      toast("Role access saved"); render();
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
    case "gcal-import": calendarImportModal(); break;
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
    case "sched-jump": state.scheduleDate = data.date; state.scheduleMiniCalOpen = false; render(); break;
    case "toggle-mini-cal": state.scheduleMiniCalOpen = !state.scheduleMiniCalOpen; render(); break;
    case "mini-cal-prev": state.scheduleDate = addMonthsKey(state.scheduleDate || todayKey(), -1); render(); break;
    case "mini-cal-next": state.scheduleDate = addMonthsKey(state.scheduleDate || todayKey(), 1); render(); break;
    case "edit-hours": hoursModal(); break;
    case "fin-preset-today": {
      const t = todayKey();
      state.financialStart = t; state.financialEnd = t;
      state.financialCalMonth = t.slice(0, 7); state.financialCalOpen = false; render();
    } break;
    case "fin-preset-week": {
      const ws = startOfWeekKey(todayKey());
      state.financialStart = ws; state.financialEnd = addDaysKey(ws, 6);
      state.financialCalMonth = state.financialEnd.slice(0, 7); state.financialCalOpen = false; render();
    } break;
    case "fin-preset-month": {
      const mk = todayKey().slice(0, 7);
      state.financialStart = mk + "-01"; state.financialEnd = lastDayOfMonthKey(mk);
      state.financialCalMonth = mk; state.financialCalOpen = false; render();
    } break;
    case "fin-toggle-cal": state.financialCalOpen = !state.financialCalOpen; render(); break;
    case "fin-cal-prev": state.financialCalMonth = addMonthsToMonthKey(state.financialCalMonth || todayKey().slice(0, 7), -1); render(); break;
    case "fin-cal-next": state.financialCalMonth = addMonthsToMonthKey(state.financialCalMonth || todayKey().slice(0, 7), 1); render(); break;
    case "fin-pick-day": {
      // First click (or clicking after a complete range) starts a fresh single-day pick;
      // the next click extends it into a range, auto-ordering the two ends. A single day
      // stays valid on its own (financialEnd left blank → treated as start).
      if (state.financialEnd || !state.financialStart) {
        state.financialStart = data.date; state.financialEnd = "";
      } else if (data.date < state.financialStart) {
        state.financialEnd = state.financialStart; state.financialStart = data.date; state.financialCalOpen = false;
      } else {
        state.financialEnd = data.date; state.financialCalOpen = false;
      }
      render();
    } break;
    case "set-upcoming-range": state.upcomingRange = data.value; render(); break;
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

document.addEventListener("click", (e) => {
  if (!state.scheduleMiniCalOpen) return;
  if (e.target.closest(".mini-cal-popover") || e.target.closest('[data-action="toggle-mini-cal"]')) return;
  state.scheduleMiniCalOpen = false; render();
});
document.addEventListener("click", (e) => {
  if (!state.financialCalOpen) return;
  if (e.target.closest(".mini-cal-popover") || e.target.closest('[data-action="fin-toggle-cal"]')) return;
  state.financialCalOpen = false; render();
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
const COLLECTIONS = ["pets", "groomers", "bookings", "admins", "settings", "activity", "calendarTombstones", "deletedBookings"];
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
