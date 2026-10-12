import { User } from './User.js';

// Abstract: students and faculty. They raise complaints and confirm or reject fixes.
export class CampusUser extends User {
  constructor(fields, deps) {
    super(fields, deps);
    if (new.target === CampusUser) throw new TypeError('CampusUser is abstract');
  }

  // sd Raise Complaint: ComplaintForm -> ComplaintController.raiseComplaint(details)
  raiseComplaint(details) {
    return this.collaborator('complaintController').raiseComplaint(details, this);
  }

  async trackComplaint(complaintId) {
    const { complaint } = await this.loadComplaint(complaintId);
    return complaint.status;
  }

  async confirmResolution(complaintRef, rating, comment = null, now) {
    const ref = await this.loadComplaint(complaintRef);
    ref.complaint.confirm(rating, comment, this.ctx(now));
    await this.saveIfLoaded(ref);
  }

  async rejectResolution(complaintRef, reason, now) {
    const ref = await this.loadComplaint(complaintRef);
    ref.complaint.reopen(reason, this.ctx(now));
    await this.saveIfLoaded(ref);
  }
}
