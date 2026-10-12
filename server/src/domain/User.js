// User hierarchy from the class diagram: User > CampusUser > Student / Faculty, and
// User > MaintenanceStaff / MaintenanceSupervisor / Administrator.
// (In MySQL they share one `users` table with a `role` column; see userFromRow in users.js.)
//
// Operations that only apply domain rules (confirmResolution, updateWorkStatus, assignComplaint, ...)
// are implemented here by calling the Complaint entity. Operations that need the database or a
// report (raiseComplaint, viewNotifications, viewDashboard, ...) call a collaborator passed in as
// `deps` (controllers/repositories, wired in app.js from M4 onwards).
//
// Where the diagram says `complaintId`, the operation accepts either a loaded Complaint or an id.
// With an id it loads the complaint through deps.complaintRepository and saves it afterwards.
import bcrypt from 'bcrypt';
import { Complaint } from './Complaint.js';
import { DomainError } from './errors.js';

export class User {
  constructor({ userId, name, email, phone = null, passwordHash }, deps = {}) {
    if (new.target === User) throw new TypeError('User is abstract');
    this.userId = userId;
    this.name = name;
    this.email = email;
    this.phone = phone;
    this.passwordHash = passwordHash;
    this.deps = deps;
  }

  // Overridden by each concrete subclass (matches users.role).
  get role() {
    throw new TypeError('role is defined by the concrete subclass');
  }

  // Compares the credentials with this user's stored bcrypt hash.
  async login(email, password) {
    return email?.toLowerCase() === this.email.toLowerCase() && bcrypt.compare(password ?? '', this.passwordHash);
  }

  // Sessions are stateless JWTs, so logging out only means the client discards its token.
  logout() {}

  viewNotifications() {
    return this.collaborator('notificationRepository').findByUser(this.userId);
  }

  // The "who" the state machine checks.
  asActor() {
    return { userId: this.userId, role: this.role };
  }

  // Safe to send to the browser: never includes passwordHash or deps.
  toJSON() {
    const { passwordHash, deps, ...rest } = this;
    return { ...rest, role: this.role };
  }

  collaborator(name) {
    const dep = this.deps[name];
    if (!dep) throw new DomainError(`${this.constructor.name} needs "${name}" to do this (it is wired in the controllers)`, 500);
    return dep;
  }

  // ---- helpers shared by the subclasses ----

  async loadComplaint(ref) {
    if (ref instanceof Complaint) return { complaint: ref, loaded: false };
    const complaint = await this.collaborator('complaintRepository').findById(ref);
    if (!complaint) throw new DomainError(`Complaint ${ref} not found`, 404);
    return { complaint, loaded: true };
  }

  // Saves only when this method loaded the complaint itself; a caller that passed an entity saves it.
  async saveIfLoaded({ complaint, loaded }) {
    if (loaded) await this.collaborator('complaintRepository').save(complaint);
  }

  ctx(now = new Date()) {
    return { actor: this.asActor(), now };
  }
}
