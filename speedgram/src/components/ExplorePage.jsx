import { useCallback } from 'react';
import { Copy, LoaderCircle, PlayCircle } from 'lucide-react';
import AppShell from './AppShell';
import Visual from './Visual';
import { nativeClient } from '../nativeClient';
import { useResource } from '../useResource';

const ExplorePage = () => {
  const loader = useCallback(() => nativeClient.explore(), []);
  const { data, error, loading, reload } = useResource(loader);
  const items = data?.items || [];

  return (
    <AppShell wide>
      <div className="explore-page">
        {loading ? (
          <div className="state-card"><LoaderCircle className="spin" size={26} /><p>Loading Explore</p></div>
        ) : error ? (
          <div className="state-card error"><p>{error}</p><button type="button" onClick={reload}>Try again</button></div>
        ) : !items.length ? (
          <div className="state-card"><p>Instagram returned no Explore posts right now.</p></div>
        ) : (
          <div className="explore-grid">
            {items.map((item) => (
              <button className="explore-tile" type="button" key={item.id} disabled title="Opening posts arrives in a later milestone">
                <Visual imageUrl={item.imageUrl} alt={`Post by ${item.user.username}`} seed={item.id} />
                {item.kind === 'video' ? <PlayCircle className="tile-kind" size={18} /> : null}
                {item.kind === 'carousel' ? <Copy className="tile-kind" size={17} /> : null}
              </button>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default ExplorePage;
