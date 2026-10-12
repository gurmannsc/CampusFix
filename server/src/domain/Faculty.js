import { CampusUser } from './CampusUser.js';
import { Role } from './enums.js';

export class Faculty extends CampusUser {
  constructor({ employeeId = null, department = null, ...rest }, deps) {
    super(rest, deps);
    this.employeeId = employeeId;
    this.department = department;
  }

  get role() {
    return Role.FACULTY;
  }
}
