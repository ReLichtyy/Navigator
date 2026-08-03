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
| A course is persisted before an immediate page change can occur | `tests/last-course-selection.test.ts` | Regression/unit | PASS |
| A stale `?course=` link is replaced by the latest manual selection before reload | `tests/last-course-selection.test.ts` | Regression/unit | PASS |
| Selecting `Sin curso` removes only the course parameter | `tests/last-course-selection.test.ts` | Unit | PASS |
| Study and Mind Map both use the shared preference | `tests/last-course-selection.test.ts` | Integration/source wiring | PASS |

Initial RED: `npm.cmd test -- --run tests/last-course-selection.test.ts` failed because
`@/lib/ui/last-course-selection` did not exist. Navigation regression RED: the same command failed
because `selectAndPersistCourse` did not exist, proving that selection was not synchronously saved.

GREEN: the same command passed 7/7 tests after the navigation-race fix.

Reload regression RED: the targeted command failed 3 tests because the saved course and the stale
URL were not synchronized. GREEN: it passed 9/9 after both selectors started replacing the
`course` query parameter with the current selection.

Additional verification:

- `npx.cmd tsc --noEmit` passed.
- `npm.cmd run lint` passed with no warnings or errors.
- `npm.cmd run build` completed successfully.

## Coverage and known gaps

The targeted unit and wiring tests cover the selection priorities, synchronous persistence,
invalid saved courses, and unavailable storage. The local browser journey reached the auth gate,
so no signed-in E2E assertion was possible; production build validation covers the client
integration at compile time.
