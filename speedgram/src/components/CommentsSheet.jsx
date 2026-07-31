import { useCallback, useEffect, useMemo, useState } from 'react';
import { Heart, LoaderCircle, X } from 'lucide-react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { Avatar } from './Visual';
import { nativeClient } from '../nativeClient';
import { useAuth } from '../auth/AuthContext';
import { useResource } from '../useResource';
import { compactCount, relativeTime } from '../format';
import ModalPortal from './ModalPortal';

// Instagram ships the reaction row with the comments response; this is the
// fallback for the mobile backend, which does not return one.
const FALLBACK_EMOJIS = ['❤️', '😍', '🔥', '👏', '😢', '😮', '😂', '💯'];

/**
 * One comment: avatar column, meta/text/Reply stack, like column on the right —
 * the layout Instagram's mobile comment sheet uses at both levels.
 */
const CommentRow = ({ comment, isReply = false, onError }) => {
  const [liked, setLiked] = useState(Boolean(comment.liked));
  const [likeCount, setLikeCount] = useState(comment.likeCount || 0);
  const [busy, setBusy] = useState(false);

  const toggleLike = async () => {
    if (busy) return;
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
    <article className={`comment${isReply ? ' is-reply' : ''}`}>
      <Link to={`/profile/${comment.user.username}`} className="comment-avatar-link">
        <Avatar src={comment.user.profilePictureUrl} username={comment.user.username} size={isReply ? 32 : 40} />
      </Link>
      <div className="comment-body">
        <p className="comment-meta">
          <Link to={`/profile/${comment.user.username}`}><strong>{comment.user.username}</strong></Link>
          {' '}
          <span>{relativeTime(comment.createdAt)}</span>
        </p>
        <p className="comment-text">{comment.text}</p>
        {/* Writing comments is a later milestone; the affordance stays inert. */}
        <button className="comment-reply" type="button" disabled>Reply</button>
      </div>
      <button
        className={`comment-like${liked ? ' is-liked' : ''}`}
        type="button"
        disabled={busy}
        onClick={toggleLike}
        aria-label={liked ? `Unlike ${comment.user.username}'s comment` : `Like ${comment.user.username}'s comment`}
      >
        <Heart size={17} fill={liked ? 'currentColor' : 'none'} />
        {likeCount ? <small>{compactCount.format(likeCount)}</small> : null}
      </button>
    </article>
  );
};

CommentRow.propTypes = {
  comment: PropTypes.object.isRequired,
  isReply: PropTypes.bool,
  onError: PropTypes.func,
};

/** A top-level comment plus its collapsible reply thread. */
const CommentThread = ({ comment, mediaId, inlineReplies, onError }) => {
  const [open, setOpen] = useState(false);
  const [replies, setReplies] = useState(inlineReplies);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [threadError, setThreadError] = useState(null);
  const [total, setTotal] = useState(comment.replyCount ?? inlineReplies.length);

  const fetchReplies = async (nextCursor = null) => {
    setLoading(true);
    setThreadError(null);
    try {
      const page = await nativeClient.commentReplies(mediaId, comment.id, nextCursor);
      setReplies((current) => (nextCursor ? [...current, ...(page.items || [])] : page.items || []));
      setCursor(page.nextCursor || null);
      if (page.replyCount) setTotal(page.replyCount);
    } catch (requestError) {
      setThreadError(requestError?.message || 'Replies could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    // The preview replies Instagram inlines are a teaser; load the real thread once.
    if (!cursor && replies.length <= inlineReplies.length) void fetchReplies(null);
  };

  const hasThread = total > 0 || replies.length > 0;

  return (
    <div className="comment-thread">
      <CommentRow comment={comment} onError={onError} />

      {open && replies.length ? (
        <div className="comment-replies">
          {replies.map((reply) => (
            <CommentRow key={reply.id} comment={reply} isReply onError={onError} />
          ))}
        </div>
      ) : null}

      {threadError ? <p className="comment-thread-error">{threadError}</p> : null}

      {hasThread ? (
        <button className="comment-more" type="button" onClick={toggle} disabled={loading}>
          <i aria-hidden="true" />
          {loading && !replies.length ? 'Loading replies'
            : open ? 'Hide replies'
              : `View ${total} ${total === 1 ? 'reply' : 'replies'}`}
        </button>
      ) : null}

      {open && cursor ? (
        <button className="comment-more" type="button" onClick={() => fetchReplies(cursor)} disabled={loading}>
          <i aria-hidden="true" />
          {loading ? 'Loading replies' : 'View more replies'}
        </button>
      ) : null}
    </div>
  );
};

CommentThread.propTypes = {
  comment: PropTypes.object.isRequired,
  inlineReplies: PropTypes.array.isRequired,
  mediaId: PropTypes.string.isRequired,
  onError: PropTypes.func,
};

const CommentsSheet = ({ post, onClose }) => {
  const { authState } = useAuth();
  const [engageError, setEngageError] = useState(null);

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const loader = useCallback(() => nativeClient.comments(post.id), [post.id]);
  const { data, error, loading } = useResource(loader);
  const fetched = useMemo(() => data?.items || [], [data]);

  // Replies arrive flattened alongside their parents; group them so each thread
  // renders under the comment it answers instead of as a loose top-level row.
  const repliesByParent = useMemo(() => {
    const map = {};
    for (const comment of fetched) {
      if (!comment.replyTo) continue;
      (map[comment.replyTo] ||= []).push(comment);
    }
    return map;
  }, [fetched]);

  const roots = useMemo(() => fetched.filter((comment) => !comment.replyTo), [fetched]);
  const emojis = data?.quickEmojis?.length ? data.quickEmojis.slice(0, 8) : FALLBACK_EMOJIS;

  return <ModalPortal>
    <div className="sheet-scrim" role="dialog" aria-label={`Comments on ${post.user.username}'s post`}>
      <button className="sheet-dismiss" type="button" aria-label="Close comments" onClick={onClose} />
      <section className="sheet comments-sheet">
        <header className="sheet-head">
          <span className="sheet-grip" aria-hidden="true" />
          <h2>Comments</h2>
          <button className="icon-button sheet-close" type="button" aria-label="Close" onClick={onClose}><X size={20} /></button>
        </header>

        <div className="sheet-body">
          {loading ? <p className="sheet-state"><LoaderCircle className="spin" size={20} /> Loading comments</p> : null}
          {error ? <p className="sheet-state error">{error}</p> : null}
          {!loading && !error && !roots.length ? <p className="sheet-state">No comments yet.</p> : null}

          {roots.map((comment) => (
            <CommentThread
              key={comment.id}
              comment={comment}
              mediaId={post.id}
              inlineReplies={repliesByParent[comment.id] || []}
              onError={setEngageError}
            />
          ))}
        </div>

        {engageError ? <p className="sheet-state error comment-action-error">{engageError}</p> : null}

        <div className="sheet-reactions" aria-hidden="true">
          {emojis.map((emoji, index) => (
            <span className="reaction-chip" key={`${emoji}-${index}`}>{emoji}</span>
          ))}
        </div>

        <form className="sheet-compose" onSubmit={(event) => event.preventDefault()}>
          <Avatar username={authState?.user?.username || ''} size={32} />
          <input
            placeholder="Commenting arrives with the interaction milestone"
            aria-label="Add a comment"
            disabled
          />
        </form>
      </section>
    </div>
  </ModalPortal>;
};

CommentsSheet.propTypes = { onClose: PropTypes.func.isRequired, post: PropTypes.object.isRequired };

export default CommentsSheet;
