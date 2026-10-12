// Shared test data for the domain tests. No database involved: M2 is pure unit tests.
import { Category, Complaint, ComplaintStatus as S, DeadlineRule } from '../../src/domain/index.js';

export const NOW = new Date('2026-03-10T12:00:00Z');
export const hoursFromNow = (h) => new Date(NOW.getTime() + h * 3600 * 1000);

// docs/01 seed values
export const rules = {
  CRITICAL: new DeadlineRule({ priority: 'CRITICAL', resolutionHours: 4, escalationIntervalHours: 24 }),
  HIGH: new DeadlineRule({ priority: 'HIGH', resolutionHours: 24, escalationIntervalHours: 24 }),
  MEDIUM: new DeadlineRule({ priority: 'MEDIUM', resolutionHours: 48, escalationIntervalHours: 24 }),
  LOW: new DeadlineRule({ priority: 'LOW', resolutionHours: 120, escalationIntervalHours: 24 }),
};

export const hvac = new Category({ categoryId: 4, name: 'HVAC', type: 'INFRASTRUCTURE', defaultPriority: 'MEDIUM' });
export const mess = new Category({ categoryId: 8, name: 'Mess and Canteen', type: 'SERVICE', defaultPriority: 'MEDIUM' });

// Actors / users as the state machine sees them: { userId, role } plus staff fields.
export const student = { userId: 1, role: 'STUDENT', name: 'Aarav' };
export const otherStudent = { userId: 2, role: 'STUDENT', name: 'Riya' };
export const faculty = { userId: 3, role: 'FACULTY', name: 'Dr Joshi' };
export const supervisor = { userId: 10, role: 'SUPERVISOR', name: 'Rajiv' };
export const admin = { userId: 11, role: 'ADMIN', name: 'Anita' };
export const hvacStaff = { userId: 20, role: 'STAFF', name: 'Imran', trade: 'HVAC', isAvailable: true };
export const otherHvacStaff = { userId: 21, role: 'STAFF', name: 'Deepak', trade: 'HVAC', isAvailable: true };
export const busyHvacStaff = { userId: 22, role: 'STAFF', name: 'Vikram', trade: 'HVAC', isAvailable: false };
export const plumber = { userId: 23, role: 'STAFF', name: 'Suresh', trade: 'Plumbing', isAvailable: true };

// A complaint in a given status. Defaults: a MEDIUM HVAC complaint raised 1 hour before NOW by
// `student`, not yet assigned. Overrides can set anything (e.g. { status: 'ASSIGNED', assigneeId: 20 }).
export function makeComplaint(overrides = {}) {
  return new Complaint({
    complaintId: 7,
    title: 'Ceiling fan not working',
    description: 'Fan does not start',
    priority: 'MEDIUM',
    status: S.SUBMITTED,
    createdAt: hoursFromNow(-1),
    dueAt: hoursFromNow(47),
    reporterId: student.userId,
    categoryId: hvac.categoryId,
    locationId: 1,
    category: hvac,
    deadlineRule: rules.MEDIUM,
    ...overrides,
  });
}

// Statuses that need extra fields to be realistic when used as a starting point.
export function complaintIn(status, overrides = {}) {
  const base = {
    SUBMITTED: {},
    ASSIGNED: { assigneeId: hvacStaff.userId, supervisorId: supervisor.userId },
    IN_PROGRESS: { assigneeId: hvacStaff.userId, supervisorId: supervisor.userId },
    ON_HOLD: { assigneeId: hvacStaff.userId, supervisorId: supervisor.userId },
    REOPENED: { assigneeId: hvacStaff.userId, supervisorId: supervisor.userId, reopenCount: 1 },
    RESOLVED: { assigneeId: hvacStaff.userId, supervisorId: supervisor.userId, resolvedAt: hoursFromNow(-1) },
    ESCALATED: { assigneeId: hvacStaff.userId, supervisorId: supervisor.userId, escalationLevel: 1, lastEscalatedAt: hoursFromNow(-1) },
    CLOSED: { assigneeId: hvacStaff.userId, supervisorId: supervisor.userId, resolvedAt: hoursFromNow(-5), closedAt: hoursFromNow(-4) },
    INVALID: {},
  }[status];
  return makeComplaint({ status, ...base, ...overrides });
}
