/** Reference business timestamps come from the configured logical clock when available. */
export function referenceInstant(currentTime?: string | null): string {
  if (currentTime) {
    const parsed = new Date(currentTime);
    if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

export function referenceBusinessDate(instant: string, timeZone: string): string {
  const parsed = new Date(instant);
  if (!timeZone || Number.isNaN(parsed.valueOf())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(parsed);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return "";
  }
}

export function referencePeriod(currentTime?: string | null): { periodStart: string; periodEnd: string } {
  const periodEnd = referenceInstant(currentTime);
  return { periodStart: new Date(Date.parse(periodEnd) - 86400000).toISOString(), periodEnd };
}
