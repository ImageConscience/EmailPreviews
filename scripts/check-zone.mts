import { zonedToUtc, describe } from "../src/lib/zone.ts";
const NY = "America/New_York";
let bad = 0;
const t = (date: string, time: string, wantUtc: string, note = "", zone = NY) => {
  const r = zonedToUtc(date, time, zone);
  const got = r.utc ? r.utc.toISOString() : "null";
  const ok = got === wantUtc;
  if (!ok) bad++;
  console.log(`${ok ? " ok " : "FAIL"}  ${date} ${time} ${zone.padEnd(19)} -> ${got}${note ? "   (" + note + ")" : ""}${r.warning ? "\n        warn: " + r.warning : ""}`);
};

console.log("Eastern Standard Time (UTC-5)");
t("2026-01-15", "10:00", "2026-01-15T15:00:00.000Z", "winter");
t("2026-12-25", "00:00", "2026-12-25T05:00:00.000Z", "midnight");

console.log("\nEastern Daylight Time (UTC-4)");
t("2026-07-04", "10:00", "2026-07-04T14:00:00.000Z", "summer");
t("2026-09-03", "10:00", "2026-09-03T14:00:00.000Z", "a real send date from the sheet");

console.log("\nSpring forward — 2am jumps to 3am on 2026-03-08");
t("2026-03-08", "01:59", "2026-03-08T06:59:00.000Z", "last moment of EST");
{
  const r = zonedToUtc("2026-03-08", "02:30", NY);
  const ok = r.utc !== null && !!r.warning && /does not exist/.test(r.warning);
  if (!ok) bad++;
  console.log(`${ok ? " ok " : "FAIL"}  2026-03-08 02:30 -> ${r.utc?.toISOString()}  (hour does not exist; must warn)`);
  if (r.warning) console.log("        warn:", r.warning);
}
t("2026-03-08", "03:00", "2026-03-08T07:00:00.000Z", "first moment of EDT");

console.log("\nFall back — 2am happens twice on 2026-11-01");
t("2026-11-01", "00:30", "2026-11-01T04:30:00.000Z", "before, EDT");
t("2026-11-01", "01:30", "2026-11-01T05:30:00.000Z", "ambiguous; takes the first");
t("2026-11-01", "03:00", "2026-11-01T08:00:00.000Z", "after, EST");

console.log("\nOther zones");
t("2026-01-15", "10:00", "2026-01-15T10:00:00.000Z", "", "UTC");
t("2026-07-04", "10:00", "2026-07-04T09:00:00.000Z", "BST", "Europe/London");
t("2026-01-15", "10:00", "2026-01-14T23:00:00.000Z", "AEDT, next day in UTC", "Australia/Sydney");

console.log("\nRubbish in");
for (const [d, tm] of [["", "10:00"], ["2026-13-01", "10:00"], ["2026-09-03", "25:00"], ["not a date", "10:00"]]) {
  const r = zonedToUtc(d, tm, NY);
  const ok = r.utc === null;
  console.log(`${ok ? " ok " : "FAIL"}  ${JSON.stringify(d)} ${JSON.stringify(tm)} -> ${r.utc ? r.utc.toISOString() : "null"}`);
  if (!ok) bad++;
}

console.log("\nBlank time defaults to midnight:", zonedToUtc("2026-09-03", "", NY).utc?.toISOString());
console.log("Readback:", describe(new Date("2026-09-03T14:00:00Z"), NY));
console.log(bad === 0 ? "\nALL ZONE CHECKS PASSED" : `\n${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
