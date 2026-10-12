# Domain model (mirrors the class diagram, Figure 5 of the report)

## Classes
Visibility in the diagram: attributes private (-), operations public (+). Keep these names.

### User (abstract)
userId : int, name : String, email : String, phone : String, passwordHash : String
+ login(email, password) : boolean   + logout() : void   + viewNotifications() : Notification[0..*]

### CampusUser (abstract, extends User)
+ raiseComplaint(details) : Complaint   + trackComplaint(complaintId) : ComplaintStatus
+ confirmResolution(complaintId, rating) : void   + rejectResolution(complaintId, reason) : void

### Student (extends CampusUser): sapId, program, hostelRoom
### Faculty (extends CampusUser): employeeId, department
### MaintenanceStaff (extends User): trade : String, isAvailable : boolean
+ viewAssignedComplaints() : Complaint[0..*]   + updateWorkStatus(complaintId, status) : void
+ markResolved(complaintId, remarks) : void
### MaintenanceSupervisor (extends User)
+ setPriority(complaintId, priority)  + assignComplaint(complaintId, staffId)
+ markInvalid(complaintId, reason)   + handleEscalation(escalationId)
### Administrator (extends User)
+ manageCategory(category)  + configureDeadline(priority, hours)
+ handleServiceComplaint(complaintId)  + viewDashboard() : void

### Complaint
complaintId, title, description, photoPath, priority : Priority, status : ComplaintStatus,
createdAt, dueAt, resolvedAt, closedAt : DateTime, escalationLevel : int, reopenCount : int
+ assignTo(assigneeId)  + updateStatus(newStatus)  + markResolved(remarks)
+ confirm(rating, comment)  + reopen(reason)  + escalate() : Escalation  + autoClose()
+ isOverdue(now) : boolean

### Category: categoryId, name, type : CategoryType, defaultPriority : Priority; + getDefaultPriority() : Priority
### Location: locationId, block, floor : int, room, areaType : AreaType
### DeadlineRule: priority : Priority, resolutionHours : int, escalationIntervalHours : int; + calculateDueAt(start) : DateTime
### StatusUpdate: updateId, fromStatus, toStatus : ComplaintStatus, remarks, updatedAt
### Feedback: feedbackId, isFixed : boolean, rating : int, comment, givenAt
### Escalation: escalationId, level : int, reason, escalatedAt; + notifyResponsible() : void
### Notification: notificationId, message, isRead : boolean, sentAt; + markRead() : void

## Enumerations
- ComplaintStatus: SUBMITTED, INVALID, ASSIGNED, IN_PROGRESS, ON_HOLD, RESOLVED, REOPENED, ESCALATED, CLOSED
- Priority: CRITICAL, HIGH, MEDIUM, LOW
- CategoryType: INFRASTRUCTURE, SERVICE
- AreaType: HOSTEL, CLASSROOM, LAB, MESS, WASHROOM, COMMON_AREA

## Relationships (multiplicities from the diagram)
- User 1 -- 0..* Notification (receives)
- CampusUser 1 -- 0..* Complaint (raises)
- MaintenanceSupervisor 0..1 -- 0..* Complaint (reviews)
- MaintenanceStaff 0..1 -- 0..* Complaint (works on)
- Administrator 0..1 -- 0..* Complaint (handles; SERVICE complaints)
- Complaint 0..* -- 1 Category (belongs to); 0..* -- 1 Location (reported at); 0..* -- 1 DeadlineRule (governed by)
- Complaint 1 composition 1..* StatusUpdate; 0..* Feedback; 0..* Escalation (deleted with the complaint)

## MySQL mapping (agreed simplifications; record any further change in DEVIATIONS.md)
- User hierarchy: single table `users` with `role` ENUM('STUDENT','FACULTY','STAFF','SUPERVISOR','ADMIN')
  and nullable subclass columns (sap_id, program, hostel_room, employee_id, department, trade, is_available).
  In code, keep JS classes Student, Faculty, MaintenanceStaff, MaintenanceSupervisor, Administrator.
- `complaints`: reporter_id FK users, category_id, location_id, priority (FK to deadline_rules.priority),
  supervisor_id NULL, assignee_id NULL (a STAFF user, or an ADMIN user for SERVICE complaints), plus all attributes.
- `status_updates`, `feedback`, `escalations`: complaint_id FK ON DELETE CASCADE (composition).
  status_updates also stores updated_by (user id).
- `notifications`: user_id FK, complaint_id NULL, message, is_read, sent_at.
- `categories`, `locations`, `deadline_rules` (priority is the primary key).
