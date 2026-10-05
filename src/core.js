/**
 * Core logic for time-slot validation.
 *
 * The central difficulty is converting a UTC instant into the wall-clock time
 * of a target timezone WITHOUT a database-backed tz library. Standard ECMAScript
 * provides `Intl.DateTimeFormat`, which performs the conversion using the host's
 * tz data. We exploit `formatToParts` to obtain the local wall-clock, then
 * recombine into a civil time and compare against the recurring window.
 *
 * Because we never cross from wall-clock back into a Date for comparison, we
 * sidestep the DST ambiguity trap: we compare *fields* (hours, minutes) directly,
 * which is exactly what an availability calendar is about.
 */

/**
 * A weekly recurring availability window in a specific timezone.
 * @typedef {Object} AvailabilityWindow
 * @property {number} dayOfWeek  0 = Sunday ... 6 = Saturday (matches `Date.prototype.getDay()`).
 * @property {number} startHour   0-23, local wall-clock hour at which availability opens.
 * @property {number} startMinute 0-59, local wall-clock minute at which availability opens.
 * @property {number} endHour     0-23, local wall-clock hour at which availability closes.
 * @property {number} endMinute   0-59, local wall-clock minute at which availability closes.
 */

/**
 * Validates whether a given UTC instant falls inside a set of recurring
 * weekly availability windows defined in a specific timezone.
 *
 * Windows are treated as INCLUSIVE of the start minute and EXCLUSIVE of the
 * end minute. A window that runs 09:00-17:00 contains 16:59 but not 17:00.
 * A window MAY NOT wrap past midnight: endMinute must be strictly after the
 * start. Cross-midnight windows are rejected at construction time so that the
 * inclusivity rule stays unambiguous.
 */
export class TimeSlotValidator {
  /**
   * @param {AvailabilityWindow[]} windows
   * @param {string} timeZone  IANA timezone name, e.g. "America/New_York".
   */
  constructor(windows, timeZone) {
    if (!Array.isArray(windows) || windows.length === 0) {
      throw new TypeError('windows must be a non-empty array');
    }
    if (typeof timeZone !== 'string' || timeZone.length === 0) {
      throw new TypeError('timeZone must be a non-empty string');
    }
    // Validate eagerly so callers learn of malformed windows once, not per call.
    this._windows = windows.map((w, i) => {
      if (!w || typeof w !== 'object') {
        throw new TypeError(`window[${i}] must be an object`);
      }
      const { dayOfWeek, startHour, startMinute, endHour, endMinute } = w;
      if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
        throw new RangeError(`window[${i}].dayOfWeek must be 0..6`);
      }
      for (const [name, max] of [
        ['startHour', 23], ['endHour', 23],
        ['startMinute', 59], ['endMinute', 59],
      ]) {
        if (!Number.isInteger(w[name]) || w[name] < 0 || w[name] > max) {
          throw new RangeError(`window[${i}].${name} out of range`);
        }
      }
      const start = startHour * 60 + startMinute;
      const end = endHour * 60 + endMinute;
      if (end <= start) {
        throw new RangeError(
          `window[${i}] must end strictly after it starts; cross-midnight windows are not supported`
        );
      }
      return { ...w, _startMin: start, _endMin: end };
    });
    this._timeZone = timeZone;
    // Format is constructed once and cached. timeZone is pinned so the formatter
    // is deterministic regardless of the process's default locale.
    this._formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /**
   * Extracts the local wall-clock day-of-week and minute-of-day for a given
   * UTC instant, in this validator's timezone.
   *
   * `formatToParts` is preferred over `format` because it returns labelled
   * numeric fields, avoiding the need to parse a localized string.
   *
   * @param {Date} instant
   * @returns {{dayOfWeek: number, minuteOfDay: number}}
   */
  _localFields(instant) {
    const parts = this._formatter.formatToParts(instant);
    let weekday = null;
    let hour = null;
    let minute = null;
    for (const p of parts) {
      if (p.type === 'weekday') weekday = p.value;
      else if (p.type === 'hour') hour = p.value;
      else if (p.type === 'minute') minute = p.value;
    }
    if (weekday === null || hour === null || minute === null) {
      // Should be unreachable for any valid IANA tz, but we guard so callers
      // get a clear error rather than silent NaN propagation.
      throw new Error(`Could not extract fields for ${instant.toISOString()} in ${this._timeZone}`);
    }
    // `hour12: false` still yields "24" for midnight in some engine/locale combos
    // (historically ICU). Normalizing to 0 keeps arithmetic honest.
    const hourNum = hour === '24' ? 0 : Number(hour);
    const minuteNum = Number(minute);
    const dayOfWeek = WEEKDAY_MAP[weekday];
    if (dayOfWeek === undefined) {
      throw new Error(`Unexpected weekday token "${weekday}" from formatter`);
    }
    return { dayOfWeek, minuteOfDay: hourNum * 60 + minuteNum };
  }

  /**
   * Returns true if the given instant is inside any configured availability
   * window. Start-inclusive, end-exclusive.
   *
   * @param {Date} instant  The UTC instant to test.
   * @returns {boolean}
   */
  isAvailable(instant) {
    if (!(instant instanceof Date) || isNaN(instant.getTime())) {
      throw new TypeError('instant must be a valid Date');
    }
    const { dayOfWeek, minuteOfDay } = this._localFields(instant);
    for (const w of this._windows) {
      if (w.dayOfWeek === dayOfWeek && minuteOfDay >= w._startMin && minuteOfDay < w._endMin) {
        return true;
      }
    }
    return false;
  }

  /**
   * Convenience wrapper returning a descriptive status string. Useful for
   * logs and tests that want to assert on the reason rather than a bare boolean.
   * @param {Date} instant
   * @returns {'available' | 'unavailable'}
   */
  check(instant) {
    return this.isAvailable(instant) ? 'available' : 'unavailable';
  }
}

const WEEKDAY_MAP = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};
