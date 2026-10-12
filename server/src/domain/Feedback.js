import { ValidationError } from './errors.js';

// The reporter's response to a RESOLVED complaint (sd Confirm Resolution: <<create>> Feedback).
// isFixed = true needs a rating of 1 to 5. isFixed = false is a rejection: rating stays null
// and `comment` holds the reason.
export class Feedback {
  constructor({ feedbackId = null, complaintId = null, isFixed, rating = null, comment = null, givenAt }) {
    if (isFixed && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) {
      throw new ValidationError('rating must be a whole number from 1 to 5');
    }
    this.feedbackId = feedbackId;
    this.complaintId = complaintId;
    this.isFixed = isFixed;
    this.rating = isFixed ? rating : null;
    this.comment = comment;
    this.givenAt = givenAt;
  }
}
