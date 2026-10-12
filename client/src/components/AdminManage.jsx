// Administrator management screens (docs/01: "manage categories, locations, users, deadline rules"):
// four small panels, each a table plus an add/edit form. The server decides what is allowed (for
// example a category that complaints use cannot be deleted) and the message is shown as it comes.
import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useLoad } from '../hooks.js';
import { PRIORITIES, PRIORITY_LABEL } from '../format.js';
import { Message } from './Badges.jsx';

const PANELS = [['categories', 'Categories'], ['locations', 'Locations'], ['users', 'Users'], ['rules', 'Deadline rules']];

export default function AdminManage() {
  const [panel, setPanel] = useState('categories');
  return (
    <>
      <div className="tabs" role="tablist" aria-label="What to manage">
        {PANELS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={panel === key} className={panel === key ? 'tab active' : 'tab'} onClick={() => setPanel(key)}>{label}</button>
        ))}
      </div>
      {panel === 'categories' && <CategoriesPanel />}
      {panel === 'locations' && <LocationsPanel />}
      {panel === 'users' && <UsersPanel />}
      {panel === 'rules' && <RulesPanel />}
    </>
  );
}

// ---- shared bits ----------------------------------------------------------------------------

// Runs a server call and keeps the outcome for display: { kind, text, details }.
function useAction(onDone) {
  const [state, setState] = useState({ kind: 'success', text: '', details: null });
  const [busy, setBusy] = useState(false);
  async function run(call, successText) {
    setBusy(true);
    setState({ kind: 'success', text: '', details: null });
    try {
      await call();
      setState({ kind: 'success', text: successText, details: null });
      onDone?.();
      return true;
    } catch (err) {
      setState({ kind: 'error', text: err.message, details: err.details ?? null });
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { state, busy, run, clear: () => setState({ kind: 'success', text: '', details: null }) };
}

function Outcome({ state }) {
  return (
    <>
      <Message kind={state.kind}>{state.text}</Message>
      {state.details && <ul className="field-list">{Object.entries(state.details).map(([f, m]) => <li key={f}><strong>{f}</strong>: {m}</li>)}</ul>}
    </>
  );
}

const confirmDelete = (what) => window.confirm(`Delete ${what}? This cannot be undone.`);

function Field({ label, children }) {
  return <label>{label}{children}</label>;
}

// ---- categories -----------------------------------------------------------------------------

function CategoriesPanel() {
  const { data, error, reload } = useLoad(() => api.get('/admin/categories'), []);
  const empty = { name: '', type: 'INFRASTRUCTURE', defaultPriority: 'MEDIUM' };
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const { state, busy, run, clear } = useAction(reload);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const reset = () => { setForm(empty); setEditing(null); };

  async function submit(e) {
    e.preventDefault();
    const ok = await run(
      () => (editing ? api.patch(`/admin/categories/${editing}`, form) : api.post('/admin/categories', form)),
      editing ? 'Category updated.' : 'Category added.',
    );
    if (ok) reset();
  }

  return (
    <section className="card">
      <h2>Categories</h2>
      <p className="muted small">Renaming a category also renames the trade of its staff. A category used by complaints or staff cannot be deleted or change type.</p>
      <Message>{error?.message}</Message>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Default priority</th><th>Complaints</th><th>Staff</th><th /></tr></thead>
          <tbody>
            {(data?.categories ?? []).map((c) => (
              <tr key={c.categoryId}>
                <td>{c.name}</td>
                <td>{c.type === 'SERVICE' ? 'Service (Administrator)' : 'Infrastructure'}</td>
                <td>{PRIORITY_LABEL[c.defaultPriority]}</td>
                <td>{c.complaintCount}</td><td>{c.staffCount}</td>
                <td className="actions">
                  <button type="button" onClick={() => { clear(); setEditing(c.categoryId); setForm({ name: c.name, type: c.type, defaultPriority: c.defaultPriority }); }}>Edit</button>
                  <button type="button" className="danger" disabled={busy}
                    title={c.complaintCount || c.staffCount ? 'Used by complaints or staff; the server will refuse' : ''}
                    onClick={() => confirmDelete(`category "${c.name}"`) && run(() => api.delete(`/admin/categories/${c.categoryId}`), 'Category deleted.')}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="form" onSubmit={submit}>
        <h3>{editing ? 'Edit category' : 'Add a category'}</h3>
        <Field label="Name"><input value={form.name} maxLength={50} onChange={set('name')} required /></Field>
        <Field label="Type">
          <select value={form.type} onChange={set('type')}>
            <option value="INFRASTRUCTURE">Infrastructure (maintenance staff)</option>
            <option value="SERVICE">Service (handled by the Administrator)</option>
          </select>
        </Field>
        <Field label="Default priority">
          <select value={form.defaultPriority} onChange={set('defaultPriority')}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select>
        </Field>
        <Outcome state={state} />
        <div className="row">
          <button type="submit" className="primary" disabled={busy}>{editing ? 'Save changes' : 'Add category'}</button>
          {editing && <button type="button" onClick={reset}>Cancel</button>}
        </div>
      </form>
    </section>
  );
}

// ---- locations ------------------------------------------------------------------------------

const AREA_TYPES = ['HOSTEL', 'CLASSROOM', 'LAB', 'MESS', 'WASHROOM', 'COMMON_AREA'];
const AREA_LABEL = { HOSTEL: 'Hostel', CLASSROOM: 'Classroom', LAB: 'Lab', MESS: 'Mess', WASHROOM: 'Washroom', COMMON_AREA: 'Common area' };

function LocationsPanel() {
  const { data, error, reload } = useLoad(() => api.get('/admin/locations'), []);
  const empty = { block: '', floor: '0', room: '', areaType: 'CLASSROOM' };
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const { state, busy, run, clear } = useAction(reload);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const reset = () => { setForm(empty); setEditing(null); };

  async function submit(e) {
    e.preventDefault();
    const body = { ...form, floor: form.floor === '' ? undefined : Number(form.floor) };
    const ok = await run(() => (editing ? api.patch(`/admin/locations/${editing}`, body) : api.post('/admin/locations', body)), editing ? 'Location updated.' : 'Location added.');
    if (ok) reset();
  }

  return (
    <section className="card">
      <h2>Locations</h2>
      <p className="muted small">These are the places a complaint can be reported at. A location where complaints were reported cannot be deleted.</p>
      <Message>{error?.message}</Message>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Block</th><th>Floor</th><th>Room</th><th>Area</th><th>Complaints</th><th /></tr></thead>
          <tbody>
            {(data?.locations ?? []).map((l) => (
              <tr key={l.locationId}>
                <td>{l.block}</td><td>{l.floor}</td><td>{l.room}</td><td>{AREA_LABEL[l.areaType]}</td><td>{l.complaintCount}</td>
                <td className="actions">
                  <button type="button" onClick={() => { clear(); setEditing(l.locationId); setForm({ block: l.block, floor: String(l.floor), room: l.room, areaType: l.areaType }); }}>Edit</button>
                  <button type="button" className="danger" disabled={busy} title={l.complaintCount ? 'Complaints were reported here; the server will refuse' : ''}
                    onClick={() => confirmDelete(`${l.block}, ${l.room}`) && run(() => api.delete(`/admin/locations/${l.locationId}`), 'Location deleted.')}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="form" onSubmit={submit}>
        <h3>{editing ? 'Edit location' : 'Add a location'}</h3>
        <Field label="Block"><input value={form.block} maxLength={50} onChange={set('block')} required placeholder="e.g. Hostel Block A" /></Field>
        <Field label="Floor (0 = ground floor)"><input type="number" value={form.floor} min={-3} max={100} onChange={set('floor')} required /></Field>
        <Field label="Room or area"><input value={form.room} maxLength={50} onChange={set('room')} required placeholder="e.g. 204 or Computer Lab 2" /></Field>
        <Field label="Area type">
          <select value={form.areaType} onChange={set('areaType')}>{AREA_TYPES.map((a) => <option key={a} value={a}>{AREA_LABEL[a]}</option>)}</select>
        </Field>
        <Outcome state={state} />
        <div className="row">
          <button type="submit" className="primary" disabled={busy}>{editing ? 'Save changes' : 'Add location'}</button>
          {editing && <button type="button" onClick={reset}>Cancel</button>}
        </div>
      </form>
    </section>
  );
}

// ---- users ----------------------------------------------------------------------------------

const ROLES = ['STUDENT', 'FACULTY', 'STAFF', 'SUPERVISOR', 'ADMIN'];
const ROLE_LABEL = { STUDENT: 'Student', FACULTY: 'Faculty', STAFF: 'Maintenance staff', SUPERVISOR: 'Supervisor', ADMIN: 'Administrator' };
const EMPTY_USER = { role: 'STUDENT', name: '', email: '', phone: '', password: '', sapId: '', program: '', hostelRoom: '', employeeId: '', department: '', trade: '', isAvailable: true };

function UsersPanel() {
  const { user: me } = useAuth();
  const [roleFilter, setRoleFilter] = useState('');
  const users = useLoad(() => api.get(`/admin/users${roleFilter ? `?role=${roleFilter}` : ''}`), [roleFilter]);
  const categories = useLoad(() => api.get('/admin/categories'), []);
  const [form, setForm] = useState(EMPTY_USER);
  const [editing, setEditing] = useState(null);
  const { state, busy, run, clear } = useAction(users.reload);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const reset = () => { setForm(EMPTY_USER); setEditing(null); };
  const trades = (categories.data?.categories ?? []).filter((c) => c.type === 'INFRASTRUCTURE').map((c) => c.name);

  function body() {
    const out = { name: form.name, email: form.email, phone: form.phone || null };
    if (form.password) out.password = form.password;
    if (form.role === 'STUDENT') Object.assign(out, { sapId: form.sapId, program: form.program, hostelRoom: form.hostelRoom });
    if (form.role === 'FACULTY') Object.assign(out, { employeeId: form.employeeId, department: form.department });
    if (form.role === 'STAFF') Object.assign(out, { trade: form.trade, isAvailable: form.isAvailable });
    return editing ? out : { role: form.role, ...out };
  }

  async function submit(e) {
    e.preventDefault();
    const ok = await run(() => (editing ? api.patch(`/admin/users/${editing}`, body()) : api.post('/admin/users', body())), editing ? 'User updated.' : 'User added. They can log in with the password you set.');
    if (ok) reset();
  }

  const detail = (u) => (u.role === 'STAFF' ? `${u.trade} · ${u.isAvailable ? 'available' : 'unavailable'}`
    : u.role === 'STUDENT' ? [u.sapId, u.hostelRoom].filter(Boolean).join(' · ')
      : u.role === 'FACULTY' ? [u.employeeId, u.department].filter(Boolean).join(' · ') : '');

  return (
    <section className="card">
      <h2>Users</h2>
      <p className="muted small">Accounts that appear in complaints cannot be deleted. Mark staff as unavailable instead, and reset a password here if someone is locked out.</p>
      <div className="filters">
        <Field label="Show">
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">Everyone</option>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </Field>
      </div>
      <Message>{users.error?.message}</Message>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Details</th><th>Complaints</th><th /></tr></thead>
          <tbody>
            {(users.data?.users ?? []).map((u) => (
              <tr key={u.userId}>
                <td>{u.name}</td><td>{u.email}</td><td>{ROLE_LABEL[u.role]}</td><td>{detail(u)}</td><td>{u.complaintCount}</td>
                <td className="actions">
                  {u.role === 'STAFF' && (
                    <button type="button" disabled={busy} onClick={() => run(() => api.patch(`/admin/users/${u.userId}`, { isAvailable: !u.isAvailable }), u.isAvailable ? `${u.name} is now unavailable.` : `${u.name} is available again.`)}>
                      {u.isAvailable ? 'Make unavailable' : 'Make available'}
                    </button>
                  )}
                  <button type="button" onClick={() => {
                    clear(); setEditing(u.userId);
                    setForm({ ...EMPTY_USER, role: u.role, name: u.name, email: u.email, phone: u.phone ?? '', sapId: u.sapId ?? '', program: u.program ?? '', hostelRoom: u.hostelRoom ?? '', employeeId: u.employeeId ?? '', department: u.department ?? '', trade: u.trade ?? '', isAvailable: u.isAvailable ?? true });
                  }}>Edit</button>
                  <button type="button" className="danger" disabled={busy || u.userId === me.userId} title={u.userId === me.userId ? 'You cannot delete yourself' : ''}
                    onClick={() => confirmDelete(`${u.name}'s account`) && run(() => api.delete(`/admin/users/${u.userId}`), 'User deleted.')}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="form" onSubmit={submit} autoComplete="off">
        <h3>{editing ? 'Edit user' : 'Add a user'}</h3>
        <Field label="Role">
          <select value={form.role} onChange={set('role')} disabled={Boolean(editing)}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
          {editing && <span className="hint">The role cannot be changed after the account is created.</span>}
        </Field>
        <Field label="Name"><input value={form.name} maxLength={100} onChange={set('name')} required /></Field>
        <Field label="Email (used to log in)"><input type="email" value={form.email} maxLength={150} onChange={set('email')} required /></Field>
        <Field label="Phone (optional)"><input value={form.phone} maxLength={20} onChange={set('phone')} /></Field>
        <Field label={editing ? 'New password (leave empty to keep the current one)' : 'Password (8 characters or more)'}>
          <input type="password" value={form.password} minLength={8} maxLength={72} onChange={set('password')} required={!editing} autoComplete="new-password" />
        </Field>
        {form.role === 'STUDENT' && (
          <>
            <Field label="SAP ID"><input value={form.sapId} maxLength={20} onChange={set('sapId')} /></Field>
            <Field label="Program"><input value={form.program} maxLength={80} onChange={set('program')} /></Field>
            <Field label="Hostel room"><input value={form.hostelRoom} maxLength={20} onChange={set('hostelRoom')} /></Field>
          </>
        )}
        {form.role === 'FACULTY' && (
          <>
            <Field label="Employee ID"><input value={form.employeeId} maxLength={20} onChange={set('employeeId')} /></Field>
            <Field label="Department"><input value={form.department} maxLength={80} onChange={set('department')} /></Field>
          </>
        )}
        {form.role === 'STAFF' && (
          <>
            <Field label="Trade (matches the complaint category)">
              <select value={form.trade} onChange={set('trade')} required>
                <option value="">Choose…</option>
                {trades.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <label className="inline"><input type="checkbox" checked={form.isAvailable} onChange={set('isAvailable')} /> Available for new assignments</label>
          </>
        )}
        <Outcome state={state} />
        <div className="row">
          <button type="submit" className="primary" disabled={busy}>{editing ? 'Save changes' : 'Add user'}</button>
          {editing && <button type="button" onClick={reset}>Cancel</button>}
        </div>
      </form>
    </section>
  );
}

// ---- deadline rules -------------------------------------------------------------------------

function RulesPanel() {
  const { data, error, reload } = useLoad(() => api.get('/admin/deadline-rules'), []);
  return (
    <section className="card">
      <h2>Deadline rules</h2>
      <p className="muted small">
        The due date of a complaint is when it was reported plus the resolution hours of its priority. A change applies to complaints
        reported (or re-prioritised) from now on; the deadline of existing complaints stays as it is. The escalation interval takes effect at once.
      </p>
      <Message>{error?.message}</Message>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Priority</th><th>Resolution hours</th><th>Escalation interval (hours)</th><th /></tr></thead>
          <tbody>{(data?.rules ?? []).map((r) => <RuleRow key={r.priority} rule={r} onSaved={reload} />)}</tbody>
        </table>
      </div>
    </section>
  );
}

function RuleRow({ rule, onSaved }) {
  const [resolution, setResolution] = useState(String(rule.resolutionHours));
  const [interval, setInterval] = useState(String(rule.escalationIntervalHours));
  const { state, busy, run } = useAction(onSaved);
  const changed = resolution !== String(rule.resolutionHours) || interval !== String(rule.escalationIntervalHours);
  return (
    <tr>
      <td><strong>{PRIORITY_LABEL[rule.priority]}</strong></td>
      <td><input type="number" min={1} max={8760} value={resolution} onChange={(e) => setResolution(e.target.value)} aria-label={`${rule.priority} resolution hours`} /></td>
      <td><input type="number" min={1} max={8760} value={interval} onChange={(e) => setInterval(e.target.value)} aria-label={`${rule.priority} escalation interval hours`} /></td>
      <td className="actions">
        <button type="button" className="primary" disabled={busy || !changed}
          onClick={() => run(() => api.patch(`/admin/deadline-rules/${rule.priority}`, { resolutionHours: Number(resolution), escalationIntervalHours: Number(interval) }), 'Saved.')}>Save</button>
        <Outcome state={state} />
      </td>
    </tr>
  );
}
