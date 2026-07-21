import { useCallback } from 'react';
import { LoaderCircle } from 'lucide-react';
import AppShell from './AppShell';
import Visual, { Avatar } from './Visual';
import { nativeClient } from '../nativeClient';
import { useResource } from '../useResource';
import { relativeTime } from '../format';

const ActivityPage = () => {
  const loader = useCallback(() => nativeClient.activity(), []);
  const { data, error, loading, reload } = useResource(loader);
  const items = data?.items || [];

  return (
    <AppShell>
      <div className="activity-page">
        <h1>Notifications</h1>

        {loading ? (
          <div className="state-card"><LoaderCircle className="spin" size={24} /><p>Loading notifications</p></div>
        ) : error ? (
          <div className="state-card error"><p>{error}</p><button type="button" onClick={reload}>Try again</button></div>
        ) : !items.length ? (
          <div className="state-card"><p>No recent activity.</p></div>
        ) : items.map((item) => (
          <div className={`activity-row${item.unread ? ' is-unread' : ''}`} key={item.id}>
            <Avatar src={item.profilePictureUrl} username={item.username} size={44} />
            <p>{item.text} <span>{relativeTime(item.timestamp)}</span></p>
            {item.thumbnailUrl ? <Visual className="activity-thumb" imageUrl={item.thumbnailUrl} alt="" seed={item.id} /> : null}
          </div>
        ))}
      </div>
    </AppShell>
  );
};

export default ActivityPage;
