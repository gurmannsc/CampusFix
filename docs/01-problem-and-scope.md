# Problem and scope

## Problem
Complaints at NMIMS Indore are reported through a mix of channels (verbally to wardens, caretakers or
admin staff, by phone, WhatsApp or email) and nothing is recorded centrally. Result: no record, no
visibility for the reporter, no prioritisation, closure without confirmation, and no data on
resolution time, workload or service quality.

## Roles
| Role (User subclass) | Can do |
|---|---|
| Student, Faculty (both are CampusUser) | Raise complaint, track status, confirm or reject a fix with rating |
| MaintenanceStaff | View assigned complaints, start work, put on hold, resume, mark resolved |
| MaintenanceSupervisor | Review new complaints, set priority, assign staff, mark invalid, handle escalations |
| Administrator | Manage categories, locations, users, deadline rules; handle SERVICE complaints; view dashboard |
| Timer (non-human actor) | Runs the deadline check: escalation and 48-hour auto-close |

## Categories
- INFRASTRUCTURE: Electrical, Plumbing, Furniture, HVAC, IT and AV, Civil, Housekeeping
- SERVICE: Mess and Canteen. Routed to the Administrator, not to maintenance staff.

## Priority deadlines (DeadlineRule seed values, editable by Administrator)
| Priority | resolutionHours | escalationIntervalHours | Example |
|---|---|---|---|
| CRITICAL | 4 | 24 | Sparking switchboard, water near wiring |
| HIGH | 24 | 24 | Classroom AC down, no water supply |
| MEDIUM | 48 | 24 | Hostel room fan not working |
| LOW | 120 | 24 | Broken chair, peeling paint |

## Other fixed rules
- Due date = createdAt + resolutionHours of the complaint's priority. If the supervisor changes the
  priority, recalculate from createdAt.
- Reporter has 48 hours to confirm or reject a RESOLVED complaint; after that it auto-closes.
- Deadline check runs every 15 minutes (configurable in .env).
- Escalation level 1 notifies the supervisor. Level 2 and above notify supervisor AND Administrator.
- Rating on confirm: integer 1 to 5, required. Reason required on reject, mark invalid and on hold.
- Photo: optional, JPG or PNG, max 5 MB.

## In scope for the code demo
Registration with category/location/description/photo, priority and due dates, assignment, staff
status updates, confirm/reject with reopen, automatic escalation and auto-close, in-app
notifications, role-based portals, admin dashboard metrics.

## Out of scope (future enhancements in the report)
Spare parts inventory, vendor billing, native mobile app, SMS/WhatsApp, college SSO, QR codes on
assets, duplicate merging, repeat-fault detection.
