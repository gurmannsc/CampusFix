# Complaint state machine (AUTHORITATIVE; mirrors Figure 9 of the report)

Implement this as one module (e.g. server/src/domain/complaintStateMachine.js) that every route uses.
Each row is the only legal way to reach the target status. Anything else returns HTTP 409.
Every status change inserts one StatusUpdate (fromStatus, toStatus, remarks, updatedBy, updatedAt).

"Open" in the diagram is a composite state = {SUBMITTED, ASSIGNED, IN_PROGRESS, ON_HOLD, REOPENED}.

| # | From | Event (who) | Guard | To | Actions |
|---|---|---|---|---|---|
| 1 | (initial) | raiseComplaint (CampusUser) | valid details | SUBMITTED | priority = category.defaultPriority; dueAt = DeadlineRule.calculateDueAt(createdAt); notify supervisors, or Administrators if category.type = SERVICE |
| 2 | SUBMITTED | markInvalid(reason) (Supervisor) | invalid or duplicate | INVALID (final) | notify reporter |
| 3 | SUBMITTED | assign(staff) (Supervisor; Admin for SERVICE) | staff.trade = category.name and staff.isAvailable (INFRASTRUCTURE) | ASSIGNED | set assigneeId, supervisorId; notify assignee and reporter |
| 4 | REOPENED | assign(staff) | same as 3 | ASSIGNED | notify assignee |
| 5 | ASSIGNED | startWork() (assignee) | caller is assignee | IN_PROGRESS | |
| 6 | IN_PROGRESS | partsNeeded(reason) (assignee) | reason given | ON_HOLD | |
| 7 | ON_HOLD | partsReceived() (assignee) | | IN_PROGRESS | |
| 8 | IN_PROGRESS | markResolved(remarks) (assignee) | remarks given | RESOLVED | resolvedAt = now; notify reporter to confirm |
| 9 | RESOLVED | confirm(rating, comment) (reporter) | 1 <= rating <= 5 | CLOSED (final) | Feedback(isFixed = true); closedAt = now |
| 10 | RESOLVED | rejectFix(reason) (reporter) | reason given | REOPENED | Feedback(isFixed = false); reopenCount += 1; notify supervisor |
| 11 | RESOLVED | after(48 hours) (Timer) | no response since resolvedAt | CLOSED | autoClose(); closedAt = now |
| 12 | any Open state | when(now > dueAt) (Timer) | | ESCALATED | escalationLevel = 1; save Escalation; notify supervisor |
| 13 | ESCALATED | after(escalationIntervalHours) (Timer) | still ESCALATED | ESCALATED (self) | escalationLevel += 1; save Escalation; notify supervisor and Administrator (level >= 2). No StatusUpdate row (status unchanged). |
| 14 | ESCALATED | resolveEscalation(action) (Supervisor) | action = reassign(staffId) or extend(newDueAt, reason) | ASSIGNED | update assigneeId or dueAt; notify assignee |

Tests: one test per row (happy path) plus tests proving illegal transitions are rejected, for example
CLOSED -> REOPENED, SUBMITTED -> RESOLVED, a non-reporter confirming, staff starting work on a
complaint not assigned to them.
