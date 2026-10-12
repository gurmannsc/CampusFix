import { User } from './User.js';
import { Role } from './enums.js';

export class MaintenanceSupervisor extends User {
  get role() {
    return Role.SUPERVISOR;
  }

  // US-05: dueAt is recalculated for the new priority. Pass the DeadlineRule of the new priority,
  // or let deps.deadlineRuleRepository look it up.
  async setPriority(complaintRef, priority, deadlineRule) {
    const ref = await this.loadComplaint(complaintRef);
    const rule = deadlineRule ?? (await this.collaborator('deadlineRuleRepository').findByPriority(priority));
    ref.complaint.reprioritise(priority, rule);
    await this.saveIfLoaded(ref);
  }

  // `staff` is the MaintenanceStaff (or an id, loaded through deps.userRepository).
  async assignComplaint(complaintRef, staff, now) {
    const ref = await this.loadComplaint(complaintRef);
    const assignee = typeof staff === 'object' ? staff : await this.collaborator('userRepository').findById(staff);
    ref.complaint.assignTo(assignee, this.ctx(now));
    await this.saveIfLoaded(ref);
  }

  async markInvalid(complaintRef, reason, now) {
    const ref = await this.loadComplaint(complaintRef);
    ref.complaint.applyEvent('markInvalid', { reason }, this.ctx(now));
    await this.saveIfLoaded(ref);
  }

  // Row 14. action = { action: 'reassign', staff } or { action: 'extend', newDueAt, reason }.
  // The diagram passes an escalationId; an Escalation belongs to one Complaint, so we take the
  // complaint (or look it up from the escalation id through the repository).
  async handleEscalation(escalationOrComplaintRef, action, now) {
    const ref = typeof escalationOrComplaintRef === 'number' && this.deps.complaintRepository?.findByEscalationId
      ? { complaint: await this.deps.complaintRepository.findByEscalationId(escalationOrComplaintRef), loaded: true }
      : await this.loadComplaint(escalationOrComplaintRef);
    ref.complaint.applyEvent('resolveEscalation', action, this.ctx(now));
    await this.saveIfLoaded(ref);
  }
}
