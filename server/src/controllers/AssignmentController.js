// AssignmentController: what the supervisor does with a new complaint (and the administrator for
// SERVICE complaints): set priority, see eligible staff, assign, mark invalid.
// The rules themselves (who may assign whom, which statuses allow it) live in the state machine;
// this controller loads the data, calls the domain operation and returns the result.
import {
  DomainError, ForbiddenActionError, Priority, Role, CategoryType, ValidationError,
} from '../domain/index.js';
import { complaintRepository } from '../repositories/complaintRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { deadlineRuleRepository } from '../repositories/referenceRepository.js';
import { updateComplaint } from '../services/complaintWorkflow.js';
import { parseId } from './helpers.js';

// "Supervisor; Admin for SERVICE": INFRASTRUCTURE complaints are handled by supervisors, SERVICE
// complaints by administrators.
function assertHandler(user, complaint) {
  const expected = complaint.category.type === CategoryType.SERVICE ? Role.ADMIN : Role.SUPERVISOR;
  if (user.role !== expected) {
    throw new ForbiddenActionError(`Only a ${expected === Role.ADMIN ? 'administrator' : 'supervisor'} can handle this complaint`);
  }
}

export const AssignmentController = {
  // PATCH /api/complaints/:id/priority   {priority}   US-05: dueAt is recalculated from createdAt
  async setPriority(req, res) {
    const id = parseId(req.params.id);
    const { priority } = req.body ?? {};
    if (!Object.values(Priority).includes(priority)) {
      throw new ValidationError(`priority must be one of ${Object.values(Priority).join(', ')}`);
    }
    const rule = await deadlineRuleRepository.findByPriority(priority);
    await updateComplaint(id, (complaint) => {
      assertHandler(req.user, complaint);
      complaint.reprioritise(priority, rule);
    });
    res.json({ complaint: await complaintRepository.findDetails(id) });
  },

  // GET /api/complaints/:id/eligible-staff   US-06: trade = category name and available
  async eligibleStaff(req, res) {
    const id = parseId(req.params.id);
    const complaint = await complaintRepository.findById(id);
    if (!complaint) throw new DomainError(`Complaint ${id} not found`, 404);
    assertHandler(req.user, complaint);
    res.json({ staff: await userRepository.findEligibleAssignees(complaint.category) });
  },

  // POST /api/complaints/:id/assign   {staffId}   rows 3 and 4 of the state machine
  // For a SERVICE complaint the administrator may leave staffId out to take it themselves (US-11).
  async assign(req, res) {
    const id = parseId(req.params.id);
    const { staffId } = req.body ?? {};
    await updateComplaint(id, async (complaint) => {
      let assignee;
      if (staffId == null && req.user.role === Role.ADMIN) {
        assignee = req.user;
      } else {
        const staffUserId = Number(staffId);
        if (staffId == null || !Number.isInteger(staffUserId) || staffUserId <= 0) throw new ValidationError('staffId is required');
        assignee = await userRepository.findById(staffUserId);
        if (!assignee) throw new DomainError('Staff member not found', 404);
      }
      // Throws 409 (wrong status, wrong trade, unavailable, SERVICE to staff) or 403 (wrong person).
      complaint.assignTo(assignee, req.user.ctx());
    });
    res.json({ complaint: await complaintRepository.findDetails(id) });
  },

  // POST /api/complaints/:id/invalid   {reason}   row 2
  async markInvalid(req, res) {
    const id = parseId(req.params.id);
    await updateComplaint(id, (complaint) => {
      complaint.applyEvent('markInvalid', { reason: req.body?.reason }, req.user.ctx());
    });
    res.json({ complaint: await complaintRepository.findDetails(id) });
  },
};
