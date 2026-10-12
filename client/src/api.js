// The only place that talks to the server (the REST API of docs/06). Every call carries the JWT
// from localStorage. A 401 on a logged-in session clears the token and tells the app to show the
// login page again (see auth.jsx).
const TOKEN_KEY = 'campusfix_token';

// localStorage can throw (private windows, blocked storage): fall back to "not logged in".
export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(token) {
  try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details; // per-field messages of a 400, e.g. { categoryId: 'category is required' }
  }
}

async function request(method, path, body) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body instanceof FormData) {
    payload = body; // the browser sets the multipart boundary itself
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is it running?');
  }
  if (res.status === 401 && token && path !== '/auth/login') {
    setToken(null);
    window.dispatchEvent(new Event('campusfix:unauthorized'));
  }
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText, data?.details);
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body = {}) => request('POST', path, body),
  patch: (path, body = {}) => request('PATCH', path, body),

  // Photos need the Authorization header, so they are fetched as a blob instead of used as <img src>.
  async photoBlob(complaintId) {
    const res = await fetch(`/api/complaints/${complaintId}/photo`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) throw new ApiError(res.status, 'Photo not available');
    return res.blob();
  },
};

// GET /api/complaints with filters: { status: ['A','B'], priority: [...], category, block, from, to }
export function complaintQuery(filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (Array.isArray(value) ? value.length : value) params.set(key, Array.isArray(value) ? value.join(',') : value);
  }
  const text = params.toString();
  return `/complaints${text ? `?${text}` : ''}`;
}
