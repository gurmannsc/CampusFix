// Builds the right User subclass from a `users` table row (snake_case columns).
import { Role } from './enums.js';
import { Student } from './Student.js';
import { Faculty } from './Faculty.js';
import { MaintenanceStaff } from './MaintenanceStaff.js';
import { MaintenanceSupervisor } from './MaintenanceSupervisor.js';
import { Administrator } from './Administrator.js';

export function userFromRow(row, deps = {}) {
  const base = {
    userId: row.user_id, name: row.name, email: row.email, phone: row.phone, passwordHash: row.password_hash,
  };
  switch (row.role) {
    case Role.STUDENT:
      return new Student({ ...base, sapId: row.sap_id, program: row.program, hostelRoom: row.hostel_room }, deps);
    case Role.FACULTY:
      return new Faculty({ ...base, employeeId: row.employee_id, department: row.department }, deps);
    case Role.STAFF:
      return new MaintenanceStaff({ ...base, trade: row.trade, isAvailable: Boolean(row.is_available) }, deps);
    case Role.SUPERVISOR:
      return new MaintenanceSupervisor(base, deps);
    case Role.ADMIN:
      return new Administrator(base, deps);
    default:
      throw new Error(`Unknown user role "${row.role}"`);
  }
}
