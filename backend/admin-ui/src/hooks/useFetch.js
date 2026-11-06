import { useEffect, useState } from 'react';
import api from '../lib/api';

export default function useFetch(url) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;

    async function run() {
      try {
        const response = await api.get(url);
        if (!live) return;
        setData(response.data);
        setError('');
      } catch (requestError) {
        if (!live) return;
        setError(requestError.response?.data?.error || requestError.message || 'REQUEST_FAILED');
      } finally {
        if (live) setLoading(false);
      }
    }

    run();
    const timer = window.setInterval(run, 10000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [url]);

  return { data, loading, error };
}
