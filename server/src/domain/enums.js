// Enumerations from the class diagram. Literals must stay exactly as drawn.
const makeEnum = (...names) => Object.freeze(Object.fromEntries(names.map((n) => [n, n])));

export const ComplaintStatus = makeEnum(
  'SUBMITTED', 'INVALID', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'REOPENED', 'ESCALATED', 'CLOSED',
);
export const Priority = makeEnum('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');
export const CategoryType = makeEnum('INFRASTRUCTURE', 'SERVICE');
export const AreaType = makeEnum('HOSTEL', 'CLASSROOM', 'LAB', 'MESS', 'WASHROOM', 'COMMON_AREA');

// Values of users.role (docs/03: the User hierarchy is stored in one table).
export const Role = makeEnum('STUDENT', 'FACULTY', 'STAFF', 'SUPERVISOR', 'ADMIN');

// The "Open" composite state of the state diagram (docs/04).
export const OPEN_STATES = Object.freeze([
  ComplaintStatus.SUBMITTED,
  ComplaintStatus.ASSIGNED,
  ComplaintStatus.IN_PROGRESS,
  ComplaintStatus.ON_HOLD,
  ComplaintStatus.REOPENED,
]);

// The Timer (node-cron) is a non-human actor; it is the only "who" for rows 11, 12 and 13.
export const TIMER = Object.freeze({ role: 'TIMER', userId: null });

// Roles that are CampusUsers (they raise complaints and confirm or reject fixes).
export const CAMPUS_USER_ROLES = Object.freeze([Role.STUDENT, Role.FACULTY]);
