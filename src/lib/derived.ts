/**
 * Values a row should not have to be told.
 *
 * The member price is retail less the membership discount, and retail is
 * whatever the product costs. Both were columns someone typed into every row,
 * which is two chances to disagree with the catalogue and one more thing to
 * update when a price changes. They are computed here instead, after the
 * collection blocks have filled their slots, so a tile picked from the
 * catalogue prices itself.
 *
 * Nothing computed ever overwrites something written by hand: a row that
 * already carries `member_price` keeps it. That matters for the sends already
 * in the sheet, which predate any of this, and for the occasional shirt sold
 * at a price no formula would produce.
 */

/**
 * Row-level fields the app works out, rather than someone filling them in.
 *
 * Grouped in the editor rather than sitting among the hand-written copy: they
 * are normally empty, and two full-height boxes for values nobody types is
 * noise in the middle of the fields that do need attention.
 */
export const DERIVED_FIELDS = ["member_price", "retail_price"];

/** Museum of Graffiti's membership saving, and a sane default elsewhere. */
const DEFAULT_DISCOUNT = 0.2;

/**
 * "20%", "20", "0.2" all mean the same thing to whoever typed it, so accept
 * all three. Anything outside 0-1 after normalising is a typo, not an
 * instruction -- fall back rather than render a nonsense price.
 */
export function parseDiscount(raw: string | undefined): number {
  const text = (raw ?? "").trim();
  if (!text) return DEFAULT_DISCOUNT;

  const n = Number.parseFloat(text.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DISCOUNT;

  // "20%" and a bare "20" are both twenty percent; "0.2" is already a fraction.
  const fraction = text.includes("%") || n > 1 ? n / 100 : n;
  return fraction > 0 && fraction < 1 ? fraction : DEFAULT_DISCOUNT;
}

interface Money {
  /** Whatever sat in front of the number -- "$", "£", or nothing at all. */
  prefix: string;
  amount: number;
  grouped: boolean;
}

function parseMoney(raw: string): Money | null {
  const text = (raw ?? "").trim();
  if (!text) return null;

  const match = text.match(/^([^\d]*)([\d.,]+)/);
  if (!match) return null;

  const digits = match[2].replace(/,/g, "");
  const amount = Number.parseFloat(digits);
  if (!Number.isFinite(amount)) return null;

  return { prefix: match[1].trim(), amount, grouped: match[2].includes(",") };
}

/**
 * Whole dollars, always two decimals: $45.00 -> $36.00, and $49.99 -> $40.00
 * rather than $39.99. A membership price is a headline number, and a price
 * ending in .99 reads as a markdown rather than a member benefit.
 */
export function memberPrice(retail: string, discount = DEFAULT_DISCOUNT): string {
  const money = parseMoney(retail);
  if (!money) return "";

  const rounded = Math.round(money.amount * (1 - discount));
  const body = money.grouped || rounded >= 1000
    ? rounded.toLocaleString("en-US")
    : String(rounded);

  return `${money.prefix}${body}.00`;
}

/**
 * Cells that hold a small list rather than one value.
 *
 * A colour range is eight swatches and a palette send is three colour bands,
 * which as separate columns is twenty spreadsheet headings for two ideas -- on
 * a sheet that has to carry six templates at once, that is most of the width
 * for the least of the content. Packing each into one cell keeps the sheet
 * readable; unpacking here keeps the templates flat, the same trade the
 * collection blocks make.
 */
interface PackedField {
  /** The cell someone fills in. */
  cell: string;
  /** What it expands into: `${prefix}${n}${suffix}` for a list, or named parts. */
  expand: (value: string) => Record<string, string>;
}

/** "a, b, c" -> swatch_1, swatch_2, swatch_3. */
function splitList(value: string, prefix: string, max: number): Record<string, string> {
  const parts = value.split(",").map((part) => part.trim());
  const out: Record<string, string> = {};
  for (let i = 0; i < max; i++) out[`${prefix}${i + 1}`] = parts[i] ?? "";
  return out;
}

/**
 * "Name | Count | Note | #hex | #tint" -> the five band fields.
 *
 * The tint is the pale wash the band's products sit on, a few steps up from
 * the colour panel beside them. It is last because most bands look right
 * without one: left off, the products sit on paper.
 */
function splitBand(value: string, n: number): Record<string, string> {
  const [name = "", count = "", note = "", color = "", tint = ""] = value
    .split("|")
    .map((p) => p.trim());
  return {
    [`band_${n}_name`]: name,
    [`band_${n}_count`]: count,
    [`band_${n}_note`]: note,
    [`band_${n}_color`]: color,
    [`band_${n}_tint`]: tint || "#faf9f6",
  };
}

const PACKED: PackedField[] = [
  { cell: "swatches", expand: (v) => splitList(v, "swatch_", 8) },
  { cell: "band_1", expand: (v) => splitBand(v, 1) },
  { cell: "band_2", expand: (v) => splitBand(v, 2) },
  { cell: "band_3", expand: (v) => splitBand(v, 3) },
];

/** The cells a sheet can carry instead of the fields they expand into. */
export const PACKED_FIELDS = PACKED.map((p) => p.cell);

/** Blank, or whitespace only. */
function empty(values: Record<string, string>, key: string): boolean {
  return (values[key] ?? "").trim() === "";
}

/**
 * Fill in what can be worked out, leaving anything hand-entered alone.
 *
 * - `product_N_member_price` for every slot that has a price
 * - `retail_price`, from the featured product when the row does not say
 * - `member_price`, from whichever retail figure applies
 */
export function deriveValues(values: Record<string, string>): Record<string, string> {
  const next = { ...values };
  const discount = parseDiscount(next.member_discount);

  // Packed cells first, so anything derived from them sees the unpacked values.
  for (const packed of PACKED) {
    const raw = (next[packed.cell] ?? "").trim();
    if (!raw) continue;
    for (const [key, value] of Object.entries(packed.expand(raw))) {
      // A field written out in full still wins over the packed cell. Short
      // lists set the remainder to "" rather than leaving it unset, so an
      // unused swatch reads as a blank slot rather than an unmatched field.
      if (empty(next, key)) next[key] = value;
    }
  }

  for (let slot = 1; slot <= 8; slot++) {
    const price = (next[`product_${slot}_price`] ?? "").trim();
    const key = `product_${slot}_member_price`;
    if (price && empty(next, key)) {
      const computed = memberPrice(price, discount);
      if (computed) next[key] = computed;
    }
  }

  // The tee templates show one retail figure and one member figure, both about
  // the featured shirt.
  const featured = (next.product_1_price ?? "").trim();
  if (featured && empty(next, "retail_price")) next.retail_price = featured;

  const retail = (next.retail_price ?? "").trim();
  if (retail && empty(next, "member_price")) {
    const computed = memberPrice(retail, discount);
    if (computed) next.member_price = computed;
  }

  return next;
}
