// ComplaintForm (sd Raise Complaint): the reporter picks category and exact location, describes the
// fault and may attach a photo. submit() sends it to ComplaintController.raiseComplaint and shows the
// complaint ID that comes back (US-01), or the server's message for each invalid field.
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useLoad } from '../hooks.js';
import { formatDateTime, formatLocation, PRIORITY_LABEL } from '../format.js';
import { Message, PriorityBadge, StatusBadge } from './Badges.jsx';

const MAX_PHOTO = 5 * 1024 * 1024; // docs/01: JPG or PNG, at most 5 MB
const MAX_TEXT = 2000;

export default function ComplaintForm() {
  const categories = useLoad(() => api.get('/categories'), []);
  const locations = useLoad(() => api.get('/locations'), []);
  const [values, setValues] = useState({ categoryId: '', locationId: '', title: '', description: '' });
  const [photo, setPhoto] = useState(null);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null); // the complaint after a successful submit
  const fileInput = useRef(null);

  const set = (field) => (e) => setValues((v) => ({ ...v, [field]: e.target.value }));

  function choosePhoto(e) {
    const file = e.target.files[0];
    setErrors((er) => ({ ...er, photo: undefined }));
    if (!file) return setPhoto(null);
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setErrors((er) => ({ ...er, photo: 'The photo must be a JPG or PNG image.' }));
      e.target.value = '';
      return setPhoto(null);
    }
    if (file.size > MAX_PHOTO) {
      setErrors((er) => ({ ...er, photo: 'The photo must be at most 5 MB.' }));
      e.target.value = '';
      return setPhoto(null);
    }
    return setPhoto(file);
  }

  async function submit(e) {
    e.preventDefault();
    setFormError('');
    // The same checks the server makes, so the reporter gets a message next to the field at once.
    const local = {};
    if (!values.categoryId) local.categoryId = 'Choose a category.';
    if (!values.locationId) local.locationId = 'Choose the exact location.';
    if (!values.description.trim()) local.description = 'Describe the fault.';
    if (errors.photo) local.photo = errors.photo;
    setErrors(local);
    if (Object.keys(local).length) return;

    const data = new FormData();
    for (const [key, value] of Object.entries(values)) if (value !== '') data.append(key, value);
    if (photo) data.append('photo', photo);

    setBusy(true);
    try {
      const result = await api.post('/complaints', data);
      setCreated(result.complaint);
    } catch (err) {
      if (err.details) setErrors(err.details);
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function another() {
    setCreated(null);
    setValues({ categoryId: '', locationId: '', title: '', description: '' });
    setPhoto(null);
    setErrors({});
  }

  if (created) {
    return (
      <section className="card success-card" aria-live="polite">
        <h2>Complaint registered</h2>
        <p className="big">Your complaint ID is <strong>#{created.complaintId}</strong></p>
        <dl className="facts">
          <dt>Title</dt><dd>{created.title}</dd>
          <dt>Status</dt><dd><StatusBadge status={created.status} /></dd>
          <dt>Priority</dt><dd><PriorityBadge priority={created.priority} /></dd>
          <dt>Due</dt><dd>{formatDateTime(created.dueAt)}</dd>
          <dt>Location</dt><dd>{formatLocation(created.location)}</dd>
        </dl>
        <p>
          <Link className="button primary" to={`/complaints/${created.complaintId}`}>Track this complaint</Link>{' '}
          <button type="button" onClick={another}>Report another</button>
        </p>
      </section>
    );
  }

  const cats = categories.data?.categories ?? [];
  const chosen = cats.find((c) => String(c.categoryId) === values.categoryId);
  const blocks = [...new Set((locations.data?.locations ?? []).map((l) => l.block))];

  return (
    <form className="card form" onSubmit={submit} noValidate>
      <h2>Report a fault</h2>
      <Message>{categories.error?.message || locations.error?.message}</Message>

      <label>Category
        <select value={values.categoryId} onChange={set('categoryId')} aria-invalid={Boolean(errors.categoryId)}>
          <option value="">Choose…</option>
          {['INFRASTRUCTURE', 'SERVICE'].map((type) => (
            <optgroup key={type} label={type === 'SERVICE' ? 'Services' : 'Infrastructure'}>
              {cats.filter((c) => c.type === type).map((c) => <option key={c.categoryId} value={c.categoryId}>{c.name}</option>)}
            </optgroup>
          ))}
        </select>
        {chosen && (
          <span className="hint">
            {chosen.type === 'SERVICE' ? 'Goes to the Administrator. ' : ''}Default priority: {PRIORITY_LABEL[chosen.defaultPriority]}.
          </span>
        )}
        <FieldError>{errors.categoryId}</FieldError>
      </label>

      <label>Location
        <select value={values.locationId} onChange={set('locationId')} aria-invalid={Boolean(errors.locationId)}>
          <option value="">Choose…</option>
          {blocks.map((block) => (
            <optgroup key={block} label={block}>
              {locations.data.locations.filter((l) => l.block === block).map((l) => (
                <option key={l.locationId} value={l.locationId}>{l.floor === 0 ? 'Ground floor' : `Floor ${l.floor}`}, {l.room}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <FieldError>{errors.locationId}</FieldError>
      </label>

      <label>Title <span className="muted small">(optional)</span>
        <input type="text" value={values.title} onChange={set('title')} maxLength={150} placeholder="e.g. Ceiling fan not working" />
        <FieldError>{errors.title}</FieldError>
      </label>

      <label>Description
        <textarea rows={4} value={values.description} onChange={set('description')} maxLength={MAX_TEXT} aria-invalid={Boolean(errors.description)}
          placeholder="What is wrong, and since when?" />
        <FieldError>{errors.description}</FieldError>
      </label>

      <label>Photo <span className="muted small">(optional, JPG or PNG, up to 5 MB)</span>
        <input type="file" ref={fileInput} accept="image/jpeg,image/png" onChange={choosePhoto} />
        <FieldError>{errors.photo}</FieldError>
      </label>

      <Message>{formError}</Message>
      <button type="submit" className="primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit complaint'}</button>
    </form>
  );
}

const FieldError = ({ children }) => (children ? <span className="field-error" role="alert">{children}</span> : null);
