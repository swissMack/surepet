/**
 * Sunset time without network or dependencies — NOAA solar position
 * algorithm (same zenith 90.833° as Home Assistant's sun.sun), accurate
 * to about a minute at mid latitudes.
 */

const RAD = Math.PI / 180;

/** UTC instant of sunset on the given calendar date (Y-M-D) at lat/lon, or null if the sun does not set. */
export function sunsetUtc(
  year: number,
  month: number,
  day: number,
  lat: number,
  lon: number,
  elevationM = 0
): Date | null {
  // Observer height lowers the horizon (same correction as HA/astral)
  const zenith = 90.833 + (2.076 * Math.sqrt(Math.max(0, elevationM))) / 60;
  // Julian day at 12:00 UTC of that date
  const jd = Date.UTC(year, month - 1, day, 12) / 86400000 + 2440587.5;
  // Iterate twice: evaluate the sun's position at the approximate sunset time
  let minutesUtc = 720 - 4 * lon + 300;
  for (let i = 0; i < 2; i++) {
    const t = (jd - 0.5 + minutesUtc / 1440 - 2451545) / 36525;
    const l0 = (280.46646 + t * (36000.76983 + 0.0003032 * t)) % 360;
    const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
    const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
    const c =
      Math.sin(m * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
      Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * t) +
      Math.sin(3 * m * RAD) * 0.000289;
    const omega = 125.04 - 1934.136 * t;
    const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(omega * RAD);
    const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
    const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
    const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
    const y = Math.tan((eps / 2) * RAD) ** 2;
    const eqTime =
      4 / RAD *
      (y * Math.sin(2 * l0 * RAD) -
        2 * e * Math.sin(m * RAD) +
        4 * e * y * Math.sin(m * RAD) * Math.cos(2 * l0 * RAD) -
        0.5 * y * y * Math.sin(4 * l0 * RAD) -
        1.25 * e * e * Math.sin(2 * m * RAD));
    const cosH =
      Math.cos(zenith * RAD) / (Math.cos(lat * RAD) * Math.cos(decl)) -
      Math.tan(lat * RAD) * Math.tan(decl);
    if (cosH < -1 || cosH > 1) return null;
    const hourAngle = Math.acos(cosH) / RAD;
    minutesUtc = 720 - 4 * (lon - hourAngle) - eqTime;
  }
  return new Date(Date.UTC(year, month - 1, day) + minutesUtc * 60000);
}

/** Today's date (Y, M, D) and a Date's HH:MM, both in the given IANA timezone. */
function partsIn(date: Date, timezone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value])
  );
  return { year: +p.year, month: +p.month, day: +p.day, hhmm: `${p.hour}:${p.minute}` };
}

/** Local HH:MM of today's sunset plus offset minutes, or null in polar day/night. */
export function sunsetLockTime(
  lat: number,
  lon: number,
  timezone: string,
  offsetMinutes = 0,
  elevationM = 0,
  now: Date = new Date()
): string | null {
  const today = partsIn(now, timezone);
  const sunset = sunsetUtc(today.year, today.month, today.day, lat, lon, elevationM);
  if (!sunset) return null;
  return partsIn(new Date(sunset.getTime() + offsetMinutes * 60000), timezone).hhmm;
}
