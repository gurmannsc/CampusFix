import { CampusUser } from './CampusUser.js';
import { Role } from './enums.js';

export class Student extends CampusUser {
  constructor({ sapId = null, program = null, hostelRoom = null, ...rest }, deps) {
    super(rest, deps);
    this.sapId = sapId;
    this.program = program;
    this.hostelRoom = hostelRoom;
  }

  get role() {
    return Role.STUDENT;
  }
}
