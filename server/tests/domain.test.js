// The remaining classes of the class diagram: enums, small entities and the User hierarchy.
import bcrypt from 'bcrypt';
import {
  ComplaintStatus, Priority, CategoryType, AreaType, Role, OPEN_STATES, DeadlineRule, Category, Feedback, Notification,
  Escalation, StatusUpdate, Location, User, CampusUser, Student, Faculty, MaintenanceStaff, MaintenanceSupervisor,
  Administrator, userFromRow, Complaint, IllegalTransitionError, ForbiddenActionError, ValidationError, DomainError,
} from '../src/domain/index.js';
import { NOW, hoursFromNow, rules, hvac, complaintIn, makeComplaint } from './helpers/fixtures.js';

describe('enumerations match the class diagram literally', () => {
  test('literals', () => {
    expect(Object.values(ComplaintStatus)).toEqual(['SUBMITTED', 'INVALID', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'REOPENED', 'ESCALATED', 'CLOSED']);
    expect(Object.values(Priority)).toEqual(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
    expect(Object.values(CategoryType)).toEqual(['INFRASTRUCTURE', 'SERVICE']);
    expect(Object.values(AreaType)).toEqual(['HOSTEL', 'CLASSROOM', 'LAB', 'MESS', 'WASHROOM', 'COMMON_AREA']);
    expect(Object.values(Role)).toEqual(['STUDENT', 'FACULTY', 'STAFF', 'SUPERVISOR', 'ADMIN']);
  });
  test('"Open" composite state', () => {
    expect([...OPEN_STATES].sort()).toEqual(['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REOPENED', 'SUBMITTED']);
  });
  test('enums are frozen', () => {
    expect(() => { ComplaintStatus.DONE = 'DONE'; }).toThrow(TypeError);
  });
});

describe('DeadlineRule.calculateDueAt (docs/01 table)', () => {
  test.each([['CRITICAL', 4], ['HIGH', 24], ['MEDIUM', 48], ['LOW', 120]])('%s = start + %i hours', (priority, hours) => {
    expect(rules[priority].calculateDueAt(NOW)).toEqual(hoursFromNow(hours));
  });
  test('accepts a Date or an ISO string and does not mutate its input', () => {
    const start = new Date(NOW);
    rules.HIGH.calculateDueAt(start);
    expect(start).toEqual(NOW);
    expect(rules.HIGH.calculateDueAt(NOW.toISOString())).toEqual(hoursFromNow(24));
  });
});

describe('small entities', () => {
  test('Category.getDefaultPriority and isService', () => {
    expect(hvac.getDefaultPriority()).toBe('MEDIUM');
    expect(hvac.isService).toBe(false);
    expect(new Category({ name: 'Mess and Canteen', type: 'SERVICE', defaultPriority: 'HIGH' }).isService).toBe(true);
  });
  test('Feedback: isFixed needs a rating of 1..5; a rejection has no rating', () => {
    expect(new Feedback({ isFixed: true, rating: 5, givenAt: NOW }).rating).toBe(5);
    expect(() => new Feedback({ isFixed: true, rating: 0, givenAt: NOW })).toThrow(ValidationError);
    expect(() => new Feedback({ isFixed: true, givenAt: NOW })).toThrow(ValidationError);
    const rejection = new Feedback({ isFixed: false, rating: 3, comment: 'Still broken', givenAt: NOW });
    expect(rejection.rating).toBeNull();
    expect(rejection.comment).toBe('Still broken');
  });
  test('Notification.markRead', () => {
    const n = new Notification({ userId: 1, message: 'hi', sentAt: NOW });
    expect(n.isRead).toBe(false);
    n.markRead();
    expect(n.isRead).toBe(true);
  });
  test('Escalation, StatusUpdate and Location hold their attributes', () => {
    expect(new Escalation({ level: 2, reason: 'r', escalatedAt: NOW })).toMatchObject({ level: 2, reason: 'r', notifications: [] });
    expect(new StatusUpdate({ toStatus: 'SUBMITTED', updatedAt: NOW })).toMatchObject({ fromStatus: null, updatedBy: null });
    expect(new Location({ block: 'Hostel Block A', floor: 2, room: '204', areaType: 'HOSTEL' })).toMatchObject({ floor: 2, room: '204' });
  });
});

describe('User hierarchy', () => {
  const base = { userId: 1, name: 'Aarav', email: 'student1@nmims.edu', passwordHash: 'x' };

  test('User and CampusUser are abstract', () => {
    expect(() => new User(base)).toThrow(/abstract/);
    expect(() => new CampusUser(base)).toThrow(/abstract/);
  });
  test('inheritance matches the diagram', () => {
    const student = new Student(base);
    const faculty = new Faculty({ ...base, employeeId: 'E1', department: 'CE' });
    const staff = new MaintenanceStaff({ ...base, trade: 'HVAC', isAvailable: true });
    const sup = new MaintenanceSupervisor(base);
    const adm = new Administrator(base);
    for (const u of [student, faculty, staff, sup, adm]) expect(u).toBeInstanceOf(User);
    expect(student).toBeInstanceOf(CampusUser);
    expect(faculty).toBeInstanceOf(CampusUser);
    expect(staff).not.toBeInstanceOf(CampusUser);
    expect(sup).not.toBeInstanceOf(CampusUser);
    expect(adm).not.toBeInstanceOf(CampusUser);
    expect([student, faculty, staff, sup, adm].map((u) => u.role)).toEqual(['STUDENT', 'FACULTY', 'STAFF', 'SUPERVISOR', 'ADMIN']);
  });
  test('subclass attributes', () => {
    expect(new Student({ ...base, sapId: '700', program: 'MBA Tech CE', hostelRoom: 'A-204' })).toMatchObject({ sapId: '700', program: 'MBA Tech CE', hostelRoom: 'A-204' });
    expect(new MaintenanceStaff({ ...base, trade: 'HVAC' }).isAvailable).toBe(true);
  });
  test('login(email, password) checks the bcrypt hash; logout is a no-op', async () => {
    const hash = await bcrypt.hash('demo123', 4);
    const u = new Student({ ...base, passwordHash: hash });
    expect(await u.login('student1@nmims.edu', 'demo123')).toBe(true);
    expect(await u.login('STUDENT1@nmims.edu', 'demo123')).toBe(true);
    expect(await u.login('student1@nmims.edu', 'wrong')).toBe(false);
    expect(await u.login('someone@nmims.edu', 'demo123')).toBe(false);
    expect(u.logout()).toBeUndefined();
  });
  test('toJSON never exposes the password hash', () => {
    const json = JSON.parse(JSON.stringify(new Student({ ...base, passwordHash: 'secret-hash' }, { complaintRepository: {} })));
    expect(json).toMatchObject({ userId: 1, role: 'STUDENT', email: 'student1@nmims.edu' });
    expect(JSON.stringify(json)).not.toContain('secret-hash');
    expect(json).not.toHaveProperty('deps');
  });
  test('userFromRow builds the right subclass from a users row', () => {
    const row = { user_id: 5, name: 'N', email: 'n@x', phone: '1', password_hash: 'h' };
    expect(userFromRow({ ...row, role: 'STUDENT', sap_id: 'S1', program: 'P', hostel_room: 'A-1' })).toBeInstanceOf(Student);
    expect(userFromRow({ ...row, role: 'FACULTY', employee_id: 'E', department: 'D' })).toBeInstanceOf(Faculty);
    const staff = userFromRow({ ...row, role: 'STAFF', trade: 'HVAC', is_available: 1 });
    expect(staff).toBeInstanceOf(MaintenanceStaff);
    expect(staff.isAvailable).toBe(true);
    expect(userFromRow({ ...row, role: 'STAFF', trade: 'HVAC', is_available: 0 }).isAvailable).toBe(false);
    expect(userFromRow({ ...row, role: 'SUPERVISOR' })).toBeInstanceOf(MaintenanceSupervisor);
    expect(userFromRow({ ...row, role: 'ADMIN' })).toBeInstanceOf(Administrator);
    expect(() => userFromRow({ ...row, role: 'JANITOR' })).toThrow(/Unknown user role/);
  });
});

describe('user operations apply the domain rules to a Complaint', () => {
  // A tiny in-memory complaintRepository so operations can be called with an id, as in the diagram.
  const repo = (complaints) => {
    const saved = [];
    return {
      saved,
      findById: async (id) => complaints.find((c) => c.complaintId === id) ?? null,
      save: async (c) => { saved.push(c.complaintId); },
      findAssignedTo: async (userId) => complaints.filter((c) => c.assigneeId === userId),
    };
  };
  const mk = (role, fields, deps) => userFromRow({ user_id: fields.id, name: fields.name ?? role, email: `${role}@x`, password_hash: 'h', role, ...fields.row }, deps);

  const studentUser = (deps) => mk('STUDENT', { id: 1 }, deps);
  const hvacUser = (deps) => mk('STAFF', { id: 20, name: 'Imran', row: { trade: 'HVAC', is_available: 1 } }, deps);
  const otherHvacUser = () => mk('STAFF', { id: 21, name: 'Deepak', row: { trade: 'HVAC', is_available: 1 } });
  const supervisorUser = (deps) => mk('SUPERVISOR', { id: 10 }, deps);
  const adminUser = (deps) => mk('ADMIN', { id: 11 }, deps);

  test('CampusUser.confirmResolution(complaintId, rating) loads, confirms and saves', async () => {
    const c = complaintIn('RESOLVED');
    const r = repo([c]);
    await studentUser({ complaintRepository: r }).confirmResolution(7, 5, 'Great', NOW);
    expect(c.status).toBe('CLOSED');
    expect(r.saved).toEqual([7]);
  });
  test('given an entity, the user does not save (the controller does)', async () => {
    const c = complaintIn('RESOLVED');
    await studentUser().confirmResolution(c, 5);
    expect(c.status).toBe('CLOSED');
  });
  test('CampusUser.rejectResolution reopens; a different user cannot', async () => {
    const c = complaintIn('RESOLVED');
    await studentUser().rejectResolution(c, 'Still broken');
    expect(c.status).toBe('REOPENED');
    const other = mk('STUDENT', { id: 2 });
    await expect(other.rejectResolution(complaintIn('RESOLVED'), 'x')).rejects.toThrow(ForbiddenActionError);
  });
  test('CampusUser.trackComplaint returns the status; unknown id is a 404', async () => {
    const r = repo([complaintIn('IN_PROGRESS')]);
    const u = studentUser({ complaintRepository: r });
    expect(await u.trackComplaint(7)).toBe('IN_PROGRESS');
    await expect(u.trackComplaint(999)).rejects.toMatchObject({ httpStatus: 404 });
  });
  test('CampusUser.raiseComplaint delegates to ComplaintController', async () => {
    const calls = [];
    const u = studentUser({ complaintController: { raiseComplaint: async (d, who) => { calls.push([d, who.userId]); return 42; } } });
    expect(await u.raiseComplaint({ categoryId: 4 })).toBe(42);
    expect(calls).toEqual([[{ categoryId: 4 }, 1]]);
  });
  test('an operation that needs an unwired collaborator fails with a clear message', () => {
    expect(() => studentUser().raiseComplaint({})).toThrow(/needs "complaintController"/);
    expect(() => supervisorUser().viewNotifications()).toThrow(DomainError);
  });

  describe('MaintenanceStaff.updateWorkStatus (US-07)', () => {
    test('maps the requested status to the right event', async () => {
      const staff = hvacUser();
      const c = complaintIn('ASSIGNED');
      await staff.updateWorkStatus(c, 'IN_PROGRESS');
      expect(c.status).toBe('IN_PROGRESS');
      await staff.updateWorkStatus(c, 'ON_HOLD', { reason: 'waiting for capacitor' });
      expect(c.status).toBe('ON_HOLD');
      await staff.updateWorkStatus(c, 'IN_PROGRESS');
      expect(c.status).toBe('IN_PROGRESS');
      await staff.updateWorkStatus(c, 'RESOLVED', { remarks: 'Fixed' });
      expect(c.status).toBe('RESOLVED');
      expect(c.outbox.statusUpdates.map((u) => u.remarks)).toEqual([null, 'waiting for capacitor', null, 'Fixed']);
    });
    test('ON_HOLD needs a reason and RESOLVED needs remarks', async () => {
      await expect(hvacUser().updateWorkStatus(complaintIn('IN_PROGRESS'), 'ON_HOLD')).rejects.toThrow(ValidationError);
      await expect(hvacUser().updateWorkStatus(complaintIn('IN_PROGRESS'), 'RESOLVED')).rejects.toThrow(ValidationError);
    });
    test('staff cannot set CLOSED, REOPENED, ESCALATED ...', async () => {
      for (const status of ['CLOSED', 'REOPENED', 'ESCALATED', 'ASSIGNED', 'INVALID', 'SUBMITTED']) {
        await expect(hvacUser().updateWorkStatus(complaintIn('RESOLVED'), status)).rejects.toThrow(IllegalTransitionError);
      }
    });
    test('another staff member cannot work on it', async () => {
      await expect(otherHvacUser().updateWorkStatus(complaintIn('ASSIGNED'), 'IN_PROGRESS')).rejects.toThrow(ForbiddenActionError);
    });
    test('markResolved and viewAssignedComplaints', async () => {
      const c = complaintIn('IN_PROGRESS');
      const r = repo([c]);
      const staff = hvacUser({ complaintRepository: r });
      await staff.markResolved(7, 'Done', NOW);
      expect(c.status).toBe('RESOLVED');
      expect(await staff.viewAssignedComplaints()).toEqual([c]);
    });
  });

  describe('MaintenanceSupervisor', () => {
    test('assignComplaint, markInvalid, setPriority', async () => {
      const sup = supervisorUser();
      const c = makeComplaint();
      await sup.setPriority(c, 'HIGH', rules.HIGH);
      expect(c.priority).toBe('HIGH');
      await sup.assignComplaint(c, hvacUser(), NOW);
      expect(c.status).toBe('ASSIGNED');
      const bad = makeComplaint();
      await sup.markInvalid(bad, 'Duplicate', NOW);
      expect(bad.status).toBe('INVALID');
    });
    test('setPriority looks the rule up through deps when not given', async () => {
      const sup = supervisorUser({ deadlineRuleRepository: { findByPriority: async (p) => rules[p] } });
      const c = makeComplaint();
      await sup.setPriority(c, 'CRITICAL');
      expect(c.priority).toBe('CRITICAL');
    });
    test('handleEscalation(reassign) resolves the escalation', async () => {
      const c = complaintIn('ESCALATED', { dueAt: hoursFromNow(-30) });
      await supervisorUser().handleEscalation(c, { action: 'reassign', staff: otherHvacUser() }, NOW);
      expect(c.status).toBe('ASSIGNED');
      expect(c.assigneeId).toBe(21);
    });
    test('handleEscalation accepts an escalation id via complaintRepository.findByEscalationId', async () => {
      const c = complaintIn('ESCALATED', { dueAt: hoursFromNow(-30) });
      const saved = [];
      const sup = supervisorUser({ complaintRepository: { findByEscalationId: async (id) => (id === 5 ? c : null), save: async (x) => saved.push(x) } });
      await sup.handleEscalation(5, { action: 'extend', newDueAt: hoursFromNow(8), reason: 'parts' }, NOW);
      expect(c.status).toBe('ASSIGNED');
      expect(saved).toEqual([c]);
    });
    test('assigning an already ASSIGNED complaint is refused (409)', async () => {
      await expect(supervisorUser().assignComplaint(complaintIn('ASSIGNED'), hvacUser())).rejects.toThrow(IllegalTransitionError);
    });
  });

  describe('Administrator', () => {
    test('US-11 handleServiceComplaint assigns a SERVICE complaint to the administrator', async () => {
      const mess = new Category({ categoryId: 8, name: 'Mess and Canteen', type: 'SERVICE', defaultPriority: 'MEDIUM' });
      const c = makeComplaint({ category: mess, categoryId: 8 });
      const admin = adminUser();
      await admin.handleServiceComplaint(c, NOW);
      expect(c.status).toBe('ASSIGNED');
      expect(c.assigneeId).toBe(admin.userId);
      expect(c.supervisorId).toBeNull();
    });
    test('an Administrator cannot take an INFRASTRUCTURE complaint', async () => {
      await expect(adminUser().handleServiceComplaint(makeComplaint())).rejects.toThrow(ForbiddenActionError);
    });
    test('manageCategory, configureDeadline and viewDashboard delegate', async () => {
      const calls = [];
      const admin = adminUser({
        adminService: { manageCategory: (c) => calls.push(['cat', c]), configureDeadline: (p, h, i) => calls.push(['rule', p, h, i]) },
        reportService: { dashboard: (f) => calls.push(['dash', f]) },
      });
      admin.manageCategory({ name: 'Roads' });
      admin.configureDeadline('HIGH', 12, 6);
      admin.viewDashboard({ block: 'A' });
      expect(calls).toEqual([['cat', { name: 'Roads' }], ['rule', 'HIGH', 12, 6], ['dash', { block: 'A' }]]);
    });
  });
});

test('Complaint is exported from the domain index and is the class under test', () => {
  expect(makeComplaint()).toBeInstanceOf(Complaint);
});
