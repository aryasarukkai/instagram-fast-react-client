import { useCallback, useEffect } from 'react';
import { Heart, LoaderCircle, X } from 'lucide-react';
import PropTypes from 'prop-types';
import { Avatar } from './Visual';
import { nativeClient } from '../nativeClient';
import { useResource } from '../useResource';
import { relativeTime } from '../format';
import ModalPortal from './ModalPortal';

const CommentsSheet = ({ post, onClose }) => {
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const loader = useCallback(() => nativeClient.comments(post.id), [post.id]);
  const { data, error, loading } = useResource(loader);
  const comments = data?.items || [];

  return <ModalPortal>
    <div className="sheet-scrim" role="dialog" aria-label={`Comments on ${post.user.username}'s post`}>
      <button className="sheet-dismiss" type="button" aria-label="Close comments" onClick={onClose} />
      <section className="sheet">
        <header className="sheet-head">
          <span className="sheet-grip" aria-hidden="true" />
          <h2>Comments</h2>
          <button className="icon-button sheet-close" type="button" aria-label="Close" onClick={onClose}><X size={20} /></button>
        </header>

        <div className="sheet-body">
          {loading ? <p className="sheet-state"><LoaderCircle className="spin" size={20} /> Loading comments</p> : null}
          {error ? <p className="sheet-state error">{error}</p> : null}
          {!loading && !error && !comments.length ? <p className="sheet-state">No comments yet.</p> : null}

          {comments.map((comment) => (
            <article className="comment" key={comment.id}>
              <Avatar src={comment.user.profilePictureUrl} username={comment.user.username} size={44} />
              <div className="comment-body">
                <p className="comment-meta"><strong>{comment.user.username}</strong> <span>{relativeTime(comment.createdAt)}</span></p>
                <p className="comment-text">{comment.text}</p>
                <button className="comment-reply" type="button" disabled>Reply</button>
              </div>
              <button className="comment-like" type="button" disabled aria-label={`Likes on ${comment.user.username}'s comment`}>
                <Heart size={18} fill={comment.liked ? 'currentColor' : 'none'} />
                {comment.likeCount ? <small>{comment.likeCount}</small> : null}
              </button>
            </article>
          ))}
        </div>

        <form className="sheet-compose" onSubmit={(event) => event.preventDefault()}>
          <input placeholder="Commenting arrives with the interaction milestone" aria-label="Add a comment" disabled />
        </form>
      </section>
    </div>
  </ModalPortal>;
};

CommentsSheet.propTypes = { onClose: PropTypes.func.isRequired, post: PropTypes.object.isRequired };

export default CommentsSheet;
