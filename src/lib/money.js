// money.js — all monetary values in RoomSync are stored and computed as
// integer minor units (paise for INR). Floating point is never used for
// arithmetic on money; floats only appear transiently when parsing user input,
// and are immediately rounded to an integer.

/** Convert a user-entered rupee string/number to integer paise. Returns null if invalid. */
export function parseAmountToPaise(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [rupees, frac = ''] = s.split('.');
  const paise = Number(rupees) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(paise)) return null;
  return paise;
}

/** Format integer paise as a display string, e.g. 123450 -> "₹1,234.50". */
export function formatPaise(paise, { currency = 'INR', signed = false } = {}) {
  if (!Number.isInteger(paise)) return '—';
  const sign = paise < 0 ? '-' : signed && paise > 0 ? '+' : '';
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const formatted = new Intl.NumberFormat('en-IN').format(rupees);
  const symbol = currency === 'INR' ? '₹' : currency + ' ';
  return `${sign}${symbol}${formatted}.${frac}`;
}

/** Sum an array of integer paise values safely. */
export function sumPaise(values) {
  let total = 0;
  for (const v of values) {
    if (!Number.isInteger(v)) throw new Error('sumPaise: non-integer amount');
    total += v;
  }
  if (!Number.isSafeInteger(total)) throw new Error('sumPaise: overflow');
  return total;
}
