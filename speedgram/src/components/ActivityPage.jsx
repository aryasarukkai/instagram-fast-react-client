import { useCallback, useMemo, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import AppShell from './AppShell';
import Visual, { Avatar } from './Visual';
import { nativeClient } from '../nativeClient';
import { useResource } from '../useResource';
import { relativeTime } from '../format';

const isFollowRequest = (item) => (
  item.kind === 'private_user_follow_request'
  || Boolean(item.incomingRequest)
  || /requested to follow you/i.test(item.text || '')
);

const isNewFollower = (item) => (
  item.kind === 'user_followed'
  || /started following you/i.test(item.text || '')
);

const ActivityPage = () => {
  const loader = useCallback(() => nativeClient.activity(), []);
  const { data, error, loading, reload } = useResource(loader);
  const items = useMemo(() => data?.items || [], [data]);
  const [rowState, setRowState] = useState({});
  const [busyKey, setBusyKey] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [hidden, setHidden] = useState({});

  const { fresh, earlier } = useMemo(() => ({
    fresh: items.filter((item) => item.unread && !hidden[item.id]),
    earlier: items.filter((item) => !item.unread && !hidden[item.id]),
  }), [items, hidden]);

  const patchRow = (item, patch) => {
    setRowState((current) => ({
      ...current,
      [item.id]: { ...(current[item.id] || {}), ...patch },
    }));
  };

  const resolved = (item) => {
    const local = rowState[item.id] || {};
    return {
      following: local.following ?? Boolean(item.following),
      outgoingRequest: local.outgoingRequest ?? Boolean(item.outgoingRequest),
      incomingRequest: local.incomingRequest ?? Boolean(item.incomingRequest),
      accepted: Boolean(local.accepted),
      declined: Boolean(local.declined),
    };
  };

  const run = async (key, action) => {
    if (busyKey) return;
    setBusyKey(key);
    setActionError(null);
    try {
      await action();
    } catch (requestError) {
      setActionError(requestError?.message || 'That action failed.');
    } finally {
      setBusyKey(null);
    }
  };

  const acceptRequest = (item) => run(`accept:${item.id}`, async () => {
    await nativeClient.approveFollowRequest(item.userId);
    patchRow(item, { incomingRequest: false, accepted: true, following: false });
  });

  const declineRequest = (item) => run(`decline:${item.id}`, async () => {
    await nativeClient.declineFollowRequest(item.userId);
    patchRow(item, { incomingRequest: false, declined: true });
    setHidden((current) => ({ ...current, [item.id]: true }));
  });

  const followBack = (item) => run(`follow:${item.id}`, async () => {
    const result = await nativeClient.follow(item.userId);
    patchRow(item, {
      following: Boolean(result.following),
      outgoingRequest: Boolean(result.outgoingRequest),
      accepted: true,
    });
  });

  const unfollow = (item) => run(`unfollow:${item.id}`, async () => {
    const result = await nativeClient.unfollow(item.userId);
    patchRow(item, {
      following: Boolean(result.following),
      outgoingRequest: Boolean(result.outgoingRequest),
    });
  });

  const renderActions = (item) => {
    if (!item.userId) return null;
    const state = resolved(item);
    const request = isFollowRequest(item) && !state.accepted && !state.declined && (
      state.incomingRequest || item.kind === 'private_user_follow_request' || /requested to follow you/i.test(item.text || '')
    );

    if (request) {
      return (
        <div className="activity-actions">
          <button
            type="button"
            disabled={busyKey === `accept:${item.id}`}
            onClick={() => acceptRequest(item)}
          >
            {busyKey === `accept:${item.id}` ? '…' : 'Accept'}
          </button>
          <button
            type="button"
            className="is-secondary"
            disabled={busyKey === `decline:${item.id}`}
            onClick={() => declineRequest(item)}
          >
            {busyKey === `decline:${item.id}` ? '…' : 'Delete'}
          </button>
        </div>
      );
    }

    const showFollowBack = (state.accepted || isNewFollower(item)) && !state.following && !state.outgoingRequest;
    if (showFollowBack) {
      return (
        <button
          type="button"
          disabled={busyKey === `follow:${item.id}`}
          onClick={() => followBack(item)}
        >
          {busyKey === `follow:${item.id}` ? '…' : 'Follow'}
        </button>
      );
    }

    if ((state.accepted || isNewFollower(item)) && (state.following || state.outgoingRequest)) {
      return (
        <button
          type="button"
          className="is-secondary"
          disabled={busyKey === `unfollow:${item.id}`}
          onClick={() => unfollow(item)}
        >
          {busyKey === `unfollow:${item.id}` ? '…' : (state.outgoingRequest ? 'Requested' : 'Following')}
        </button>
      );
    }

    return null;
  };

  const renderRow = (item) => (
    <div className={`activity-row${item.unread ? ' is-unread' : ''}`} key={item.id}>
      {item.username ? (
        <Link to={`/profile/${item.username}`}>
          <Avatar src={item.profilePictureUrl} username={item.username} size={44} />
        </Link>
      ) : (
        <Avatar src={item.profilePictureUrl} username={item.username || 'user'} size={44} />
      )}
      <p>
        {item.text}
        {' '}
        <span>{relativeTime(item.timestamp)}</span>
      </p>
      {renderActions(item)}
      {item.thumbnailUrl ? <Visual className="activity-thumb" imageUrl={item.thumbnailUrl} alt="" seed={item.id} /> : null}
    </div>
  );

  return (
    <AppShell>
      <div className="activity-page">
        <h1>Notifications</h1>
        {actionError ? <p className="inline-error" role="status">{actionError}</p> : null}

        {loading ? (
          <div className="state-card"><LoaderCircle className="spin" size={24} /><p>Loading notifications</p></div>
        ) : error ? (
          <div className="state-card error"><p>{error}</p><button type="button" onClick={reload}>Try again</button></div>
        ) : !items.length ? (
          <div className="state-card"><p>No recent activity.</p></div>
        ) : (
          <>
            {fresh.length ? (
              <section aria-label="New notifications">
                <h2 className="activity-group">New</h2>
                {fresh.map(renderRow)}
              </section>
            ) : null}
            {earlier.length ? (
              <section aria-label="Earlier notifications">
                <h2 className="activity-group">Earlier</h2>
                {earlier.map(renderRow)}
              </section>
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  );
};

export default ActivityPage;
