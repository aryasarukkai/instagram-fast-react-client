import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Load one protocol resource with explicit loading and error states.
 * `loader` must be stable (wrap it in useCallback in the caller).
 */
export const useResource = (loader, { skip = false } = {}) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!skip);
  const [refreshing, setRefreshing] = useState(false);
  const requestId = useRef(0);
  const inFlight = useRef(null);

  const reload = useCallback(async (options = {}) => {
    if (inFlight.current) return inFlight.current;
    const background = options?.background === true;
    const currentRequest = ++requestId.current;
    if (background) setRefreshing(true);
    else {
      setLoading(true);
      setError(null);
    }
    const request = (async () => {
      try {
        const result = await loader();
        if (currentRequest === requestId.current) {
          setData(result);
          setError(null);
        }
        return result;
      } catch (requestError) {
        // A transient background miss should not replace already-useful content
        // with an error screen. The next scheduled sync can recover quietly.
        if (!background && currentRequest === requestId.current) {
          setError(requestError?.message || 'Instagram did not return this data.');
        }
        return null;
      } finally {
        if (currentRequest === requestId.current) {
          if (background) setRefreshing(false);
          else setLoading(false);
        }
        if (currentRequest === requestId.current) inFlight.current = null;
      }
    })();
    inFlight.current = request;
    return request;
  }, [loader]);

  useEffect(() => {
    if (skip) {
      requestId.current += 1;
      inFlight.current = null;
      setLoading(false);
      return;
    }
    void reload();
    return () => {
      requestId.current += 1;
      inFlight.current = null;
    };
  }, [reload, skip]);

  return { data, error, loading, refreshing, reload };
};

export default useResource;
