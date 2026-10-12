// One row per Complaint.status change (the complaint's timeline). updatedBy is null for the Timer.
export class StatusUpdate {
  constructor({ updateId = null, complaintId = null, fromStatus = null, toStatus, remarks = null, updatedBy = null, updatedAt }) {
    this.updateId = updateId;
    this.complaintId = complaintId;
    this.fromStatus = fromStatus; // null only for the initial SUBMITTED entry
    this.toStatus = toStatus;
    this.remarks = remarks;
    this.updatedBy = updatedBy;
    this.updatedAt = updatedAt;
  }
}
