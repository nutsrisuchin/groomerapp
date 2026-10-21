/* ===================================================================
   test.js — date/time tests for app.js. Run with:  node test.js

   No build step and no test framework: this loads app.js into a plain
   `vm` context with just enough fake DOM for its top-level wiring to run,
   then calls the date helpers directly.

   The point of these tests is the shop's one hard rule: every date and
   time in the app is BANGKOK time, whatever timezone the phone is set to.
   So the suite runs itself again as a child process under several very
   different zones and fails if any answer comes out different.
=================================================================== */
const fs = require("fs");
const vm = require("vm");
const { execFileSync } = require("child_process");

/* ---------- load app.js with a throwaway DOM ---------- */
function fakeEl() {
  return {
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
    setAttribute() {}, getAttribute: () => null, focus() {}, click() {},
    querySelector: () => fakeEl(), querySelectorAll: () => [],
    closest: () => null, contains: () => false,
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
    style: {}, dataset: {}, innerHTML: "", textContent: "", value: "", hidden: false,
  };
}
function loadApp() {
  const sandbox = {
    console,
    document: {
      addEventListener() {}, removeEventListener() {},
      querySelector: () => fakeEl(), querySelectorAll: () => [],
      getElementById: () => fakeEl(), createElement: () => fakeEl(),
      body: fakeEl(), documentElement: fakeEl(),
    },
    window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    setTimeout, clearTimeout, setInterval, clearInterval,
    // app.js only wires callbacks onto these at load time — never let them fire.
    DB: { onAuthChange() {}, watch: () => () => {}, getAll: async () => [], uid: () => "id_test" },
    GCal: { onStatusChange() {}, isConnected: () => false },
    FIREBASE_CONFIG: {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync("app.js", "utf8"), sandbox, { filename: "app.js" });
  return sandbox;
}

/* ---------- tiny assert helpers ---------- */
let pass = 0;
const failures = [];
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  failures.push(`${label}\n    ได้:    ${a}\n    ควรได้: ${e}`);
}
function ok(cond, label) { eq(!!cond, true, label); }

/* ---------- the tests ---------- */
const A = loadApp();
// 10:00 in Bangkok on 18 Mar 2026 is 03:00 UTC — the reference instant used throughout.
const MAR18_10AM = "2026-03-18T03:00:00.000Z";

