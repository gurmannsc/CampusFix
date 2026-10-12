# Deviations from the submitted design

Record here any place where the code differs from the report, with a one-line reason.
Keep this short; examiners may ask about it.

| Date | Area | Design says | Code does | Reason |
|---|---|---|---|---|
| 2026-10-12 | Seed accounts / login | Demo script lists logins as `student1`, `supervisor1`, ... | Login is by email: `student1@nmims.edu` etc. (password `demo123`) | `User.login(email, password)` and the `email` attribute in the class diagram. |
| 2026-10-12 | Seed accounts | Demo script lists electrician1, plumber1, carpenter1 as staff | Also seeds hvac1, hvac2, hvac3 (unavailable), itsupport1, civil1, housekeeper1 | Demo step 1 is an HVAC complaint and step 2 needs eligible HVAC staff plus one unavailable. |
| 2026-10-12 | Complaint / user operation signatures | `assignTo(assigneeId)`, `markResolved(remarks)`, `confirm(rating, comment)`, `reopen(reason)`, `escalate()`, `autoClose()`; user operations take `complaintId` | Same names, plus a trailing `{ actor, now }` context (the state machine checks who acts). `assignTo` takes the staff user, not an id. User operations accept a `Complaint` or an id. | The guard on row 3 needs the staff member's trade and availability; the machine needs the actor. |
| 2026-10-12 | Extra helpers on Complaint | Complaint lists 8 operations | Adds `Complaint.create`, `applyEvent`, `reprioritise`, `takeOutbox`; `handleEscalation(complaint, action)` takes a complaint (or an escalation id via the repository) plus `{action, ...}` | No diagram operation exists for startWork, partsNeeded, markInvalid, resolveEscalation or priority change; `updateStatus` stays the single status setter. |
| 2026-10-12 | Row 10 (rejectFix) | Sets Feedback, reopenCount + 1, notifies supervisor | Also sets `dueAt = now + resolutionHours` and `escalationLevel = 0` | A reopened complaint would otherwise be past due and escalate at the next timer tick (agreed at kickoff). |
| 2026-10-12 | Row 14 (resolveEscalation) | `reassign(staffId)` or `extend(newDueAt, reason)`, both to ASSIGNED | `reassign` applies the row 3 trade/availability guard and sets a fresh `dueAt`; both reset `escalationLevel` to 0; `extend` is refused (409) when no assignee exists; the Administrator acts for SERVICE complaints | An unassigned complaint cannot become ASSIGNED via extend; without the reset the complaint re-escalates immediately (agreed at kickoff). |
| 2026-10-12 | Wrong person acting | "Anything else returns HTTP 409" | Wrong status or failed state guard: 409. Wrong actor (not the reporter or assignee, wrong role): 403. Missing or malformed input: 400. | 403 is the standard answer for "not allowed to do this"; one line in `complaintStateMachine.js` to change if you prefer 409. |
| 2026-10-12 | SERVICE complaints | Rows 10, 12, 13 say "notify supervisor" | Notify all Administrators instead | SERVICE complaints have no supervisor (US-11). |
