import { useCallback, useEffect, useState } from 'react';
import {
  Bookmark,
  Heart,
  ImageOff,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  Music2,
  Plus,
  Send,
} from 'lucide-react';
import PropTypes from 'prop-types';
import AppShell from './AppShell';
import CommentsSheet from './CommentsSheet';
import Visual, { Avatar } from './Visual';
import { nativeClient } from '../nativeClient';
import { useAuth } from '../auth/AuthContext';
import { useResource } from '../useResource';
import { compactCount as compact, exactCount as exact, relativeTime } from '../format';


const StoryBubble = ({ story }) => (
  <button className="story" type="button" disabled title="Story playback arrives in a later milestone">
    <Avatar
      src={story.user.profilePictureUrl}
      username={story.user.username}
      size={62}
      ring={story.own ? 'none' : story.unseen ? 'story' : 'seen'}
    />
    {story.own ? <i className="story-add"><Plus size={13} strokeWidth={3} /></i> : null}
    <small>{story.own ? 'Your story' : story.user.username}</small>
  </button>
);

StoryBubble.propTypes = { story: PropTypes.object.isRequired };

const PostCard = ({ post, onOpenComments }) => {
  const [liked, setLiked] = useState(Boolean(post.liked));
  const [saved, setSaved] = useState(Boolean(post.saved));
  const [expanded, setExpanded] = useState(false);
  const caption = post.caption || '';
  const clipped = caption.length > 140 && !expanded;
  const media = post.imageUrl || post.children?.[0]?.imageUrl;
  const video = post.videoUrl || post.children?.[0]?.videoUrl;

  return (
    <article className="post">
      <header className="post-head">
        <Avatar src={post.user.profilePictureUrl} username={post.user.username} size={38} ring="story" />
        <div className="post-identity">
          <p>
            <strong>{post.user.username}</strong>
            {post.user.verified ? <span className="verified" title="Verified">✓</span> : null}
          </p>
          {post.location || post.kind === 'video' ? (
            <small>
              {post.kind === 'video' && !post.location ? <><Music2 size={11} /> {post.user.username} · audio</> : post.location}
            </small>
          ) : null}
        </div>
        <button className="icon-button" type="button" aria-label="More options" disabled><MoreHorizontal size={20} /></button>
      </header>

      <Visual
        className="post-visual"
        imageUrl={media}
        videoUrl={video}
        controls
        alt={`Post by ${post.user.username}`}
        seed={post.id}
      >
        {post.kind === 'carousel' && post.children?.length ? <span className="carousel-count">1 / {post.children.length}</span> : null}
      </Visual>

      <div className="post-actions">
        <button className={`action${liked ? ' is-liked' : ''}`} type="button" onClick={() => setLiked((value) => !value)} aria-label="Like" title="Liking arrives with the interaction milestone">
          <Heart size={24} strokeWidth={1.8} fill={liked ? 'currentColor' : 'none'} />
        </button>
        <button className="action" type="button" onClick={() => onOpenComments(post)} aria-label="Comments">
          <MessageCircle size={24} strokeWidth={1.8} />
        </button>
        <button className="action" type="button" disabled aria-label="Share"><Send size={22} strokeWidth={1.8} /></button>
        <button className={`action save${saved ? ' is-liked' : ''}`} type="button" onClick={() => setSaved((value) => !value)} aria-label="Save">
          <Bookmark size={23} strokeWidth={1.8} fill={saved ? 'currentColor' : 'none'} />
        </button>
      </div>

      <div className="post-body">
        {post.likeCount ? <strong className="like-count">{exact.format(post.likeCount)} likes</strong> : null}
        {caption ? (
          <p className="caption">
            <strong>{post.user.username}</strong>{' '}
            {clipped ? `${caption.slice(0, 140)}… ` : caption}
            {clipped ? <button type="button" className="caption-more" onClick={() => setExpanded(true)}>more</button> : null}
          </p>
        ) : null}
        {post.commentCount ? (
          <button className="view-comments" type="button" onClick={() => onOpenComments(post)}>
            View all {compact.format(post.commentCount)} comments
          </button>
        ) : null}
        <p className="post-time">{relativeTime(post.takenAt)}</p>
      </div>
    </article>
  );
};

PostCard.propTypes = { onOpenComments: PropTypes.func.isRequired, post: PropTypes.object.isRequired };

const HomePage = () => {
  const { authState } = useAuth();
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [activePost, setActivePost] = useState(null);

  const loadStories = useCallback(() => nativeClient.stories(), []);
  const stories = useResource(loadStories);

  const load = useCallback(async ({ reset = false } = {}) => {
    if (reset) setLoading(true); else setLoadingMore(true);
    setError(null);
    try {
      const page = await nativeClient.timeline(reset ? null : cursor);
      setPosts((current) => reset
        ? page.items
        : [...current, ...page.items.filter((item) => !current.some((post) => post.id === item.id))]);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (requestError) {
      setError(requestError?.message || 'The home timeline could not be loaded.');
      if (requestError?.code === 'rate_limited') setHasMore(false);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [cursor]);

  useEffect(() => {
    load({ reset: true });
    // The first request follows the signed-in account, not cursor changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState.user?.username]);

  return (
    <AppShell>
      <div className="feed-layout">
        <div className="feed-column">
          {stories.data?.items?.length ? (
            <section className="stories" aria-label="Stories">
              {stories.data.items.map((story) => <StoryBubble story={story} key={story.id} />)}
            </section>
          ) : null}

          {loading ? (
            <section className="state-card"><LoaderCircle className="spin" size={26} /><p>Loading your feed</p></section>
          ) : error && !posts.length ? (
            <section className="state-card error">
              <ImageOff size={26} /><p>{error}</p>
              <button type="button" onClick={() => load({ reset: true })}>Try again</button>
            </section>
          ) : (
            <section className="posts" aria-label="Posts">
              {posts.map((post) => <PostCard post={post} key={post.id} onOpenComments={setActivePost} />)}
              {!posts.length ? <div className="state-card"><p>Instagram returned no posts for this page.</p></div> : null}
            </section>
          )}

          {error && posts.length ? <p className="inline-error" role="status">{error}</p> : null}
          {hasMore ? (
            <button className="load-more" type="button" disabled={loadingMore} onClick={() => load()}>
              {loadingMore ? <><LoaderCircle className="spin" size={16} /> Loading</> : 'Show more posts'}
            </button>
          ) : !loading && posts.length ? <p className="feed-end">You’re all caught up</p> : null}
        </div>

        <aside className="feed-side">
          <div className="side-account">
            <Avatar username={authState.user?.username} size={56} />
            <div>
              <strong>{authState.user?.username}</strong>
              <small>{authState.user?.fullName || ''}</small>
            </div>
          </div>
          {stories.error ? <p className="side-footnote">Stories unavailable: {stories.error}</p> : null}
        </aside>
      </div>

      {activePost ? <CommentsSheet post={activePost} onClose={() => setActivePost(null)} /> : null}
    </AppShell>
  );
};

export default HomePage;
