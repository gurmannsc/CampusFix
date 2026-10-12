// Login state for the whole app: who is logged in, login(), logout(), and the route guard.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, getToken, setToken } from './api.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

// Where each role lands after login (the four portals of the architecture diagram).
export const HOME = { STUDENT: '/portal', FACULTY: '/portal', STAFF: '/staff', SUPERVISOR: '/supervisor', ADMIN: '/admin' };

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(Boolean(getToken())); // true while we ask the server who the token belongs to

  useEffect(() => {
    if (!getToken()) return;
    api.get('/me').then((r) => setUser(r.user)).catch(() => setToken(null)).finally(() => setChecking(false));
  }, []);

  // api.js fires this when the server answers 401 (token expired, user deleted, ...).
  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener('campusfix:unauthorized', onUnauthorized);
    return () => window.removeEventListener('campusfix:unauthorized', onUnauthorized);
  }, []);

  const login = useCallback(async (email, password) => {
    const r = await api.post('/auth/login', { email, password });
    setToken(r.token);
    setUser(r.user);
    return r.user;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, checking, login, logout }}>{children}</AuthContext.Provider>;
}

// Wraps a page: not logged in -> login page (and back afterwards); wrong role -> that role's own home.
export function RequireRole({ roles, children }) {
  const { user, checking } = useAuth();
  const location = useLocation();
  if (checking) return <p className="muted center">Loading…</p>;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={HOME[user.role]} replace />;
  return children;
}
