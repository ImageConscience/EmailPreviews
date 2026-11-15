import { analyseSms, checkSms, MMS_MAX_CHARACTERS } from "../src/lib/sms.ts";

/**
 * The SMS arithmetic, against cases worked out by hand.
 *
 * Every boundary here is one that costs money when it is wrong: a message one
 * character past 160 is two texts, and one curly quote turns 160 into 70.
 */

let bad = 0;
const ok = (cond: boolean, label: string, detail = "") => {
  if (!cond) bad++;
  console.log(`${cond ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const seg = (body: string) => analyseSms(body);

console.log("Plain GSM-7");
ok(seg("").segments === 0, "an empty body is no texts");
ok(seg("a".repeat(160)).segments === 1, "160 characters is one text");
ok(seg("a".repeat(161)).segments === 2, "161 characters is two");
ok(seg("a".repeat(306)).segments === 2, "306 is still two (153 each)");
ok(seg("a".repeat(307)).segments === 3, "307 is three");
ok(seg("a".repeat(150)).remaining === 10, "remaining counts down from 160", String(seg("a".repeat(150)).remaining));

console.log("\nExtension characters cost two");
ok(seg("€".repeat(80)).units === 160, "eighty euro signs are 160 septets");
ok(seg("€".repeat(80)).segments === 1, "...and fit in one text");
ok(seg("€".repeat(81)).segments === 2, "...one more is two");
ok(seg("{x}").encoding === "GSM-7", "braces stay GSM-7");

console.log("\nOne character outside the alphabet changes everything");
const curly = "It’s here" + "a".repeat(61);
ok(seg(curly).encoding === "UCS-2", "a curly apostrophe forces UCS-2");
ok(seg(curly).characters === 70 && seg(curly).segments === 1, "70 UCS-2 characters is one text");
ok(seg(curly + "a").segments === 2, "71 is two");
ok(seg("a".repeat(134) + "’").segments === 3, "135 UCS-2 is three (67 each)");
ok(seg("’").replacements[0]?.to === "'", "the curly apostrophe is offered a plain one");

console.log("\nEmoji are two code units");
const emoji = analyseSms("🎉");
ok(emoji.characters === 1 && emoji.units === 2, "one emoji is one character, two units", `${emoji.characters}/${emoji.units}`);
ok(analyseSms("🎉".repeat(35)).segments === 1, "35 emoji fill exactly one text");
ok(analyseSms("🎉".repeat(36)).segments === 2, "36 do not");

console.log("\nWhat the push refuses, and what it only mentions");
const base = { platformAddsOptOut: false };
ok(checkSms({ ...base, body: "" }).problems.length > 0, "no text is a problem");
ok(
  checkSms({ ...base, body: "Sale today" }).problems.some((p) => /how to stop/.test(p)),
  "no opt-out wording is a problem when the platform will not add it",
);
ok(
  checkSms({ body: "Sale today", platformAddsOptOut: true }).problems.length === 0,
  "...and not one when it will",
);
ok(checkSms({ ...base, body: "Sale. Reply STOP to opt out" }).problems.length === 0, "STOP in the copy satisfies it");
ok(
  checkSms({ ...base, body: "Sale. Reply STOP", imageUrl: "http://x.test/a.jpg" }).problems.some((p) => /https/.test(p)),
  "an http image is refused",
);
ok(
  checkSms({ ...base, body: "Sale. Reply STOP", imageUrl: "https://x.test/a.webp" }).warnings.some((w) => /does not end/.test(w)),
  "a webp image is only a warning",
);
ok(
  checkSms({ ...base, body: "x".repeat(MMS_MAX_CHARACTERS + 1) + " STOP", imageUrl: "https://x.test/a.png" })
    .problems.some((p) => /at most/.test(p)),
  "an MMS over the limit is refused",
);
ok(
  checkSms({ ...base, body: "a".repeat(400) + " STOP", imageUrl: "https://x.test/a.png" }).warnings.length === 0,
  "an MMS is not counted in segments",
);
ok(
  checkSms({ ...base, body: "a".repeat(200) + " STOP" }).warnings.some((w) => /2 texts/.test(w)),
  "a long SMS warns how many texts it becomes",
);

if (bad) {
  console.log(`\n${bad} SMS CHECK${bad === 1 ? "" : "S"} FAILED`);
  process.exit(1);
}
console.log("\nALL SMS CHECKS PASSED");
