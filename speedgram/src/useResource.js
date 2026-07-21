import { useCallback, useEffect, useState } from 'react';

/**
 * Load one protocol resource with explicit loading and error states.
 * `loader` must be stable (wrap it in useCallback in the caller).
 */
export const useResource = (loader, { skip = false } = {}) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!skip);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await loader());
    } catch (requestError) {
      setError(requestError?.message || 'Instagram did not return this data.');
    } finally {
      setLoading(false);
    }
  }, [loader]);

  useEffect(() => {
    if (skip) {
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    setError(null);
    loader()
      .then((result) => { if (live) setData(result); })
      .catch((requestError) => { if (live) setError(requestError?.message || 'Instagram did not return this data.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [loader, skip]);

  return { data, error, loading, reload };
};

export default useResource;
