// Domain errors carry the HTTP status the API should answer with, so controllers only need
// one error handler: res.status(err.httpStatus).json({ error: err.message }).

export class DomainError extends Error {
  constructor(message, httpStatus = 400, details = undefined) {
    super(message);
    this.name = this.constructor.name;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

// docs/04: "Anything else returns HTTP 409". Also used when a guard on a legal transition fails
// (e.g. staff of the wrong trade, complaint not yet overdue).
export class IllegalTransitionError extends DomainError {
  constructor(message) {
    super(message, 409);
  }
}

// The caller may not perform this event on this complaint (not its reporter / assignee, wrong role).
export class ForbiddenActionError extends DomainError {
  constructor(message) {
    super(message, 403);
  }
}

// Missing or malformed input (rating outside 1..5, empty reason, ...).
export class ValidationError extends DomainError {
  constructor(message, details = undefined) {
    super(message, 400, details);
  }
}
