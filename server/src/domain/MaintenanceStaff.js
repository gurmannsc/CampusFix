import { User } from './User.js';
import { ComplaintStatus as S, Role } from './enums.js';
import { IllegalTransitionError } from './errors.js';

export class MaintenanceStaff extends User {
  constructor({ trade = null, isAvailable = true, ...rest }, deps) {
    super(rest, deps);
    this.trade = trade;
    this.isAvailable = isAvailable;
  }

  get role() {
    return Role.STAFF;
  }

  viewAssignedComplaints() {
    return this.collaborator('complaintRepository').findAssignedTo(this.userId);
  }

  // US-07: staff may set IN_PROGRESS, ON_HOLD (reason required) or RESOLVED (remarks required).
  // `details` is { reason } for ON_HOLD and { remarks } for RESOLVED. The state machine decides
  // which event that means from the complaint's current status:
  //   ASSIGNED -> IN_PROGRESS = startWork (row 5)     IN_PROGRESS -> ON_HOLD = partsNeeded (row 6)
  //   ON_HOLD -> IN_PROGRESS  = partsReceived (row 7) IN_PROGRESS -> RESOLVED = markResolved (row 8)
  async updateWorkStatus(complaintRef, status, details = {}, now) {
    const ref = await this.loadComplaint(complaintRef);
    const { complaint } = ref;
    if (status === S.IN_PROGRESS) {
      complaint.applyEvent(complaint.status === S.ON_HOLD ? 'partsReceived' : 'startWork', {}, this.ctx(now));
    } else if (status === S.ON_HOLD) {
      complaint.applyEvent('partsNeeded', { reason: details.reason }, this.ctx(now));
    } else if (status === S.RESOLVED) {
      complaint.applyEvent('markResolved', { remarks: details.remarks }, this.ctx(now));
    } else {
      throw new IllegalTransitionError(`Staff cannot set a complaint to ${status}`);
    }
    await this.saveIfLoaded(ref);
  }

  async markResolved(complaintRef, remarks, now) {
    const ref = await this.loadComplaint(complaintRef);
    ref.complaint.markResolved(remarks, this.ctx(now));
    await this.saveIfLoaded(ref);
  }
}
