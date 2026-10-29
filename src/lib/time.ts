// Day/month boundaries in a tenant's IANA timezone, without extra dependencies.

// Offset (ms) of `tz` from UTC at instant `at` (e.g. +2h for Africa/Cairo in winter).
function offsetMs(at: Date, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

// The UTC instant of local wall-clock time y-m-d 00:00 in `tz` (DST-safe: re-checks the offset).
function zonedMidnight(y: number, m: number, d: number, tz: string) {
  const guess = Date.UTC(y, m, d);
  let t = guess - offsetMs(new Date(guess), tz);
  t = guess - offsetMs(new Date(t), tz);
  return new Date(t);
}

const parseDay = (day: string) => day.split("-").map(Number) as [number, number, number];

export const dayStart = (day: string, tz: string) => {
  const [y, m, d] = parseDay(day);
  return zonedMidnight(y, m - 1, d, tz);
};

// Last millisecond of the local day.
export const dayEnd = (day: string, tz: string) => {
  const [y, m, d] = parseDay(day);
  return new Date(zonedMidnight(y, m - 1, d + 1, tz).getTime() - 1);
};

// "YYYY-MM-DD" of `at` in `tz`.
export const localDay = (at: Date, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

export function monthStart(at: Date, tz: string) {
  const [y, m] = parseDay(localDay(at, tz));
  return zonedMidnight(y, m - 1, 1, tz);
}

export function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
