import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Heart, LoaderCircle, MessageCircle, MoreHorizontal, Music2, Send } from 'lucide-react';
import PropTypes from 'prop-types';
import AppShell from './AppShell';
import FeedVideo from './FeedVideo';
import PostViewer from './PostViewer';
import ShareSheet from './ShareSheet';
import { Avatar } from './Visual';
import { nativeClient } from '../nativeClient';
import { compactCount } from '../format';

const ReelSlide = ({ reel, onComments, onShare, onEngageError }) => {
  const [liked, setLiked] = useState(Boolean(reel.liked));
  const [likeCount, setLikeCount] = useState(reel.likeCount || 0);
  const [busy, setBusy] = useState(false);

  const toggleLike = async () => {
    if (busy) return;
    const next = !liked;
    setLiked(next);
    setLikeCount((count) => Math.max(0, count + (next ? 1 : -1)));
    setBusy(true);
    try {
      if (next) await nativeClient.like(reel.id, reel.trackingToken ?? null);
      else await nativeClient.unlike(reel.id, reel.trackingToken ?? null);
    } catch (error) {
      setLiked(!next);
      setLikeCount((count) => Math.max(0, count + (next ? -1 : 1)));
      onEngageError?.(error?.message || 'Like failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="reel-slide">
      <div className="reel-stage">
        <FeedVideo
          className="reel-visual"
          rounded
          videoUrl={reel.videoUrl}
          poster={reel.imageUrl}
          alt={`Reel by ${reel.user.username}`}
        >
          <footer className="reel-foot">
            <div className="reel-foot-author">
              <Avatar src={reel.user.profilePictureUrl} username={reel.user.username} size={34} ring="story" />
              <strong>{reel.user.username}</strong>
              {reel.user.verified ? <span className="verified" title="Verified">✓</span> : null}
            </div>
            {reel.caption ? <p className="reel-caption">{reel.caption}</p> : null}
            {reel.audio ? <p className="reel-audio"><Music2 size={13} /> {reel.audio}</p> : null}
          </footer>
        </FeedVideo>

        <div className="reel-rail">
          <button
            className={`reel-action${liked ? ' is-liked' : ''}`}
            type="button"
            onClick={toggleLike}
            disabled={busy}
            aria-label={liked ? 'Unlike reel' : 'Like reel'}
          >
            <Heart size={30} strokeWidth={1.7} fill={liked ? 'currentColor' : 'none'} />
            <small>{compactCount.format(likeCount)}</small>
          </button>
          <button className="reel-action" type="button" onClick={() => onComments(reel)} aria-label="Comments">
            <MessageCircle size={30} strokeWidth={1.7} /><small>{compactCount.format(reel.commentCount)}</small>
          </button>
          <button className="reel-action" type="button" onClick={() => onShare(reel)} aria-label="Share">
            <Send size={28} strokeWidth={1.7} />
          </button>
          <button className="reel-action" type="button" disabled aria-label="More"><MoreHorizontal size={26} /></button>
        </div>
      </div>
    </section>
  );
};

ReelSlide.propTypes = {
  onComments: PropTypes.func.isRequired,
  onEngageError: PropTypes.func,
  onShare: PropTypes.func.isRequired,
  reel: PropTypes.object.isRequired,
};

const ReelsPage = () => {
  const [reels, setReels] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [engageError, setEngageError] = useState(null);
  const [viewingReel, setViewingReel] = useState(null);
  const [shareReel, setShareReel] = useState(null);

  const viewportRef = useRef(null);
  const sentinelRef = useRef(null);
  // Live refs so the paginator and observer read fresh values without re-subscribing.
  const stateRef = useRef({ cursor: null, hasMore: true, loading: true, loadingMore: false, ids: [] });
  stateRef.current = { cursor, hasMore, loading, loadingMore, ids: reels.map((reel) => reel.id) };

  const load = useCallback(async ({ reset = false } = {}) => {
    const snapshot = stateRef.current;
    if (!reset && (!snapshot.hasMore || snapshot.loadingMore)) return;
    if (reset) setLoading(true); else setLoadingMore(true);
    setError(null);
    try {
      const page = await nativeClient.reels({
        cursor: reset ? null : snapshot.cursor,
        seenIds: reset ? [] : snapshot.ids,
      });
      setReels((current) => {
        if (reset) return page.items;
        const known = new Set(current.map((reel) => reel.id));
        return [...current, ...page.items.filter((reel) => !known.has(reel.id))];
      });
      setCursor(page.nextCursor);
      setHasMore(Boolean(page.hasMore));
    } catch (requestError) {
      setError(requestError?.message || 'Reels could not be loaded.');
      if (requestError?.code === 'rate_limited') setHasMore(false);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => { load({ reset: true }); }, [load]);

  // Prefetch the next page once the tail sentinel scrolls into view.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) load(); },
      { root: viewportRef.current, rootMargin: '600px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [load]);

  const scrollBySlide = useCallback((direction) => {
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollBy({ top: direction * viewport.clientHeight, behavior: 'smooth' });
  }, []);

  // Arrow keys step between reels, unless the user is typing in a field.
  useEffect(() => {
    const onKey = (event) => {
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;
      if (event.key === 'ArrowDown') { event.preventDefault(); scrollBySlide(1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); scrollBySlide(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scrollBySlide]);

  return (
    <AppShell wide>
      <div className="reels-page">
        {loading ? (
          <div className="state-card"><LoaderCircle className="spin" size={26} /><p>Loading reels</p></div>
        ) : error && !reels.length ? (
          <div className="state-card error"><p>{error}</p><button type="button" onClick={() => load({ reset: true })}>Try again</button></div>
        ) : !reels.length ? (
          <div className="state-card"><p>Instagram returned no reels right now.</p></div>
        ) : (
          <>
            <div className="reels-viewport" ref={viewportRef}>
              {reels.map((reel) => (
                <ReelSlide
                  reel={reel}
                  key={reel.id}
                  onComments={setViewingReel}
                  onShare={setShareReel}
                  onEngageError={setEngageError}
                />
              ))}
              <div className="reels-sentinel" ref={sentinelRef} aria-hidden="true">
                {loadingMore ? <LoaderCircle className="spin" size={22} /> : null}
                {!hasMore ? <p className="feed-end">You’re all caught up</p> : null}
              </div>
            </div>

            <div className="reels-nav">
              <button type="button" onClick={() => scrollBySlide(-1)} aria-label="Previous reel"><ChevronUp size={22} /></button>
              <button type="button" onClick={() => scrollBySlide(1)} aria-label="Next reel"><ChevronDown size={22} /></button>
            </div>
          </>
        )}
        {engageError ? <p className="inline-error reels-inline-error" role="status">{engageError}</p> : null}
      </div>

      {viewingReel ? (
        <PostViewer
          post={viewingReel}
          onClose={() => setViewingReel(null)}
          onShare={(post) => setShareReel(post)}
        />
      ) : null}
      {shareReel ? <ShareSheet mediaId={shareReel.id} post={shareReel} onClose={() => setShareReel(null)} /> : null}
    </AppShell>
  );
};

export default ReelsPage;
