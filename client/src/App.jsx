import { useEffect, useState } from 'react';

// M0 placeholder: proves the client is served and can reach the API through the Vite proxy.
// Real routes (Login and the four portals) are added in M8.
export default function App() {
  const [health, setHealth] = useState('checking...');

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((body) => setHealth(body.status))
      .catch(() => setHealth('server unreachable'));
  }, []);

  return (
    <main style={{ fontFamily: 'sans-serif', margin: '2rem' }}>
      <h1>CampusFix</h1>
      <p>NMIMS Indore campus complaint management.</p>
      <p>API status: <strong>{health}</strong></p>
    </main>
  );
}
