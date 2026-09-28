/** Exact money helpers. Domain amounts are always stored as minor-unit strings. */

export interface Money {
  currency: string;
  /** Signed integer in the currency's minor unit. Never a JavaScript number. */
  amountMinor: string;
}

const CURRENCY_SCALE: Readonly<Record<string, number>> = {
  CNY: 2,
};

export function currencyScale(currency: string): number {
  const scale = CURRENCY_SCALE[currency.toUpperCase()];
  if (scale === undefined) {
    throw new Error(`Unsupported currency precision: ${currency}`);
  }
  return scale;
}

export function normalizeMinorAmount(value: string): string {
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error("Minor amount must be an integer string");
  }
  const negative = trimmed.startsWith("-");
  const digits = (negative ? trimmed.slice(1) : trimmed).replace(/^0+(?=\d)/, "");
  return negative && digits !== "0" ? `-${digits}` : digits;
}

export function createMoney(currency: string, amountMinor: string): Money {
  currencyScale(currency);
  return { currency: currency.toUpperCase(), amountMinor: normalizeMinorAmount(amountMinor) };
}

/** Converts a human decimal string without using floating point arithmetic. */
export function decimalToMinor(decimal: string, currency = "CNY"): string {
  const scale = currencyScale(currency);
  const trimmed = decimal.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) {
    throw new Error("Amount must be a plain decimal string");
  }
  const [, sign, whole, fraction = ""] = match;
  if (fraction.length > scale) {
    throw new Error(`${currency} supports at most ${scale} decimal places`);
  }
  return normalizeMinorAmount(`${sign}${whole}${fraction.padEnd(scale, "0")}`);
}

/** Converts a domain minor-unit amount to a backend decimal string. */
export function minorToDecimal(minorAmount: string, currency = "CNY"): string {
  const scale = currencyScale(currency);
  const normalized = normalizeMinorAmount(minorAmount);
  const negative = normalized.startsWith("-");
  const digits = negative ? normalized.slice(1) : normalized;
  const padded = digits.padStart(scale + 1, "0");
  const whole = padded.slice(0, -scale) || "0";
  const fraction = padded.slice(-scale);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** Converts a minor-unit string only when the target protocol safely accepts Long/number. */
export function minorToSafeInteger(minorAmount: string): number {
  const normalized = normalizeMinorAmount(minorAmount);
  const numeric = Number(normalized);
  if (!Number.isSafeInteger(numeric)) {
    throw new Error("Amount exceeds the WOW backend Long-safe JSON range");
  }
  return numeric;
}

export function subtractMoney(total: Money, ...deductions: Array<Money | undefined>): Money | undefined {
  let value = BigInt(total.amountMinor);
  for (const deduction of deductions) {
    if (!deduction || deduction.currency !== total.currency) return undefined;
    value -= BigInt(deduction.amountMinor);
  }
  return createMoney(total.currency, value.toString());
}
