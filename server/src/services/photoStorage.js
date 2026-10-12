// Complaint photos on disk (the "File Storage" box of the architecture diagram).
// Rules (docs/01): optional, JPG or PNG, at most 5 MB. The size and the declared type are checked
// by multer (middleware/upload.js); here the CONTENT is checked, because a client can claim
// "image/png" for any file. Files get a random name, so user-supplied names never reach the disk.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { ValidationError } from '../domain/index.js';

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const PHOTO_NAME = /^[0-9a-f-]{36}\.(jpg|png)$/; // what we generate; checked again before serving

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

// 'png' | 'jpg' | null, from the first bytes of the file.
export function detectImageType(buffer) {
  if (buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return 'png';
  if (buffer.length >= JPEG_SIGNATURE.length && buffer.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) return 'jpg';
  return null;
}

// Throws a 400 unless the uploaded file really is a JPEG or PNG within the size limit.
export function validatePhoto(file) {
  if (file.size > MAX_PHOTO_BYTES) throw new ValidationError('photo must be at most 5 MB');
  const type = detectImageType(file.buffer);
  if (!type) throw new ValidationError('photo must be a JPG or PNG image');
  return type;
}

// Writes the file and returns its stored name (this is what complaints.photo_path holds).
export async function savePhoto(file) {
  const type = validatePhoto(file);
  const name = `${crypto.randomUUID()}.${type}`;
  await fs.mkdir(config.uploadsDir, { recursive: true });
  await fs.writeFile(path.join(config.uploadsDir, name), file.buffer, { flag: 'wx' });
  return name;
}

export async function removePhoto(name) {
  if (name && PHOTO_NAME.test(name)) await fs.rm(path.join(config.uploadsDir, name), { force: true });
}