function runTests() {
  /* --- dateKey: which Bangkok day does an instant fall on --- */
  eq(A.dateKey(MAR18_10AM), "2026-03-18", "dateKey: Bangkok 10:00");
  // 01:00 Bangkok on the 18th is still the 17th in UTC — a device behind Bangkok used to
  // report the previous day here, which is what shifted bookings by a day.
  eq(A.dateKey("2026-03-17T18:00:00.000Z"), "2026-03-18", "dateKey: Bangkok 01:00 (UTC still on the 17th)");
  // 00:30 Bangkok on the 19th: a device ahead of Bangkok used to report the next day.
  eq(A.dateKey("2026-03-18T17:30:00.000Z"), "2026-03-19", "dateKey: Bangkok 00:30 next day");
  eq(A.dateKey("2026-03-18T16:59:59.000Z"), "2026-03-18", "dateKey: Bangkok 23:59, last moment of the day");

  /* --- entering a time in the booking form --- */
  // The whole point: typing 10:00 must mean 10:00 in Bangkok, from anywhere on earth.
  eq(A.fromLocalInput("2026-03-18T10:00"), MAR18_10AM, "fromLocalInput: typed 10:00 = Bangkok 10:00");
  eq(A.fromLocalInput("2026-03-18T00:00"), "2026-03-17T17:00:00.000Z", "fromLocalInput: midnight");
  eq(A.fromLocalInput("2026-12-31T23:30"), "2026-12-31T16:30:00.000Z", "fromLocalInput: year end");
  // ...and the field must show back exactly what was typed.
  eq(A.toLocalInput(MAR18_10AM), "2026-03-18T10:00", "toLocalInput: shows Bangkok wall-clock");
  for (const v of ["2026-03-18T10:00", "2026-01-01T00:00", "2026-07-04T23:45"]) {
    eq(A.toLocalInput(A.fromLocalInput(v)), v, `round-trip ${v}`);
  }

  /* --- display --- */
  ok(A.fmtTime(MAR18_10AM).includes("10"), "fmtTime: Bangkok 10:00 shows 10");
  ok(A.fmtTime("2026-03-17T18:00:00.000Z").includes("1"), "fmtTime: Bangkok 01:00 shows 1");
  ok(A.fmtDate(MAR18_10AM).includes("18"), "fmtDate: shows the 18th");
  // A day key must always display as itself, never the day either side.
  ok(A.fmtDateKey("2026-03-18").includes("18"), "fmtDateKey: shows the 18th");
  ok(A.fmtDateFull("2026-03-18").includes("18"), "fmtDateFull: shows the 18th");

  /* --- day-key arithmetic --- */
  eq(A.addDaysKey("2026-03-18", 1), "2026-03-19", "addDaysKey +1");
  eq(A.addDaysKey("2026-03-01", -1), "2026-02-28", "addDaysKey across a month start");
  eq(A.addDaysKey("2026-12-31", 1), "2027-01-01", "addDaysKey across new year");
  eq(A.addDaysKey("2028-02-28", 1), "2028-02-29", "addDaysKey into a leap day");
  eq(A.addMonthsKey("2026-03-18", 1), "2026-04-18", "addMonthsKey +1");
  eq(A.addMonthsKey("2026-01-31", 1), "2026-02-28", "addMonthsKey clamps Jan 31 to end of Feb");
  eq(A.startOfWeekKey("2026-03-18"), "2026-03-15", "startOfWeekKey: Wed → Sunday before it");
  eq(A.monthGridDates("2026-03-18").length, 42, "monthGridDates: 42 cells");
  eq(A.monthGridDates("2026-03-18")[0], "2026-03-01", "monthGridDates: starts on the right Sunday");
  eq(A.dateKey(A.startOfToday()), A.todayKey(), "startOfToday agrees with todayKey");

  /* --- recurrence --- */
  const monthly = { start: MAR18_10AM, recurrence: "monthly", recurrenceUntil: "2026-12-30" };
  eq(A.dateKey(A.occurrenceOnDate(monthly, "2026-04-18")), "2026-04-18", "monthly: lands on the 18th");
  eq(A.toLocalInput(A.occurrenceOnDate(monthly, "2026-04-18")), "2026-04-18T10:00", "monthly: keeps 10:00 Bangkok");
  eq(A.occurrenceOnDate(monthly, "2026-04-19"), null, "monthly: nothing on the 19th");
  eq(A.occurrenceOnDate(monthly, "2027-01-18"), null, "monthly: stops after repeat-until");

  // A booking just after Bangkok midnight — its UTC date is the day before, which is exactly
  // where naive date maths drops or double-counts an occurrence.
  const earlyBird = { start: "2030-03-17T18:00:00.000Z", recurrence: "weekly", recurrenceUntil: "2030-04-30" };
  eq(A.dateKey(earlyBird.start), "2030-03-18", "early booking is on the 18th in Bangkok");
  eq(A.dateKey(A.occurrenceOnDate(earlyBird, "2030-03-25")), "2030-03-25", "weekly: next week lands right");
  eq(A.toLocalInput(A.occurrenceOnDate(earlyBird, "2030-03-25")), "2030-03-25T01:00", "weekly: keeps 01:00 Bangkok");

  const weekly = { start: "2030-03-18T03:00:00.000Z", recurrence: "weekly", recurrenceUntil: "2030-04-15" };
  eq(A.upcomingOccurrences(weekly, new Date("2031-01-01")).map(A.dateKey),
     ["2030-03-18", "2030-03-25", "2030-04-01", "2030-04-08", "2030-04-15"],
     "weekly: every date through repeat-until, inclusive");

  // The real booking that started all of this: monthly, 18 Mar 2027 → 30 Dec 2027 = 10 dates.
  const katia = { start: "2030-03-18T03:00:00.000Z", recurrence: "monthly", recurrenceUntil: "2030-12-30" };
  eq(A.upcomingOccurrences(katia, new Date("2030-04-01")).map(A.dateKey),
     ["2030-03-18", "2030-04-18", "2030-05-18", "2030-06-18", "2030-07-18",
      "2030-08-18", "2030-09-18", "2030-10-18", "2030-11-18", "2030-12-18"],
     "monthly series shows all 10 dates even past the 90-day horizon");

  // An excluded ("delete just this one") date drops out and nothing else moves.
  const skipped = { start: "2030-03-18T03:00:00.000Z", recurrence: "weekly", recurrenceUntil: "2030-04-08", excludedDates: ["2030-03-25"] };
  eq(A.upcomingOccurrences(skipped, new Date("2031-01-01")).map(A.dateKey),
     ["2030-03-18", "2030-04-01", "2030-04-08"], "weekly: excluded date is skipped");
  eq(A.occurrenceOnDate(skipped, "2030-03-25"), null, "excluded date has no occurrence");

  /* --- a value that must be identical in every timezone --- */
  return JSON.stringify({
    dateKeys: ["2026-03-17T18:00:00.000Z", MAR18_10AM, "2026-03-18T17:30:00.000Z"].map(A.dateKey),
    entered: ["2026-03-18T10:00", "2026-01-01T00:00"].map(A.fromLocalInput),
    shown: [A.toLocalInput(MAR18_10AM), A.fmtTime(MAR18_10AM), A.fmtDate(MAR18_10AM), A.fmtDateKey("2026-03-18")],
    keyMath: [A.addDaysKey("2026-12-31", 1), A.addMonthsKey("2026-01-31", 1), A.startOfWeekKey("2026-03-18")],
    series: A.upcomingOccurrences(katia, new Date("2030-04-01")).map(A.dateKey),
    weeklyEarly: A.upcomingOccurrences(earlyBird, new Date("2031-01-01")).map(A.dateKey),
  });
}

