import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bookmark,
  Heart,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  Send,
  X,
} from 'lucide-react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { nativeClient } from '../nativeClient';
import { compactCount, exactCount, relativeTime } from '../format';
import { useResource } from '../useResource';
import ModalPortal from './ModalPortal';
import Visual, { Avatar } from './Visual';

const Comment = ({ comment, onError }) => {
  const [liked, setLiked] = useState(Boolean(comment.liked));
  const [likeCount, setLikeCount] = useState(comment.likeCount || 0);
  const [busy, setBusy] = useState(false);

  const toggleLike = async () => {
    if (busy || !comment.id) return;
    const next = !liked;
    setLiked(next);
    setLikeCount((count) => Math.max(0, count + (next ? 1 : -1)));
    setBusy(true);
    try {
      if (next) await nativeClient.likeComment(comment.id);
      else await nativeClient.unlikeComment(comment.id);
    } catch (error) {
      setLiked(!next);
      setLikeCount((count) => Math.max(0, count + (next ? -1 : 1)));
      onError?.(error?.message || 'Comment like failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="viewer-comment">
      <Link to={`/profile/${comment.user.username}`} className="viewer-comment-avatar">
        <Avatar src={comment.user.profilePictureUrl} username={comment.user.username} size={34} />
      </Link>
      <div>
        <p>
          <Link to={`/profile/${comment.user.username}`}><strong>{comment.user.username}</strong></Link>
          {' '}
          {comment.text}
        </p>
        <span>
          {relativeTime(comment.createdAt)}
          {likeCount ? ` · ${compactCount.format(likeCount)} likes` : ''}
        </span>
      </div>
      <button
        className={`viewer-comment-like${liked ? ' is-liked' : ''}`}
        type="button"
        disabled={busy}
        onClick={toggleLike}
        aria-label={liked ? `Unlike ${comment.user.username}'s comment` : `Like ${comment.user.username}'s comment`}
      >
        <Heart size={14} fill={liked ? 'currentColor' : 'none'} />
      </button>
    </article>
  );
};

Comment.propTypes = { comment: PropTypes.object.isRequired, onError: PropTypes.func };

const LikeSummary = ({ likedBy, likeCount }) => {
  const named = likedBy.find((user) => user.username);
  const pictured = likedBy.filter((user) => user.profilePictureUrl).slice(0, 3);
  if (!named) return likeCount ? <strong className="viewer-like-count">{exactCount.format(likeCount)} likes</strong> : null;
  const others = Math.max(0, likeCount - 1);
  return (
    <div className="viewer-like-summary">
      {pictured.length ? (
        <span className="viewer-like-facepile" aria-hidden="true">
          {pictured.map((user) => (
            <Avatar key={user.id || user.username || user.profilePictureUrl} src={user.profilePictureUrl} username={user.username} size={24} />
          ))}
        </span>
      ) : null}
      <span>Liked by <strong>{named.username}</strong>{others ? <> and <strong>{exactCount.format(others)} others</strong></> : null}</span>
    </div>
  );
};

LikeSummary.propTypes = { likedBy: PropTypes.array.isRequired, likeCount: PropTypes.number.isRequired };

const PostViewer = ({ post, onClose, onShare }) => {
  const { authState } = useAuth();
  const [liked, setLiked] = useState(Boolean(post.liked));
  const [saved, setSaved] = useState(Boolean(post.saved));
  const [likeCount, setLikeCount] = useState(post.likeCount || 0);
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [following, setFollowing] = useState(null);
  const [outgoing, setOutgoing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const closeRef = useRef(null);
  const media = post.imageUrl || post.children?.[0]?.imageUrl;
  const video = post.videoUrl || post.children?.[0]?.videoUrl;
  const isSelf = Boolean(
    post.user?.username
    && authState.user?.username
    && post.user.username === authState.user.username,
  );
  const resolvedFollowing = following ?? Boolean(post.user?.following);
  const resolvedOutgoing = following == null ? Boolean(post.user?.outgoingRequest) : outgoing;
  const showFollow = Boolean(post.user?.id)
    && !isSelf
    && Boolean(post.user?.friendshipKnown)
    && !resolvedFollowing
    && !resolvedOutgoing;

  const commentsLoader = useCallback(() => nativeClient.comments(post.id), [post.id]);
  const comments = useResource(commentsLoader);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggleLike = async () => {
    if (busy) return;
    const next = !liked;
    setLiked(next);
    setLikeCount((count) => Math.max(0, count + (next ? 1 : -1)));
    setBusy('like');
    setActionError(null);
    try {
      if (next) await nativeClient.like(post.id, post.trackingToken ?? null);
      else await nativeClient.unlike(post.id, post.trackingToken ?? null);
    } catch (error) {
      setLiked(!next);
      setLikeCount((count) => Math.max(0, count + (next ? -1 : 1)));
      setActionError(error?.message || 'The like could not be updated.');
    } finally {
      setBusy(null);
    }
  };

  const toggleSave = async () => {
    if (busy) return;
    const next = !saved;
    setSaved(next);
    setBusy('save');
    setActionError(null);
    try {
      if (next) await nativeClient.save(post.id, post.loggingInfoToken ?? null);
      else await nativeClient.unsave(post.id);
    } catch (error) {
      setSaved(!next);
      setActionError(error?.message || 'The save could not be updated.');
    } finally {
      setBusy(null);
    }
  };

  const toggleFollow = async () => {
    if (!post.user?.id || followBusy || isSelf) return;
    const wasFollowing = resolvedFollowing;
    const wasOutgoing = resolvedOutgoing;
    setFollowing(!wasFollowing && !wasOutgoing);
    setOutgoing(false);
    setFollowBusy(true);
    setActionError(null);
    try {
      if (wasFollowing || wasOutgoing) {
        const result = await nativeClient.unfollow(post.user.id);
        setFollowing(Boolean(result.following));
        setOutgoing(Boolean(result.outgoingRequest));
      } else {
        const result = await nativeClient.follow(post.user.id);
        setFollowing(Boolean(result.following));
        setOutgoing(Boolean(result.outgoingRequest));
      }
    } catch (error) {
      setFollowing(wasFollowing);
      setOutgoing(wasOutgoing);
      setActionError(error?.message || 'Follow action failed.');
    } finally {
      setFollowBusy(false);
    }
  };

  const followLabel = resolvedFollowing ? 'Following' : (resolvedOutgoing ? 'Requested' : 'Follow');

  return <ModalPortal>
    <div className="post-viewer-scrim" role="dialog" aria-modal="true" aria-label={`Post by ${post.user?.username || 'Instagram user'}`}>
      <button className="post-viewer-dismiss" type="button" onClick={onClose} aria-label="Close post" />
      <button ref={closeRef} className="post-viewer-close" type="button" onClick={onClose} aria-label="Close">
        <X size={22} />
      </button>

      <section className={`post-viewer${video || post.kind === 'video' ? ' is-video' : ''}`}>
        <div className="post-viewer-media">
          <Visual
            imageUrl={media}
            videoUrl={video}
            controls
            alt={`Post by ${post.user?.username || 'Instagram user'}`}
            label="This media is no longer available"
            seed={post.id}
          >
            {post.kind === 'carousel' && post.children?.length ? (
              <span className="carousel-count">1 / {post.children.length}</span>
            ) : null}
          </Visual>
        </div>

        <aside className="post-viewer-panel">
          <header className="post-viewer-head">
            <Link to={`/profile/${post.user?.username || ''}`} className="post-viewer-identity">
              <Avatar src={post.user?.profilePictureUrl} username={post.user?.username} size={38} ring="story" />
              <div>
                <strong>{post.user?.username || 'instagram'}</strong>
                {post.location || post.audio ? <small>{post.location || post.audio}</small> : null}
              </div>
            </Link>
            {!isSelf && post.user?.id && (resolvedFollowing || resolvedOutgoing || showFollow) ? (
              <button
                type="button"
                className={`post-viewer-follow${resolvedFollowing || resolvedOutgoing ? ' is-following' : ''}`}
                disabled={followBusy}
                onClick={toggleFollow}
              >
                {followBusy ? '…' : followLabel}
              </button>
            ) : null}
            <button className="icon-button" type="button" disabled aria-label="More options"><MoreHorizontal size={19} /></button>
          </header>

          <div className="post-viewer-comments" aria-label="Comments">
            {post.caption ? (
              <article className="viewer-comment is-caption">
                <Avatar src={post.user?.profilePictureUrl} username={post.user?.username} size={34} />
                <div>
                  <p><strong>{post.user?.username || 'instagram'}</strong> {post.caption}</p>
                  <span>{relativeTime(post.takenAt)}</span>
                </div>
              </article>
            ) : null}

            {comments.loading ? <p className="viewer-state"><LoaderCircle className="spin" size={18} /> Loading comments</p> : null}
            {comments.error ? (
              <div className="viewer-state is-error"><span>{comments.error}</span><button type="button" onClick={comments.reload}>Try again</button></div>
            ) : null}
            {!comments.loading && !comments.error && !comments.data?.items?.length ? (
              <div className="viewer-empty"><MessageCircle size={24} /><strong>No comments yet</strong><span>Be the first to start the conversation.</span></div>
            ) : null}
            {(comments.data?.items || []).map((comment) => (
              <Comment key={comment.id} comment={comment} onError={setActionError} />
            ))}
          </div>

          <footer className="post-viewer-footer">
            <div className="post-viewer-actions">
              <button className={liked ? 'is-liked' : ''} type="button" onClick={toggleLike} disabled={busy === 'like'} aria-label={liked ? 'Unlike' : 'Like'}>
                <Heart size={24} fill={liked ? 'currentColor' : 'none'} />
              </button>
              <button type="button" aria-label="Comments"><MessageCircle size={23} /></button>
              <button type="button" onClick={() => onShare(post)} aria-label="Share"><Send size={22} /></button>
              <button className={`viewer-save${saved ? ' is-saved' : ''}`} type="button" onClick={toggleSave} disabled={busy === 'save'} aria-label={saved ? 'Unsave' : 'Save'}>
                <Bookmark size={23} fill={saved ? 'currentColor' : 'none'} />
              </button>
            </div>
            <LikeSummary likedBy={post.likedBy || []} likeCount={likeCount} />
            {actionError ? <p className="viewer-action-error" role="status">{actionError}</p> : null}
            <form className="post-viewer-compose" onSubmit={(event) => event.preventDefault()}>
              {authState.user?.profilePictureUrl ? (
                <Avatar src={authState.user.profilePictureUrl} username={authState.user.username} size={30} />
              ) : null}
              <input aria-label="Add a comment" placeholder="Add a comment…" disabled />
              <button type="submit" disabled>Post</button>
            </form>
          </footer>
        </aside>
      </section>
    </div>
  </ModalPortal>;
};

PostViewer.propTypes = {
  onClose: PropTypes.func.isRequired,
  onShare: PropTypes.func.isRequired,
  post: PropTypes.object.isRequired,
};

export default PostViewer;
