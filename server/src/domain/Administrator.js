import { User } from './User.js';
import { Role } from './enums.js';

export class Administrator extends User {
  get role() {
    return Role.ADMIN;
  }

  // The three below are database / report operations, done by AdminService and ReportService.
  // manageCategory: creates the category, or updates it when it has a categoryId.
  manageCategory(category) {
    return this.collaborator('adminService').manageCategory(category);
  }

  // `hours` is the DeadlineRule's resolutionHours; escalationIntervalHours is an optional extra.
  configureDeadline(priority, hours, escalationIntervalHours) {
    return this.collaborator('adminService').configureDeadline(priority, hours, escalationIntervalHours);
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
