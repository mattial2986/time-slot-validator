# Time Slot Validator

Checks whether a given UTC instant falls within a set of recurring weekly availability windows defined in a specific timezone.

```js
import { TimeSlotValidator } from 'time-slot-validator';

const v = new TimeSlotValidator(
  [{ dayOfWeek: 1, startHour: 9, startMinute: 0, endHour: 17, endMinute: 0 }],
  'America/New_York'
);

v.isAvailable(new Date('2024-01-01T14:00:00.000Z')); // true
v.check(new Date('2024-01-01T22:00:00.000Z'));        // 'unavailable'
```

## Why this exists

Scheduling systems often store business hours as repeating weekly windows in a local timezone. The question "is this UTC instant within those hours?" looks trivial but forces a timezone conversion, and timezone conversion is where DST, historical offset changes, and midnight-boundary ambiguity live.

This library takes one specific position to stay correct and small:

- **Wall-clock comparison only.** We convert the UTC instant to local fields (weekday, hour, minute) via `Intl.DateTimeFormat`, then compare those fields directly against the window. We never reconstruct a `Date` from local fields, which would immediately hit the "which of the two 01:30s is this?" ambiguity during a DST fall-back.
- **No cross-midnight windows.** A window must end strictly after it starts on the same calendar day. This makes the inclusivity rule (start-inclusive, end-exclusive) unambiguous and keeps the implementation honest. If you need overnight coverage, model it as two windows.
- **No third-party tz database.** We rely on the host's `Intl` implementation, which ships its own tz data. This means the library is zero-dependency but is only as accurate as the runtime's tz tables — acceptable for most scheduling contexts where the host is kept current.

## The awkward edge

DST transitions can shift wall-clock time forward (spring) or backward (fall). Because we compare fields rather than reconstructing instants, a window like 09:00–17:00 behaves correctly on transition days: the instant simply maps to whatever local fields the transition produces, and the comparison proceeds. The cost is that during a fall-back, an instant may appear "available" for the local 01:00–02:00 hour twice (once in EDT, once in EST). This is intentional — the window is defined in wall-clock terms, and both occurrences of 01:30 are legitimately 01:30. If you need to distinguish them, you need a different model.

Run the tests with:

```
node --test
```

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

## Performance

The window keeps a bounded buffer, so `push` is constant time and memory does not
grow with the length of the stream. `peak` and `trough` are linear in the window
size, which is the trade that keeps `push` cheap.

