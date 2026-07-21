# Chat follow-up suggestions — TDD evidence

## Source and journeys

The journeys were derived from the requested chat interaction; no external plan file was used.

- As a student, I can see a few relevant next-question chips above the composer after an answer.
- As a student, selecting a chip fills the composer without sending anything automatically.
- As a student, I never see the internal suggestion protocol mixed into the streamed answer.
- As a returning student, I can see suggestions restored with the saved assistant message.

## RED → GREEN evidence

- RED: `npm.cmd test -- tests/chat-followup-suggestions.test.ts` failed because
  `@/lib/chat/assistant-response-parser` did not exist.
- GREEN: `npm.cmd test -- tests/chat-followup-suggestions.test.ts tests/chat-suggestions.test.ts tests/chat-detail.route.test.ts tests/messages.route.test.ts` passed 21/21 tests.
- Types: `npx.cmd tsc --noEmit` passed.
- Lint: focused `next lint --file ...` passed with no warnings or errors.

## Guarantees

| # | Guarantee | Test | Type | Result |
|---|---|---|---|---|
| 1 | A marker split across stream chunks is removed without flashing in visible text | `chat-followup-suggestions.test.ts` | Unit | PASS |
| 2 | Answers without suggestions stream unchanged | `chat-followup-suggestions.test.ts` | Unit | PASS |
| 3 | Suggestions are validated, deduplicated and capped at three | `chat-followup-suggestions.test.ts` | Unit | PASS |
| 4 | The final SSE event returns the persisted message id and structured suggestions | `chat-followup-suggestions.test.ts` | Integration | PASS |
| 5 | Suggested prompts appear above the composer and fill its controlled draft | `chat-followup-suggestions.test.ts` | UI contract | PASS |
| 6 | Existing hero suggestions still require user confirmation | `chat-suggestions.test.ts` | UI contract | PASS |

## Coverage and known gaps

The repository does not include a Vitest coverage provider, so no numeric coverage report was generated. The focused parser tests cover marker/no-marker, malformed and duplicate input, the three-item boundary, and client SSE extraction.

The complete suite reached 425 passing tests and 2 pre-existing failures in `ui-compliance.test.ts`; both concern the unrelated Agenda panel (`Badge`/`Button` imports and the removed “Próximos 5 días” text). No files involved in those failures were changed by this task.

The database migration was intentionally not applied to a live environment. Run `npm run db:migrate` in the target environment before deploying.
