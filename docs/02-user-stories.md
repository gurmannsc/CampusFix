# User stories (each acceptance criterion should have at least one test)

| ID | Story | Acceptance criteria |
|---|---|---|
| US-01 | As a hostel student, I want to report a broken fan by choosing the category and my exact room, so that the right staff member knows what to fix and where. | Submission fails without category and location. A complaint ID is returned and shown. |
| US-02 | As a student, I want to attach a photo, so that staff can see the problem before they arrive. | JPG/PNG up to 5 MB accepted, others rejected. Photo visible to supervisor and assignee. |
| US-03 | As a campus user, I want to see my complaint's status, so that I do not have to follow up in person. | Full status history with timestamps visible to the reporter. |
| US-04 | As a faculty member, I want safety issues handled first, so that dangerous faults are fixed before minor ones. | CRITICAL gets a 4-hour due date and sorts to the top of the supervisor list. |
| US-05 | As a supervisor, I want new complaints sorted by priority and due date, so that I assign urgent ones first. | Supervisor can change priority; dueAt is recalculated. |
| US-06 | As a supervisor, I want to assign to an available staff member with the right trade, so that the work goes to someone who can do it. | Only staff with trade = category name and isAvailable = true are offered. Assignee and reporter notified. |
| US-07 | As maintenance staff, I want to update status, so that everyone knows if work is in progress or waiting for parts. | Can set IN_PROGRESS, ON_HOLD (reason required), RESOLVED (remarks required). |
| US-08 | As a campus user, I want to confirm or reject a fix, so that a complaint is not closed while the problem exists. | Reject needs a reason and reopens. Confirm needs rating 1 to 5 and closes. No response in 48 h auto-closes. |
| US-09 | As a supervisor, I want overdue complaints escalated automatically, so that nothing is forgotten. | When now > dueAt, an Escalation is saved and the supervisor notified; 24 h later the Administrator is also notified. |
| US-10 | As an administrator, I want a dashboard of resolution time, workload, deadline breaches and ratings, so that I can judge service quality. | Filters: category, block, date range. |
| US-11 | As an administrator, I want mess and canteen complaints routed to me, so that food issues reach the vendor. | SERVICE category complaints are assigned to an Administrator, never to MaintenanceStaff. |
