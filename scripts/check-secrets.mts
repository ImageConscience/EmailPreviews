/**
 * The claims made about credential storage, checked.
 *
 * These are the ones that matter if the database is ever copied somewhere it
 * should not be, so they are asserted rather than asserted-in-a-comment.
 */
process.env.ENCRYPTION_KEY = "5CmlVNGIHmFlGQwuwpVGbAv1k/vKxLyfLZmNbg7K+U8=";

const { encryptSecret, decryptSecret, secretHint, secretsAvailable, SecretError } = await import(
  "../src/lib/secret.ts"
);

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) bad++;
};

const KEY = "pk_live_abcdef0123456789abcdef0123456789ab";

check("a 32-byte key is accepted", secretsAvailable());

const one = encryptSecret(KEY);
const two = encryptSecret(KEY);
check("round trips", decryptSecret(one) === KEY);
check("the plaintext never appears in the ciphertext", !one.includes(KEY) && !one.includes("abcdef"));
check("the same key encrypts differently each time (random IV)", one !== two, `${one.slice(0, 22)}… vs ${two.slice(0, 22)}…`);
check("both still decrypt to the same thing", decryptSecret(two) === KEY);

// Tampering must fail loudly rather than decrypt to something else.
const parts = one.split(".");
const flipped = [...parts];
const body = Buffer.from(parts[3], "base64");
body[0] ^= 0xff;
flipped[3] = body.toString("base64");
let tamperCaught = false;
try {
  decryptSecret(flipped.join("."));
} catch (e) {
  tamperCaught = e instanceof SecretError;
}
check("an altered ciphertext is rejected, not silently decrypted", tamperCaught);

// A different ENCRYPTION_KEY must not decrypt it either.
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
let wrongKeyCaught = false;
try {
  decryptSecret(one);
} catch (e) {
  wrongKeyCaught = e instanceof SecretError;
}
check("a different ENCRYPTION_KEY cannot read it", wrongKeyCaught);

// No key at all: refuse rather than fall back to something built in.
process.env.ENCRYPTION_KEY = "";
check("with no ENCRYPTION_KEY, storage reports unavailable", !secretsAvailable());
let noKeyCaught = false;
try {
  encryptSecret(KEY);
} catch (e) {
  noKeyCaught = e instanceof SecretError && /ENCRYPTION_KEY is not set/.test((e as Error).message);
}
check("...and refuses to encrypt rather than using a default", noKeyCaught);

process.env.ENCRYPTION_KEY = "too-short";
check("a wrong-sized key is refused", !secretsAvailable());

process.env.ENCRYPTION_KEY = "5CmlVNGIHmFlGQwuwpVGbAv1k/vKxLyfLZmNbg7K+U8=";
check("the hint shows only the last four", secretHint(KEY) === "••••89ab", secretHint(KEY));
check("a short key is not partly revealed by the hint", secretHint("pk_1") === "••••");

console.log(bad === 0 ? "\nALL SECRET CHECKS PASSED" : `\n${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
