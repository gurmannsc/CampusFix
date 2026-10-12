# Demo script (target 6 to 8 minutes; rehearse with seeded data)

Seed accounts (password demo123): student1 (hostel), faculty1, electrician1, plumber1, carpenter1,
supervisor1, admin1. Seed also contains: one complaint already overdue (for escalation), one
ESCALATED complaint whose last escalation was 25 hours ago (for level 2), one RESOLVED complaint
resolved 49 hours ago (for auto-close), and about 30 closed historical complaints so the dashboard
has real numbers. Provide `npm run reset-demo` to restore this state between rehearsals.

1. student1 raises "Ceiling fan not working", HVAC, Hostel Block A, floor 2, room 204, with a photo.
   Show the complaint ID, status SUBMITTED and the MEDIUM 48-hour due date.         (US-01, 02)
2. supervisor1 sees the list sorted by priority and due date, raises it to HIGH (due date updates),
   opens eligible staff (only HVAC trade, available), assigns.                         (US-04, 05, 06)
3. Staff logs in: Start work, Put on hold "waiting for capacitor", Resume, Mark resolved with remarks. (US-07)
4. student1 rejects the fix with a reason: status REOPENED, supervisor gets a notification.
   Supervisor reassigns, staff resolves again, student confirms with rating 4: CLOSED.   (US-08, 03)
5. admin1 clicks "Run deadline check": the overdue complaint becomes ESCALATED (supervisor notified),
   the 25-hour escalated one goes to level 2 (admin notified), the 49-hour resolved one auto-closes. (US-09)
6. faculty1 reports "Food quality in mess" (SERVICE): it goes to admin1, not to staff.  (US-11)
7. Admin dashboard with filters: resolution time, workload, breaches, ratings.       (US-10)
8. Briefly show complaintStateMachine.js next to the state diagram, and a rejected illegal transition.
