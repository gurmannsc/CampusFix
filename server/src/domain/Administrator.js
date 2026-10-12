import { User } from './User.js';
import { Role } from './enums.js';

export class Administrator extends User {
  get role() {
    return Role.ADMIN;
  }

  // The three below are database / report operations, done by AdminController and ReportService.
  manageCategory(category) {
    return this.collaborator('adminController').manageCategory(category);
  }

  configureDeadline(priority, hours) {
    return this.collaborator('adminController').configureDeadline(priority, hours);
  }

  viewDashboard(filters) {
    return this.collaborator('reportService').dashboard(filters);
  }

  // US-11: SERVICE complaints are assigned to an Administrator (here: to this one), never to staff.
  async handleServiceComplaint(complaintRef, now) {
    const ref = await this.loadComplaint(complaintRef);
    ref.complaint.assignTo(this, this.ctx(now));
    await this.saveIfLoaded(ref);
  }
}
