# Sequence diagrams as code flows (Figures 6 to 8 of the report)

Object roles follow the report: one boundary object per actor/use case, one controller per use case,
entity objects from the class diagram, plus NotificationService. Keep these names in code:
ComplaintForm (React), ComplaintDetailsPage (React), ComplaintController, ResolutionController,
EscalationScheduler, ComplaintList (repository with findOverdue), NotificationService.

## sd Raise Complaint
reporter -> ComplaintForm.submit(categoryId, locationId, description, photo)
ComplaintForm -> ComplaintController.raiseComplaint(details)
ComplaintController -> validate(details)
  alt [details invalid] -> return validationErrors (HTTP 400) -> form shows errors
  alt [details valid]:
    Category.getDefaultPriority() -> priority
    DeadlineRule.calculateDueAt(now) -> dueAt
    <<create>> Complaint(details, priority, dueAt) -> complaintId
    NotificationService.send(supervisorId, "New complaint")
    return complaintId -> form shows complaintId

## sd Confirm Resolution
reporter -> ComplaintDetailsPage.respond(complaintId, isFixed, rating, comment)
page -> ResolutionController.submitResponse(complaintId, isFixed, rating, comment)
ResolutionController -> <<create>> Feedback(isFixed, rating, comment)
  alt [isFixed = true]  Complaint.confirm(rating, comment) -> updateStatus(CLOSED)
  alt [isFixed = false] Complaint.reopen(comment) -> updateStatus(REOPENED);
                        NotificationService.send(supervisorId, "Complaint reopened")
return updated status to the page

## sd Escalate Overdue Complaint
Timer (node-cron) -> EscalationScheduler.checkDeadlines(now)
EscalationScheduler -> ComplaintList.findOverdue(now) -> overdueComplaints
loop [for each c in overdueComplaints]
  Complaint.escalate() -> <<create>> Escalation(level, reason) -> e
  Escalation.notifyResponsible():
    NotificationService.send(supervisorId, "Complaint overdue")
    opt [level >= 2] NotificationService.send(adminId, "Complaint overdue")
The same checkDeadlines run also performs transition 11 (48-hour auto-close) from the state machine.
