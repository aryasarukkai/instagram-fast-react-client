import { useEffect, useState } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import PropTypes from 'prop-types';
import { Avatar } from './Visual';
import { nativeClient } from '../nativeClient';
import ModalPortal from './ModalPortal';

/**
 * Pick a Direct recipient (1:1 peer pk) to share media to.
 * Uses already-loaded threads when provided; otherwise fetches inbox.
 */
const ShareSheet = ({ mediaId, threads: seededThreads, onClose, onShared }) => {
  const [threads, setThreads] = useState(seededThreads || []);
  const [loading, setLoading] = useState(!seededThreads?.length);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    if (seededThreads?.length) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const page = await nativeClient.threads();
        if (!cancelled) setThreads(page.items || []);
      } catch (requestError) {
        if (!cancelled) setError(requestError?.message || 'Conversations could not be loaded.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [seededThreads]);

  const shareTo = async (thread) => {
    const peer = (thread.users || []).find((user) => user.id) || thread.users?.[0];
    if (!peer?.id || !mediaId) {
      setError('That conversation cannot receive a share.');
      return;
    }
    setBusyId(thread.id);
    setError(null);
    try {
      await nativeClient.shareMedia(mediaId, peer.id);
      onShared?.(thread);
      onClose();
    } catch (requestError) {
      setError(requestError?.message || 'The post could not be shared.');
    } finally {
      setBusyId(null);
    }
  };

  const candidates = threads.filter((thread) => !thread.isGroup && thread.users?.[0]?.id);

  return <ModalPortal>
    <div className="sheet-scrim" role="dialog" aria-label="Share post">
      <button className="sheet-dismiss" type="button" aria-label="Close" onClick={onClose} />
      <div className="sheet share-sheet">
        <header className="sheet-head">
          <span className="sheet-grip" />
          <h2>Share</h2>
          <button className="icon-button sheet-close" type="button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </header>
        <div className="sheet-body">
          {loading ? (
            <p className="sheet-state"><LoaderCircle className="spin" size={18} /> Loading</p>
          ) : null}
          {error ? <p className="sheet-state error">{error}</p> : null}
          {!loading && !candidates.length ? (
            <p className="sheet-state">No Direct conversations available to share to.</p>
          ) : null}
          {candidates.map((thread) => (
            <button
              className="share-row"
              type="button"
              key={thread.id}
              disabled={Boolean(busyId)}
              onClick={() => shareTo(thread)}
            >
              <Avatar
                src={thread.users[0]?.profilePictureUrl}
                username={thread.users[0]?.username || thread.title}
                size={44}
              />
              <span>
                <strong>{thread.title}</strong>
                <small>{thread.users[0]?.username}</small>
              </span>
              {busyId === thread.id ? <LoaderCircle className="spin" size={16} /> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  </ModalPortal>;
};

ShareSheet.propTypes = {
  mediaId: PropTypes.string.isRequired,
  onClose: PropTypes.func.isRequired,
  onShared: PropTypes.func,
  threads: PropTypes.array,
};

export default ShareSheet;
