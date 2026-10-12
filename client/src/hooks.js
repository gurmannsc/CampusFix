import { useCallback, useEffect, useState } from 'react';

// Loads data when the page opens (and whenever `deps` change). reload() fetches again.
//   const { data, error, loading, reload } = useLoad(() => api.get('/complaints'), []);
export function useLoad(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false; // ignore the answer if the page changed meanwhile
    setState((s) => ({ ...s, loading: true }));
    loader()
      .then((data) => !cancelled && setState({ data, error: null, loading: false }))
      .catch((error) => !cancelled && setState({ data: null, error, loading: false }));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
