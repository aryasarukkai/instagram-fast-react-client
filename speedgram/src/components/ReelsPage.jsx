import { useCallback, useState } from 'react';
import { ChevronDown, ChevronUp, Heart, LoaderCircle, Maximize2, MessageCircle, MoreHorizontal, Music2, Send } from 'lucide-react';
import AppShell from './AppShell';
import PostViewer from './PostViewer';
import ShareSheet from './ShareSheet';
import Visual, { Avatar } from './Visual';
import { nativeClient } from '../nativeClient';
import { useResource } from '../useResource';
import { compactCount } from '../format';

const ReelsPage = () => {
  const [source, setSource] = useState('following');
  const [index, setIndex] = useState(0);
  const [liked, setLiked] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setEngageError] = useState(null);
  const [shareReel, setShareReel] = useState(null);
  const [viewingReel, setViewingReel] = useState(null);

  const loader = useCallback(() => nativeClient.reels({ source }), [source]);
  const { data, error: loadError, loading, reload } = useResource(loader);
  const reels = data?.items || [];
  const reel = reels[Math.min(index, Math.max(reels.length - 1, 0))];

  const step = (delta) => setIndex((current) => (current + delta + reels.length) % Math.max(reels.length, 1));

  const switchSource = (next) => { setSource(next); setIndex(0); };

  const toggleLike = async () => {
    if (!reel || busy) return;
    const wasLiked = Boolean(liked[reel.id] ?? reel.liked);
    const next = !wasLiked;
    setLiked((current) => ({ ...current, [reel.id]: next }));
    setBusy(true);
    setEngageError(null);
    try {
      if (next) await nativeClient.like(reel.id, reel.trackingToken ?? null);
      else await nativeClient.unlike(reel.id, reel.trackingToken ?? null);
    } catch (requestError) {
      setLiked((current) => ({ ...current, [reel.id]: wasLiked }));
      setEngageError(requestError?.message || 'Like failed.');
    } finally {
      setBusy(false);
    }
  };

  const isLiked = reel ? Boolean(liked[reel.id] ?? reel.liked) : false;

  return (
    <AppShell wide>
      <div className="reels-stage">
        <div className="reels-tabs">
          <button className={source === 'following' ? 'is-active' : ''} type="button" onClick={() => switchSource('following')}>Reels</button>
          <button className={source === 'explore' ? 'is-active' : ''} type="button" onClick={() => switchSource('explore')}>Discover</button>
        </div>

        {loading ? (
          <div className="state-card"><LoaderCircle className="spin" size={26} /><p>Loading reels</p></div>
        ) : loadError ? (
          <div className="state-card error"><p>{loadError}</p><button type="button" onClick={reload}>Try again</button></div>
        ) : !reel ? (
          <div className="state-card"><p>Instagram returned no reels right now.</p></div>
        ) : (
          <>
            <div className="reels-frame">
              <Visual
                className="reel-visual"
                rounded
                controls
                imageUrl={reel.imageUrl}
                videoUrl={reel.videoUrl}
                alt={`Reel by ${reel.user.username}`}
                seed={reel.id}
              >
                <footer className="reel-foot">
                  <Avatar src={reel.user.profilePictureUrl} username={reel.user.username} size={34} ring="story" />
                  <strong>{reel.user.username}</strong>
                  {reel.caption ? <p className="reel-caption">{reel.caption}</p> : null}
                  {reel.audio ? <p className="reel-audio"><Music2 size={13} /> {reel.audio}</p> : null}
                </footer>
              </Visual>

              <div className="reel-rail">
                <button
                  className={`reel-action${isLiked ? ' is-liked' : ''}`}
                  type="button"
                  onClick={toggleLike}
                  disabled={busy}
                  aria-label={isLiked ? 'Unlike reel' : 'Like reel'}
                >
                  <Heart size={28} strokeWidth={1.7} fill={isLiked ? 'currentColor' : 'none'} />
                  <small>{compactCount.format(reel.likeCount)}</small>
                </button>
                <button className="reel-action" type="button" onClick={() => setViewingReel(reel)} aria-label="Comments">
                  <MessageCircle size={28} strokeWidth={1.7} /><small>{compactCount.format(reel.commentCount)}</small>
                </button>
                <button className="reel-action" type="button" onClick={() => setShareReel(reel)} aria-label="Share">
                  <Send size={26} strokeWidth={1.7} />
                </button>
                <button className="reel-action" type="button" onClick={() => setViewingReel(reel)} aria-label="Open reel">
                  <Maximize2 size={23} strokeWidth={1.7} />
                </button>
                <button className="reel-action" type="button" disabled aria-label="More"><MoreHorizontal size={24} /></button>
                <div className="reel-stepper">
                  <button type="button" onClick={() => step(-1)} aria-label="Previous reel"><ChevronUp size={20} /></button>
                  <button type="button" onClick={() => step(1)} aria-label="Next reel"><ChevronDown size={20} /></button>
                </div>
              </div>
            </div>
            {error ? <p className="inline-error" role="status">{error}</p> : null}
            <p className="reels-hint">
              {index + 1} / {reels.length}
              {reel.viewCount ? ` · ${compactCount.format(reel.viewCount)} plays` : ''}
            </p>
          </>
        )}
      </div>
      {viewingReel ? (
        <PostViewer
          post={viewingReel}
          onClose={() => setViewingReel(null)}
          onShare={(post) => setShareReel(post)}
        />
      ) : null}
      {shareReel ? <ShareSheet mediaId={shareReel.id} onClose={() => setShareReel(null)} /> : null}
    </AppShell>
  );
};

export default ReelsPage;
