# Last course selection: TDD evidence

## Source and journey

Journey derived from the request: when a student returns to Study or Mind Map, the last valid
course they used is restored instead of defaulting to `Sin curso`.

## Evidence

| Guarantee | Test or command | Type | Result |
|---|---|---|---|
| A valid deep link takes priority over the saved course | `tests/last-course-selection.test.ts` | Unit | PASS |
| The last valid course is restored | `tests/last-course-selection.test.ts` | Unit | PASS |
| A deleted saved course falls back to the first available folder | `tests/last-course-selection.test.ts` | Unit | PASS |
| Browser storage failures remain non-fatal | `tests/last-course-selection.test.ts` | Unit | PASS |
| Study and Mind Map both use the shared preference | `tests/last-course-selection.test.ts` | Integration/source wiring | PASS |

RED: `npm.cmd test -- --run tests/last-course-selection.test.ts` failed because
`@/lib/ui/last-course-selection` did not exist.

GREEN: the same command passed 6/6 tests after implementation.

Additional verification:

- `npx.cmd tsc --noEmit` passed.
- `npm.cmd run lint` passed with no warnings or errors.
- `npm.cmd run build` completed successfully.

## Coverage and known gaps

The targeted unit and wiring tests cover the selection priorities, persistence, invalid saved
courses, and unavailable storage. No browser E2E test was added; production build validation covers
the client integration at compile time.
