import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, Link2, LoaderCircle, Search, Share2, X } from 'lucide-react';
import PropTypes from 'prop-types';
import { Avatar } from './Visual';
import { nativeClient } from '../nativeClient';
import ModalPortal from './ModalPortal';

// Sending to many people at once is still a write burst, so the sheet refuses to
// fan out further than this in a single Send.
const MAX_RECIPIENTS = 8;

const permalinkFor = (post) => (post?.code ? `https://www.instagram.com/p/${post.code}/` : null);

// Both the web ranked share sheet and the Direct-inbox fallback resolve to the same
// shape: a thread id, a title, and member avatar URLs. Sharing targets the thread —
// the web share sheet never exposes recipient user ids.
const normalizeThread = (thread) => ({
  threadId: thread.threadId || thread.id,
  title: thread.title || (thread.users || []).map((user) => user.username).join(', '),
  avatars: thread.avatars?.length
    ? thread.avatars
    : (thread.users || []).map((user) => user.profilePictureUrl).filter(Boolean),
  isGroup: Boolean(thread.isGroup),
});

/** Ranked share targets when a web session is present, Direct inbox otherwise. */
const loadTargets = async () => {
  try {
    const ranked = await nativeClient.shareTargets();
    if (ranked?.items?.length) return ranked.items.map(normalizeThread);
  } catch {
    // No web session (or the ranked query moved): the inbox is the fallback list.
  }
  const inbox = await nativeClient.threads();
  return (inbox.items || []).map(normalizeThread);
};

/**
 * Instagram-style share sheet: searchable recipient grid over a row of link
 * actions, with an explicit Send step rather than send-on-tap.
 */
const ShareSheet = ({ mediaId, post, threads: seededThreads, onClose, onShared }) => {
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState([]);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(null);
  const searchRef = useRef(null);

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const items = seededThreads?.length
          ? seededThreads.map(normalizeThread)
          : await loadTargets();
        if (!cancelled) setTargets(items);
      } catch (requestError) {
        if (!cancelled) setError(requestError?.message || 'Conversations could not be loaded.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [seededThreads]);

  // Sharing goes out as a Direct media message into an existing conversation, so
  // any thread with an id is a valid target — groups included.
  const candidates = useMemo(
    () => targets.filter((target) => target.threadId),
    [targets],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return candidates;
    return candidates.filter((target) => (target.title || '').toLowerCase().includes(needle));
  }, [candidates, query]);

  const toggle = (target) => {
    setError(null);
    setSelected((current) => {
      if (current.includes(target.threadId)) return current.filter((id) => id !== target.threadId);
      if (current.length >= MAX_RECIPIENTS) {
        setError(`Up to ${MAX_RECIPIENTS} people at a time.`);
        return current;
      }
      return [...current, target.threadId];
    });
  };

  const send = async () => {
    const chosen = candidates.filter((target) => selected.includes(target.threadId));
    if (!chosen.length || !mediaId) return;
    setSending(true);
    setError(null);
    const failures = [];
    // Sequential, never parallel: one Direct write at a time keeps the burst small
    // and lets a rate-limit response stop the rest.
    for (const target of chosen) {
      try {
        await nativeClient.shareMedia(mediaId, { threadId: target.threadId });
        onShared?.(target);
      } catch (requestError) {
        failures.push(target.title || 'someone');
        if (requestError?.code === 'rate_limited' || requestError?.code === 'feedback_required') break;
      }
    }
    setSending(false);
    if (failures.length) {
      setError(`Could not share to ${failures.join(', ')}.`);
      return;
    }
    onClose();
  };

  const copy = async (label, value) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setError('The link could not be copied.');
    }
  };

  const link = permalinkFor(post);
  const download = post?.videoUrl || post?.imageUrl || null;

  return <ModalPortal>
    <div className="sheet-scrim" role="dialog" aria-label="Share post">
      <button className="sheet-dismiss" type="button" aria-label="Close" onClick={onClose} />
      <div className="sheet share-sheet">
        <header className="sheet-head is-bare">
          <span className="sheet-grip" aria-hidden="true" />
          <button className="icon-button sheet-close" type="button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </header>

        <div className="share-search">
          <Search size={18} aria-hidden="true" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            aria-label="Search people to share with"
          />
        </div>

        <div className="sheet-body share-body">
          {loading ? (
            <p className="sheet-state"><LoaderCircle className="spin" size={18} /> Loading</p>
          ) : null}
          {!loading && !visible.length ? (
            <p className="sheet-state">
              {query.trim() ? 'Nobody matches that search.' : 'No Direct conversations available to share to.'}
            </p>
          ) : null}

          {visible.length ? (
            <ul className="share-grid">
              {visible.map((target) => {
                const isPicked = selected.includes(target.threadId);
                return (
                  <li key={target.threadId}>
                    <button
                      className={`share-card${isPicked ? ' is-picked' : ''}`}
                      type="button"
                      aria-pressed={isPicked}
                      disabled={sending}
                      onClick={() => toggle(target)}
                    >
                      <span className="share-card-photo">
                        <Avatar src={target.avatars?.[0]} username={target.title} size={74} />
                        {isPicked ? <span className="share-tick" aria-hidden="true"><Check size={13} /></span> : null}
                      </span>
                      <span className="share-card-name">{target.title}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        {error ? <p className="sheet-state error share-error">{error}</p> : null}

        {selected.length ? (
          <div className="share-send">
            <button className="share-send-button" type="button" onClick={send} disabled={sending}>
              {sending ? <LoaderCircle className="spin" size={16} /> : null}
              {sending ? 'Sending' : `Send${selected.length > 1 ? ` to ${selected.length}` : ''}`}
            </button>
          </div>
        ) : (
          <div className="share-actions">
            <button className="share-action" type="button" onClick={() => copy('link', link)} disabled={!link}>
              <span className="share-action-icon"><Link2 size={22} /></span>
              {copied === 'link' ? 'Copied' : 'Copy link'}
            </button>
            <a
              className={`share-action${download ? '' : ' is-disabled'}`}
              href={download || undefined}
              download
              target="_blank"
              rel="noreferrer"
              aria-disabled={download ? undefined : 'true'}
            >
              <span className="share-action-icon"><Download size={22} /></span>
              Download
            </a>
            <button
              className="share-action"
              type="button"
              disabled={!link}
              onClick={async () => {
                if (navigator.share && link) {
                  try {
                    await navigator.share({ url: link });
                    return;
                  } catch {
                    // Dismissed or unsupported — fall through to the clipboard.
                  }
                }
                copy('share', link);
              }}
            >
              <span className="share-action-icon"><Share2 size={22} /></span>
              {copied === 'share' ? 'Copied' : 'Share to…'}
            </button>
          </div>
        )}
      </div>
    </div>
  </ModalPortal>;
};

ShareSheet.propTypes = {
  mediaId: PropTypes.string.isRequired,
  onClose: PropTypes.func.isRequired,
  onShared: PropTypes.func,
  post: PropTypes.object,
  threads: PropTypes.array,
};

export default ShareSheet;