const fingerprint = runTests();

/* ---------- run again under other timezones and compare ---------- */
const ZONES = ["Asia/Bangkok", "Europe/London", "America/New_York", "Pacific/Auckland", "UTC"];
if (!process.env.GROOMER_TZ_CHILD) {
  for (const tz of ZONES) {
    let out;
    try {
      out = execFileSync(process.execPath, [__filename], {
        env: { ...process.env, TZ: tz, GROOMER_TZ_CHILD: "1" }, encoding: "utf8",
      }).trim();
    } catch (err) {
      failures.push(`โซนเวลา ${tz}: เทสต์ล้มเหลว\n${(err.stdout || "") + (err.stderr || "")}`);
      continue;
    }
    if (out !== fingerprint) {
      failures.push(`โซนเวลา ${tz}: ผลลัพธ์ไม่ตรงกับเครื่องที่ตั้งเป็นเวลาอื่น\n    ได้:    ${out}\n    ควรได้: ${fingerprint}`);
    } else { pass++; }
  }
} else {
  process.stdout.write(fingerprint); // the parent compares this
  process.exit(failures.length ? 1 : 0);
}

/* ---------- report ---------- */
if (failures.length) {
  console.log(`\n❌ ไม่ผ่าน ${failures.length} รายการ (ผ่าน ${pass})\n`);
  failures.forEach((f, i) => console.log(`${i + 1}. ${f}\n`));
  process.exit(1);
}
console.log(`\n✅ ผ่านทั้งหมด ${pass} รายการ`);
console.log(`   ตรวจแล้วว่าให้ผลเหมือนกันทุกโซนเวลา: ${ZONES.join(", ")}\n`);
