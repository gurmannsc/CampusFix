// multipart/form-data parsing for POST /api/complaints (the optional "photo" field).
// Files are kept in memory (max 5 MB) until the complaint has been validated, so a rejected
// request never leaves a file on disk. JSON requests pass through untouched.
import multer from 'multer';
import { ValidationError } from '../domain/index.js';
import { MAX_PHOTO_BYTES } from '../services/photoStorage.js';

const ALLOWED_MIME = ['image/jpeg', 'image/png'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
  // Quick filter on the declared type; the real check is on the file's bytes (photoStorage.js).
  fileFilter(req, file, cb) {
    cb(ALLOWED_MIME.includes(file.mimetype) ? null : new ValidationError('photo must be a JPG or PNG image'), true);
  },
});

export function photoUpload(req, res, next) {
  upload.single('photo')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const message = {
        LIMIT_FILE_SIZE: 'photo must be at most 5 MB',
        LIMIT_UNEXPECTED_FILE: 'send at most one file, in the field named "photo"',
        LIMIT_FILE_COUNT: 'send at most one photo',
      }[err.code] ?? err.message;
      return next(new ValidationError(message));
    }
    return next(err);
  });
}
