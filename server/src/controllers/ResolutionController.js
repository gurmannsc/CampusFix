// ResolutionController: the work done on a complaint after it is assigned.
//   staff:     start, hold (partsNeeded), resume (partsReceived), resolve (markResolved)   rows 5 to 8
//   reporter:  confirm / reject the fix, both through submitResponse                       rows 9, 10
// (sd Confirm Resolution: page -> ResolutionController.submitResponse(complaintId, isFixed, rating, comment)).
// All the rules (who, which status, required reason/remarks, rating 1..5) are in the state machine;
// this controller only runs the domain operation inside one transaction and returns the result.
import { complaintRepository } from '../repositories/complaintRepository.js';
import { updateComplaint } from '../services/complaintWorkflow.js';
import { parseId } from './helpers.js';

// Builds a handler for one staff event. `payload(req)` picks the fields the event needs.
function staffEvent(event, payload = () => ({})) {
  return async (req, res) => {
    const id = parseId(req.params.id);
    await updateComplaint(id, (complaint) => {
      complaint.applyEvent(event, payload(req), req.user.ctx());
    });
    res.json({ complaint: await complaintRepository.findDetails(id) });
  };
}

export const ResolutionController = {
  // POST /api/complaints/:id/start    ASSIGNED -> IN_PROGRESS (row 5)
  start: staffEvent('startWork'),
  // POST /api/complaints/:id/hold     {reason}  IN_PROGRESS -> ON_HOLD (row 6)
  hold: staffEvent('partsNeeded', (req) => ({ reason: req.body?.reason })),
  // POST /api/complaints/:id/resume   ON_HOLD -> IN_PROGRESS (row 7)
  resume: staffEvent('partsReceived'),
  // POST /api/complaints/:id/resolve  {remarks}  IN_PROGRESS -> RESOLVED (row 8); the reporter is asked to confirm
  resolve: staffEvent('markResolved', (req) => ({ remarks: req.body?.remarks })),

  // isFixed = true:  Complaint.confirm(rating, comment) -> CLOSED   (row 9)
  // isFixed = false: Complaint.reopen(comment)          -> REOPENED (row 10), supervisor notified
  // The domain creates the Feedback row ("<<create>> Feedback(isFixed, rating, comment)").
  async submitResponse(complaintId, isFixed, rating, comment, user) {
    await updateComplaint(complaintId, (complaint) => {
      if (isFixed) complaint.confirm(rating, comment, user.ctx());
      else complaint.reopen(comment, user.ctx());
    });
    return complaintRepository.findDetails(complaintId);
  },

  // POST /api/complaints/:id/confirm  {rating, comment?}
  async confirm(req, res) {
    const { rating, comment } = req.body ?? {};
    res.json({ complaint: await ResolutionController.submitResponse(parseId(req.params.id), true, rating, comment, req.user) });
  },

  // POST /api/complaints/:id/reject   {reason}
  async reject(req, res) {
    res.json({ complaint: await ResolutionController.submitResponse(parseId(req.params.id), false, null, req.body?.reason, req.user) });
  },
};
