import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TimeSlotValidator } from '../src/index.js';

// All instants are fixed UTC values. No wall-clock dependence, ever.
const iso = (s) => new Date(s);

describe('TimeSlotValidator — construction', () => {
  test('rejects empty windows array', () => {
    assert.throws(() => new TimeSlotValidator([], 'America/New_York'), /non-empty/);
  });

  test('rejects non-string timezone', () => {
    assert.throws(
      () => new TimeSlotValidator([{ dayOfWeek: 1, startHour: 9, startMinute: 0, endHour: 17, endMinute: 0 }], 123),
      /timeZone/
    );
  });

  test('rejects cross-midnight window', () => {
    assert.throws(
      () => new TimeSlotValidator([{ dayOfWeek: 1, startHour: 22, startMinute: 0, endHour: 2, endMinute: 0 }], 'UTC'),
      /strictly after/
    );
  });

  test('rejects end equal to start', () => {
    assert.throws(
      () => new TimeSlotValidator([{ dayOfWeek: 1, startHour: 9, startMinute: 30, endHour: 9, endMinute: 30 }], 'UTC'),
      /strictly after/
    );
  });

  test('rejects out-of-range dayOfWeek', () => {
    assert.throws(
      () => new TimeSlotValidator([{ dayOfWeek: 7, startHour: 9, startMinute: 0, endHour: 17, endMinute: 0 }], 'UTC'),
      /dayOfWeek/
    );
  });

  test('rejects non-integer hour', () => {
    assert.throws(
      () => new TimeSlotValidator([{ dayOfWeek: 1, startHour: 9.5, startMinute: 0, endHour: 17, endMinute: 0 }], 'UTC'),
      /startHour/
    );
  });
});

describe('TimeSlotValidator — UTC (no DST)', () => {
  const v = new TimeSlotValidator(
    [{ dayOfWeek: 1, startHour: 9, startMinute: 0, endHour: 17, endMinute: 0 }],
    'UTC'
  );

  test('inside window', () => {
    // 2024-01-01 is a Monday.
    assert.equal(v.isAvailable(iso('2024-01-01T13:00:00.000Z')), true);
  });

  test('start-inclusive: exactly at open', () => {
    assert.equal(v.isAvailable(iso('2024-01-01T09:00:00.000Z')), true);
  });

  test('end-exclusive: exactly at close', () => {
    assert.equal(v.isAvailable(iso('2024-01-01T17:00:00.000Z')), false);
  });

  test('just before close', () => {
    assert.equal(v.isAvailable(iso('2024-01-01T16:59:00.000Z')), true);
  });

  test('wrong day', () => {
    // Tuesday
    assert.equal(v.isAvailable(iso('2024-01-02T13:00:00.000Z')), false);
  });

  test('before window same day', () => {
    assert.equal(v.isAvailable(iso('2024-01-01T08:59:00.000Z')), false);
  });

  test('after window same day', () => {
    assert.equal(v.isAvailable(iso('2024-01-01T17:01:00.000Z')), false);
  });
});

describe('TimeSlotValidator — timezone offset', () => {
  const v = new TimeSlotValidator(
    [{ dayOfWeek: 1, startHour: 9, startMinute: 0, endHour: 17, endMinute: 0 }],
    'America/New_York'
  );

  test('UTC instant maps to correct NY wall-clock (standard time, -05:00)', () => {
    // 14:00 UTC on Monday 2024-01-01 = 09:00 NY local. Start-inclusive.
    assert.equal(v.isAvailable(iso('2024-01-01T14:00:00.000Z')), true);
  });

  test('five hours before close is still available', () => {
    // 21:59 UTC = 16:59 NY. Inside.
    assert.equal(v.isAvailable(iso('2024-01-01T21:59:00.000Z')), true);
  });

  test('22:00 UTC = 17:00 NY, excluded', () => {
    assert.equal(v.isAvailable(iso('2024-01-01T22:00:00.000Z')), false);
  });

  test('13:59 UTC = 08:59 NY, before open', () => {
    assert.equal(v.isAvailable(iso('2024-01-01T13:59:00.000Z')), false);
  });
});

describe('TimeSlotValidator — midnight normalization', () => {
  test('treats hour 24 token as 0', () => {
    // Some ICU versions emit "24" for midnight with hour12:false. We can't
    // force that here, but we can assert a midnight-UTC instant behaves as
    // hour 0 rather than throwing or returning a wrong result.
    const v = new TimeSlotValidator(
      [{ dayOfWeek: 1, startHour: 0, startMinute: 0, endHour: 0, endMinute: 30 }],
      'UTC'
    );
    assert.equal(v.isAvailable(iso('2024-01-01T00:00:00.000Z')), true);
    assert.equal(v.isAvailable(iso('2024-01-01T00:30:00.000Z')), false);
  });
});

describe('TimeSlotValidator — multiple windows same day', () => {
  const v = new TimeSlotValidator([
    { dayOfWeek: 1, startHour: 9, startMinute: 0, endHour: 12, endMinute: 0 },
    { dayOfWeek: 1, startHour: 13, startMinute: 0, endHour: 17, endMinute: 0 },
  ], 'UTC');

  test('first window', () => {
    assert.equal(v.isAvailable(iso('2024-01-01T11:00:00.000Z')), true);
  });

  test('gap between windows', () => {
    assert.equal(v.isAvailable(iso('2024-01-01T12:30:00.000Z')), false);
  });

  test('second window', () => {
    assert.equal(v.isAvailable(iso('2024-01-01T15:00:00.000Z')), true);
  });
});

describe('TimeSlotValidator — check()', () => {
  const v = new TimeSlotValidator(
    [{ dayOfWeek: 1, startHour: 9, startMinute: 0, endHour: 17, endMinute: 0 }],
    'UTC'
  );

  test('returns available', () => {
    assert.equal(v.check(iso('2024-01-01T10:00:00.000Z')), 'available');
  });

  test('returns unavailable', () => {
    assert.equal(v.check(iso('2024-01-01T20:00:00.000Z')), 'unavailable');
  });
});

describe('TimeSlotValidator — invalid instant', () => {
  const v = new TimeSlotValidator(
    [{ dayOfWeek: 1, startHour: 9, startMinute: 0, endHour: 17, endMinute: 0 }],
    'UTC'
  );

  test('rejects non-Date', () => {
    assert.throws(() => v.isAvailable('2024-01-01T10:00:00.000Z'), /valid Date/);
  });

  test('rejects Invalid Date', () => {
    assert.throws(() => v.isAvailable(new Date('not-a-date')), /valid Date/);
  });
});
