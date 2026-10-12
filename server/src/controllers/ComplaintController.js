// ComplaintController: raise a complaint (sd Raise Complaint) and read complaints.
import path from 'node:path';
import { config } from '../config.js';
import {
  Complaint, DomainError, ForbiddenActionError, ValidationError, validateRaiseDetails,
} from '../domain/index.js';
import { complaintRepository } from '../repositories/complaintRepository.js';
import { categoryRepository, locationRepository, deadlineRuleRepository } from '../repositories/referenceRepository.js';
import { createComplaint } from '../services/complaintWorkflow.js';
import { PHOTO_NAME, savePhoto, removePhoto } from '../services/photoStorage.js';
import { canView, parseId, parseComplaintFilters } from './helpers.js';

export const ComplaintController = {
  // POST /api/complaints   (CampusUser; JSON or multipart with an optional "photo" file)
  // Mirrors the sequence diagram: validate(details) -> Category.getDefaultPriority() ->
  // DeadlineRule.calculateDueAt(now) -> <<create>> Complaint -> NotificationService.send -> complaintId.
  async raiseComplaint(req, res) {
    const details = validateRaiseDetails(req.body ?? {}); // alt [details invalid]: 400 with a message per field

    const errors = {};
    const category = await categoryRepository.findById(details.categoryId);
    if (!category) errors.categoryId = 'unknown category';
    if (!(await locationRepository.exists(details.locationId))) errors.locationId = 'unknown location';
    if (Object.keys(errors).length) throw new ValidationError('Invalid complaint details', errors);

    const deadlineRule = await deadlineRuleRepository.findByPriority(category.getDefaultPriority());
    let photoPath = null;
    try {
      if (req.file) photoPath = await savePhoto(req.file); // checks the file's bytes first (400 if not JPG/PNG)
      const complaint = Complaint.create({
        details: { ...details, photoPath }, reporter: req.user.asActor(), category, deadlineRule,
      });
      await createComplaint(complaint); // saves it, its first StatusUpdate and the "New complaint" notifications
      res.status(201).json({
        complaintId: complaint.complaintId,
        complaint: await complaintRepository.findDetails(complaint.complaintId),
      });
    } catch (err) {
      await removePhoto(photoPath); // do not leave an orphan file when the complaint was not saved
      throw err;
    }
  },

  // GET /api/complaints   role-filtered, default sort priority then dueAt
  async list(req, res) {
    const filters = parseComplaintFilters(req.query);
    res.json({ complaints: await complaintRepository.list(req.user, filters) });
  },

  // GET /api/complaints/:id   details with status history (US-03), feedback and escalations
  async details(req, res) {
    const id = parseId(req.params.id);
    const access = await complaintRepository.findAccessInfo(id);
    if (!access) throw new DomainError(`Complaint ${id} not found`, 404);
    if (!canView(req.user, access)) throw new ForbiddenActionError('You cannot view this complaint');
    res.json({ complaint: await complaintRepository.findDetails(id) });
  },

  // GET /api/complaints/:id/photo   only people who may see the complaint (US-02: supervisor and assignee, plus the reporter)
  async photo(req, res, next) {
    const id = parseId(req.params.id);
    const access = await complaintRepository.findAccessInfo(id);
    if (!access) throw new DomainError(`Complaint ${id} not found`, 404);
    if (!canView(req.user, access)) throw new ForbiddenActionError('You cannot view this complaint');
    // PHOTO_NAME is what savePhoto generates; checking it again keeps a bad DB value from becoming a path.
    if (!access.photoPath || !PHOTO_NAME.test(access.photoPath)) throw new DomainError('This complaint has no photo', 404);
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600' });
    res.sendFile(path.join(config.uploadsDir, access.photoPath), (err) => {
      if (err) next(new DomainError('Photo file is missing', 404));
    });
  },

  // GET /api/categories and /api/locations: read-only lists for the ComplaintForm drop-downs
  async categories(req, res) {
    const categories = await categoryRepository.findAll();
    res.json({ categories: categories.map((c) => ({ categoryId: c.categoryId, name: c.name, type: c.type, defaultPriority: c.defaultPriority })) });
  },
  async locations(req, res) {
    res.json({ locations: await locationRepository.findAll() });
  },
};
