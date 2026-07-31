import { useCallback, useEffect, useState } from 'react';
import {
  Bookmark,
  Heart,
  ImageOff,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  Music2,
  Maximize2,
  Plus,
  RefreshCw,
  Send,
} from 'lucide-react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import AppShell from './AppShell';
import PostViewer from './PostViewer';
import ShareSheet from './ShareSheet';
import FeedVideo from './FeedVideo';
import Visual, { Avatar } from './Visual';
import { feedCache, nativeClient } from '../nativeClient';
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

const PostCard = ({ post, onOpenPost, onShare, onEngageError }) => {
  const [liked, setLiked] = useState(Boolean(post.liked));
  const [saved, setSaved] = useState(Boolean(post.saved));
  const [likeCount, setLikeCount] = useState(post.likeCount || 0);
  const [busy, setBusy] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [following, setFollowing] = useState(null);
  const [outgoing, setOutgoing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const caption = post.caption || '';
  const clipped = caption.length > 140 && !expanded;
  const media = post.imageUrl || post.children?.[0]?.imageUrl;
  const video = post.videoUrl || post.children?.[0]?.videoUrl;
  const resolvedFollowing = following ?? Boolean(post.user?.following);
  const resolvedOutgoing = following == null ? Boolean(post.user?.outgoingRequest) : outgoing;
  // Only offer Follow when Instagram told us friendship status (home feed authors
  // are usually already followed and often omit the flag entirely).
  const showFollow = Boolean(post.user?.id)
    && Boolean(post.user?.friendshipKnown)
    && !resolvedFollowing
    && !resolvedOutgoing;

  const toggleLike = async () => {
    if (busy) return;
    const next = !liked;
    setLiked(next);
    setLikeCount((count) => Math.max(0, count + (next ? 1 : -1)));
    setBusy('like');
    try {
      if (next) await nativeClient.like(post.id, post.trackingToken ?? null);
      else await nativeClient.unlike(post.id, post.trackingToken ?? null);
    } catch (error) {
      setLiked(!next);
      setLikeCount((count) => Math.max(0, count + (next ? -1 : 1)));
      onEngageError?.(error?.message || 'Like failed.');
    } finally {
      setBusy(null);
    }
  };

  const toggleSave = async () => {
    if (busy) return;
    const next = !saved;
    setSaved(next);
    setBusy('save');
    try {
      if (next) await nativeClient.save(post.id, post.loggingInfoToken ?? null);
      else await nativeClient.unsave(post.id);
    } catch (error) {
      setSaved(!next);
      onEngageError?.(error?.message || 'Save failed.');
    } finally {
      setBusy(null);
    }
  };

  const followAuthor = async () => {
    if (!post.user?.id || followBusy) return;
    setFollowing(true);
    setOutgoing(false);
    setFollowBusy(true);
    try {
      const result = await nativeClient.follow(post.user.id);
      setFollowing(Boolean(result.following));
      setOutgoing(Boolean(result.outgoingRequest));
    } catch (error) {
      setFollowing(false);
      onEngageError?.(error?.message || 'Follow failed.');
    } finally {
      setFollowBusy(false);
    }
  };

  return (
    <article className="post">
      <header className="post-head">
        <Link to={`/profile/${post.user.username}`} className="post-author">
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
        </Link>
        {showFollow ? (
          <button
            type="button"
            className="post-follow"
            disabled={followBusy}
            onClick={followAuthor}
          >
            {followBusy ? '…' : 'Follow'}
          </button>
        ) : null}
        <button className="icon-button" type="button" aria-label="More options" disabled><MoreHorizontal size={20} /></button>
      </header>

      <div className="post-visual-wrap">
        {video ? (
          <FeedVideo
            className="post-visual"
            videoUrl={video}
            poster={media}
            alt={`Post by ${post.user.username}`}
          />
        ) : (
          <Visual
            className="post-visual"
            imageUrl={media}
            alt={`Post by ${post.user.username}`}
            seed={post.id}
          >
            {post.kind === 'carousel' && post.children?.length ? <span className="carousel-count">1 / {post.children.length}</span> : null}
          </Visual>
        )}
        <button className="post-expand" type="button" onClick={() => onOpenPost(post)} aria-label="Open post">
          <Maximize2 size={17} /> <span>Open</span>
        </button>
      </div>

      <div className="post-actions">
        <button
          className={`action${liked ? ' is-liked' : ''}`}
          type="button"
          onClick={toggleLike}
          disabled={busy === 'like'}
          aria-label={liked ? 'Unlike' : 'Like'}
        >
          <Heart size={24} strokeWidth={1.8} fill={liked ? 'currentColor' : 'none'} />
        </button>
        <button className="action" type="button" onClick={() => onOpenPost(post)} aria-label="Comments">
          <MessageCircle size={24} strokeWidth={1.8} />
        </button>
        <button className="action" type="button" onClick={() => onShare(post)} aria-label="Share">
          <Send size={22} strokeWidth={1.8} />
        </button>
        <button
          className={`action save${saved ? ' is-liked' : ''}`}
          type="button"
          onClick={toggleSave}
          disabled={busy === 'save'}
          aria-label={saved ? 'Unsave' : 'Save'}
        >
          <Bookmark size={23} strokeWidth={1.8} fill={saved ? 'currentColor' : 'none'} />
        </button>
      </div>

      <div className="post-body">
        {likeCount ? <strong className="like-count">{exact.format(likeCount)} likes</strong> : null}
        {caption ? (
          <p className="caption">
            <strong>{post.user.username}</strong>{' '}
            {clipped ? `${caption.slice(0, 140)}… ` : caption}
            {clipped ? <button type="button" className="caption-more" onClick={() => setExpanded(true)}>more</button> : null}
          </p>
        ) : null}
        {post.commentCount ? (
          <button className="view-comments" type="button" onClick={() => onOpenPost(post)}>
            View all {compact.format(post.commentCount)} comments
          </button>
        ) : null}
        <p className="post-time">{relativeTime(post.takenAt)}</p>
      </div>
    </article>
  );
};

PostCard.propTypes = {
  onEngageError: PropTypes.func,
  onOpenPost: PropTypes.func.isRequired,
  onShare: PropTypes.func.isRequired,
  post: PropTypes.object.isRequired,
};

const HomePage = () => {
  const { authState } = useAuth();
  const cached = feedCache.get();
  const [posts, setPosts] = useState(cached?.posts || []);
  const [cursor, setCursor] = useState(cached?.cursor ?? null);
  const [hasMore, setHasMore] = useState(cached?.hasMore ?? false);
  const [loading, setLoading] = useState(!cached);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [engageError, setEngageError] = useState(null);
  const [activePost, setActivePost] = useState(null);
  const [sharePost, setSharePost] = useState(null);
  const [showReload, setShowReload] = useState(false);

  const loadStories = useCallback(() => nativeClient.stories(), []);
  const stories = useResource(loadStories);

  const load = useCallback(async ({ reset = false } = {}) => {
    if (reset) setLoading(true); else setLoadingMore(true);
    setError(null);
    try {
      const page = await nativeClient.timeline(reset ? null : cursor);
      setPosts((current) => {
        const next = reset
          ? page.items
          : [...current, ...page.items.filter((item) => !current.some((post) => post.id === item.id))];
        feedCache.set({ posts: next, cursor: page.nextCursor, hasMore: page.hasMore });
        return next;
      });
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
      if (reset) setShowReload(false);
    } catch (requestError) {
      setError(requestError?.message || 'The home timeline could not be loaded.');
      if (requestError?.code === 'rate_limited') setHasMore(false);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [cursor]);

  // Reuse the cached feed across Home navigations; only fetch when there's none.
  useEffect(() => {
    if (!feedCache.get()) load({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState.user?.username]);

  // Surface a "reload" affordance once the feed is a couple minutes old.
  useEffect(() => {
    const entry = feedCache.get();
    if (!entry) return undefined;
    const remaining = Math.max(0, 120000 - (Date.now() - entry.fetchedAt));
    const timer = setTimeout(() => setShowReload(true), remaining);
    return () => clearTimeout(timer);
  }, [posts]);

  const reload = () => {
    document.querySelector('.feed-column')?.scrollTo?.({ top: 0, behavior: 'smooth' });
    load({ reset: true });
  };

  return (
    <AppShell>
      <div className="feed-layout">
        <div className="feed-column">
          {showReload && !loading ? (
            <button className="feed-reload" type="button" onClick={reload}>
              <RefreshCw size={15} /> Reload feed
            </button>
          ) : null}

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
              {posts.map((post) => (
                <PostCard
                  post={post}
                  key={post.id}
                  onOpenPost={setActivePost}
                  onShare={setSharePost}
                  onEngageError={setEngageError}
                />
              ))}
              {!posts.length ? <div className="state-card"><p>Instagram returned no posts for this page.</p></div> : null}
            </section>
          )}

          {engageError ? <p className="inline-error" role="status">{engageError}</p> : null}
          {error && posts.length ? <p className="inline-error" role="status">{error}</p> : null}
          {hasMore ? (
            <button className="load-more" type="button" disabled={loadingMore} onClick={() => load()}>
              {loadingMore ? <><LoaderCircle className="spin" size={16} /> Loading</> : 'Show more posts'}
            </button>
          ) : !loading && posts.length ? <p className="feed-end">You’re all caught up</p> : null}
        </div>

        <aside className="feed-side">
          <div className="side-account">
            <Avatar src={authState.user?.profilePictureUrl} username={authState.user?.username} size={56} />
            <div>
              <strong>{authState.user?.username}</strong>
              <small>{authState.user?.fullName || ''}</small>
            </div>
          </div>
          {stories.error ? <p className="side-footnote">Stories unavailable: {stories.error}</p> : null}
        </aside>
      </div>

      {activePost ? (
        <PostViewer
          post={activePost}
          onClose={() => setActivePost(null)}
          onShare={(post) => setSharePost(post)}
        />
      ) : null}
      {sharePost ? <ShareSheet mediaId={sharePost.id} post={sharePost} onClose={() => setSharePost(null)} /> : null}
    </AppShell>
  );
};

export default HomePage;
