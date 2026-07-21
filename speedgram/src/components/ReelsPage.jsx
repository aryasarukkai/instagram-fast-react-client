import { useCallback, useState } from 'react';
import { ChevronDown, ChevronUp, Heart, LoaderCircle, MessageCircle, MoreHorizontal, Music2, Send } from 'lucide-react';
import AppShell from './AppShell';
import Visual, { Avatar } from './Visual';
import { nativeClient } from '../nativeClient';
import { useResource } from '../useResource';
import { compactCount } from '../format';

const ReelsPage = () => {
  const [source, setSource] = useState('following');
  const [index, setIndex] = useState(0);
  const [liked, setLiked] = useState({});

  const loader = useCallback(() => nativeClient.reels({ source }), [source]);
  const { data, error, loading, reload } = useResource(loader);
  const reels = data?.items || [];
  const reel = reels[Math.min(index, Math.max(reels.length - 1, 0))];

  const step = (delta) => setIndex((current) => (current + delta + reels.length) % Math.max(reels.length, 1));

  const switchSource = (next) => { setSource(next); setIndex(0); };

  return (
    <AppShell wide>
      <div className="reels-stage">
        <div className="reels-tabs">
          <button className={source === 'following' ? 'is-active' : ''} type="button" onClick={() => switchSource('following')}>Reels</button>
          <button className={source === 'explore' ? 'is-active' : ''} type="button" onClick={() => switchSource('explore')}>Discover</button>
        </div>

        {loading ? (
          <div className="state-card"><LoaderCircle className="spin" size={26} /><p>Loading reels</p></div>
        ) : error ? (
          <div className="state-card error"><p>{error}</p><button type="button" onClick={reload}>Try again</button></div>
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
                  className={`reel-action${liked[reel.id] ? ' is-liked' : ''}`}
                  type="button"
                  onClick={() => setLiked((current) => ({ ...current, [reel.id]: !current[reel.id] }))}
                  aria-label="Like reel"
                  title="Liking arrives with the interaction milestone"
                >
                  <Heart size={28} strokeWidth={1.7} fill={liked[reel.id] ? 'currentColor' : 'none'} />
                  <small>{compactCount.format(reel.likeCount)}</small>
                </button>
                <button className="reel-action" type="button" disabled aria-label="Comments">
                  <MessageCircle size={28} strokeWidth={1.7} /><small>{compactCount.format(reel.commentCount)}</small>
                </button>
                <button className="reel-action" type="button" disabled aria-label="Share"><Send size={26} strokeWidth={1.7} /></button>
                <button className="reel-action" type="button" disabled aria-label="More"><MoreHorizontal size={24} /></button>
                <div className="reel-stepper">
                  <button type="button" onClick={() => step(-1)} aria-label="Previous reel"><ChevronUp size={20} /></button>
                  <button type="button" onClick={() => step(1)} aria-label="Next reel"><ChevronDown size={20} /></button>
                </div>
              </div>
            </div>
            <p className="reels-hint">
              {index + 1} / {reels.length}
              {reel.viewCount ? ` · ${compactCount.format(reel.viewCount)} plays` : ''}
            </p>
          </>
        )}
      </div>
    </AppShell>
  );
};

export default ReelsPage;
