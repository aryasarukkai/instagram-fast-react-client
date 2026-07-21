import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CornerUpLeft, LoaderCircle, Palette, Phone, Send, SquarePen, Video, X } from 'lucide-react';
import PropTypes from 'prop-types';
import AppShell from './AppShell';
import Visual, { Avatar } from './Visual';
import { nativeClient } from '../nativeClient';
import { useAuth } from '../auth/AuthContext';
import { useResource } from '../useResource';
import { clockTime, relativeTime } from '../format';

// Chat themes are a SpeedGram-local preference: Instagram's own thread themes
// are not exposed by the private API, so these never sync to the phone.
const THEMES = [
  { id: 'default', label: 'Default', swatch: 'linear-gradient(135deg, #262626, #121212)' },
  { id: 'love', label: 'Love', swatch: 'linear-gradient(135deg, #ff3b6b, #b4004e)' },
  { id: 'aurora', label: 'Aurora', swatch: 'linear-gradient(135deg, #7c4dff, #21d4fd)' },
  { id: 'sunset', label: 'Sunset', swatch: 'linear-gradient(135deg, #ff9966, #ff5e62)' },
  { id: 'forest', label: 'Forest', swatch: 'linear-gradient(135deg, #43cea2, #185a9d)' },
  { id: 'mono', label: 'Monochrome', swatch: 'linear-gradient(135deg, #4b4b4b, #0d0d0d)' },
];

const THEME_KEY = 'speedgram:chat-themes';

const readThemes = () => {
  try {
    return JSON.parse(window.localStorage?.getItem(THEME_KEY) || '{}');
  } catch {
    return {};
  }
};

const ThemePicker = ({ value, onChange, onClose }) => (
  <div className="theme-picker" role="dialog" aria-label="Chat theme">
    <div className="theme-picker-head">
      <strong>Chat theme</strong>
      <button type="button" onClick={onClose}>Done</button>
    </div>
    <div className="theme-grid">
      {THEMES.map((theme) => (
        <button
          className={`theme-swatch${value === theme.id ? ' is-active' : ''}`}
          key={theme.id}
          type="button"
          onClick={() => onChange(theme.id)}
        >
          <span style={{ background: theme.swatch }} />
          {theme.label}
        </button>
      ))}
    </div>
    <p className="theme-note">Saved on this Mac only — Instagram does not expose thread themes.</p>
  </div>
);

ThemePicker.propTypes = { onChange: PropTypes.func.isRequired, onClose: PropTypes.func.isRequired, value: PropTypes.string.isRequired };

const ReplyButton = ({ message, onReply }) => (
  <button className="bubble-reply-btn" type="button" onClick={() => onReply(message)} aria-label="Reply">
    <CornerUpLeft size={15} />
  </button>
);
ReplyButton.propTypes = { message: PropTypes.object.isRequired, onReply: PropTypes.func.isRequired };

const Reactions = ({ reactions }) => (
  reactions?.length ? <span className="bubble-reactions">{reactions.join(' ')}</span> : null
);
Reactions.propTypes = { reactions: PropTypes.array };

const Bubble = ({ message, participants, isNew, onReply, showAvatar, showName }) => {
  const author = participants[message.userId];
  const pop = isNew ? ' bubble--pop' : '';
  const canReply = Boolean(message.text || message.share);
  const leading = message.mine ? null : (showAvatar
    ? <Avatar src={author?.profilePictureUrl} username={author?.username} size={26} />
    : <span className="avatar-spacer" aria-hidden="true" />);

  if (message.share) {
    return (
      <div className={`bubble-row${message.mine ? ' is-mine' : ''}${pop}`}>
        {leading}
        <div className="bubble-media">
          <Visual
            className="bubble-visual"
            rounded
            imageUrl={message.share.imageUrl}
            videoUrl={message.share.videoUrl}
            alt={`Shared post by ${message.share.user?.username || 'someone'}`}
            seed={message.share.id}
          />
          {message.share.user?.username ? <span className="bubble-share-author">{message.share.user.username}</span> : null}
          <Reactions reactions={message.reactions} />
        </div>
        {canReply ? <ReplyButton message={message} onReply={onReply} /> : null}
      </div>
    );
  }
  if (!message.text) {
    return (
      <div className={`bubble-row${message.mine ? ' is-mine' : ''}${pop}`}>
        {leading}
        <div className={`bubble is-meta${message.mine ? ' is-mine' : ''}`}>
          <p>{message.kind.replace(/_/g, ' ')}</p>
          <Reactions reactions={message.reactions} />
        </div>
      </div>
    );
  }
  return (
    <div className={`bubble-row${message.mine ? ' is-mine' : ''}${pop}`}>
      {leading}
      <div className={`bubble${message.mine ? ' is-mine' : ''}`}>
        {showName && author && !message.mine ? <small className="bubble-author">{author.username}</small> : null}
        {message.reply ? <span className="bubble-reply-quote">{message.reply}</span> : null}
        <p>{message.text}</p>
        <Reactions reactions={message.reactions} />
      </div>
      {canReply ? <ReplyButton message={message} onReply={onReply} /> : null}
    </div>
  );
};

Bubble.propTypes = {
  isNew: PropTypes.bool,
  message: PropTypes.object.isRequired,
  onReply: PropTypes.func.isRequired,
  participants: PropTypes.object.isRequired,
  showAvatar: PropTypes.bool,
  showName: PropTypes.bool,
};

const Direct = () => {
  const { authState } = useAuth();
  const [activeId, setActiveId] = useState(null);
  const [themes, setThemes] = useState(readThemes);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [extra, setExtra] = useState({});
  const [justSentId, setJustSentId] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const messagesRef = useRef(null);

  const threadsLoader = useCallback(() => nativeClient.threads(), []);
  const notesLoader = useCallback(() => nativeClient.notes(), []);
  const threads = useResource(threadsLoader);
  const notes = useResource(notesLoader);

  const items = useMemo(() => threads.data?.items || [], [threads.data]);
  useEffect(() => {
    if (!activeId && items.length) setActiveId(items[0].id);
  }, [activeId, items]);

  const conversation = items.find((item) => item.id === activeId) || null;
  const theme = themes[activeId] || 'default';

  const messagesLoader = useCallback(
    () => (activeId ? nativeClient.thread(activeId) : Promise.resolve({ items: [] })),
    [activeId],
  );
  const messages = useResource(messagesLoader, { skip: !activeId });

  const participants = useMemo(() => Object.fromEntries((conversation?.users || []).map((user) => [user.id, user])), [conversation]);
  const thread = [...(messages.data?.items || conversation?.messages || []), ...(extra[activeId] || [])];

  // Jump to the newest message when a conversation opens or its history loads.
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeId, messages.data]);

  // Smoothly follow the thread down when a message is sent.
  const sentCount = extra[activeId]?.length || 0;
  useEffect(() => {
    if (!sentCount) return;
    const el = messagesRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [sentCount]);

  // Keep the latest message visible when the reply bar opens/closes.
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [replyingTo]);

  // Poll for new messages so incoming DMs appear without a manual reload.
  useEffect(() => {
    const timer = setInterval(() => {
      threads.reload?.();
      messages.reload?.();
    }, 15000);
    return () => clearInterval(timer);
  }, [threads, messages]);

  const chooseTheme = (id) => {
    const next = { ...themes, [activeId]: id };
    setThemes(next);
    try {
      window.localStorage?.setItem(THEME_KEY, JSON.stringify(next));
    } catch {
      // Preference is best-effort; the session keeps working without it.
    }
  };

  const handleReply = (message) => {
    setReplyingTo({
      id: message.id,
      username: message.mine ? 'yourself' : (participants[message.userId]?.username || conversation?.title || 'message'),
      preview: message.text || (message.share ? 'Shared post' : 'Attachment'),
    });
  };

  const send = async (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !activeId) return;
    setSending(true);
    setSendError(null);
    try {
      const result = await nativeClient.sendMessage(activeId, text, replyingTo?.id ?? null);
      setExtra((current) => ({ ...current, [activeId]: [...(current[activeId] || []), result.message] }));
      setJustSentId(result.message?.id ?? null);
      setDraft('');
      setReplyingTo(null);
    } catch (error) {
      setSendError(error?.message || 'The message could not be sent.');
    } finally {
      setSending(false);
    }
  };

  return (
    <AppShell wide>
      <div className="direct-layout">
        <section className="dm-list" aria-label="Conversations">
          <header className="dm-list-head">
            <strong>{authState.user?.username}</strong>
            <button className="icon-button" type="button" disabled aria-label="New message"><SquarePen size={20} /></button>
          </header>

          {notes.data?.items?.length ? (
            <div className="dm-notes" aria-label="Notes">
              {notes.data.items.map((note) => (
                <button className="dm-note" type="button" key={note.id} disabled>
                  <span className="note-bubble">{note.text}</span>
                  <Avatar src={note.user.profilePictureUrl} username={note.user.username} size={54} />
                  <small>{note.user.username}</small>
                </button>
              ))}
            </div>
          ) : null}

          <div className="dm-section"><strong>Messages</strong></div>

          {threads.loading ? <p className="dm-state"><LoaderCircle className="spin" size={18} /> Loading</p> : null}
          {threads.error ? <p className="dm-state error">{threads.error}</p> : null}

          {items.map((item) => (
            <button
              className={`dm-row${item.id === activeId ? ' is-active' : ''}`}
              key={item.id}
              type="button"
              onClick={() => { setActiveId(item.id); setPickerOpen(false); setSendError(null); setReplyingTo(null); }}
            >
              <Avatar
                src={item.users[0]?.profilePictureUrl}
                username={item.users[0]?.username || item.title}
                size={54}
              />
              <span className="dm-copy">
                <strong>{item.title}</strong>
                <small className={item.unread ? 'is-unread' : ''}>
                  {item.messages[item.messages.length - 1]?.text || 'Attachment'} · {relativeTime(item.lastActivityAt)}
                </small>
              </span>
              {item.unread ? <i className="dm-dot" aria-label="Unread" /> : null}
            </button>
          ))}
        </section>

        <section className={`dm-thread theme-${theme}`} aria-label={conversation ? `Conversation with ${conversation.title}` : 'Conversation'}>
          {conversation ? (
            <>
              <header className="dm-thread-head">
                <Avatar src={conversation.users[0]?.profilePictureUrl} username={conversation.users[0]?.username} size={34} />
                <div>
                  <strong>{conversation.title}</strong>
                  <small>{conversation.isGroup ? `${conversation.users.length} people` : 'Direct message'}</small>
                </div>
                <button className="icon-button" type="button" onClick={() => setPickerOpen((open) => !open)} aria-label="Chat theme"><Palette size={20} /></button>
                <button className="icon-button" type="button" disabled aria-label="Audio call"><Phone size={20} /></button>
                <button className="icon-button" type="button" disabled aria-label="Video call"><Video size={20} /></button>
              </header>

              <div className="dm-backdrop" aria-hidden="true"><span className="glow one" /><span className="glow two" /><span className="spark" /></div>

              <div className="dm-messages" ref={messagesRef}>
                {messages.loading ? <p className="dm-state"><LoaderCircle className="spin" size={18} /> Loading messages</p> : null}
                {messages.error ? <p className="dm-state error">{messages.error}</p> : null}
                {thread.map((message, index) => {
                  const prev = thread[index - 1];
                  const next = thread[index + 1];
                  const gapFromPrev = prev && prev.timestamp && message.timestamp && message.timestamp - prev.timestamp > 900;
                  const gapToNext = next && next.timestamp && message.timestamp && next.timestamp - message.timestamp > 900;
                  const contPrev = prev && prev.mine === message.mine && prev.userId === message.userId && !gapFromPrev;
                  const contNext = next && next.mine === message.mine && next.userId === message.userId && !gapToNext;
                  const showTime = message.timestamp && (!prev || gapFromPrev);
                  return (
                    <div key={message.id} className={`dm-msg${contPrev ? '' : ' group-start'}`}>
                      {showTime ? <p className="dm-time">{clockTime(message.timestamp)}</p> : null}
                      <Bubble
                        message={message}
                        participants={participants}
                        isNew={message.id === justSentId}
                        onReply={handleReply}
                        showAvatar={!contNext}
                        showName={conversation?.isGroup && !contPrev}
                      />
                    </div>
                  );
                })}
              </div>

              {pickerOpen ? <ThemePicker value={theme} onChange={chooseTheme} onClose={() => setPickerOpen(false)} /> : null}

              {sendError ? <p className="dm-state error">{sendError}</p> : null}

              {replyingTo ? (
                <div className="dm-reply-bar">
                  <div className="dm-reply-copy">
                    <small>Replying to {replyingTo.username}</small>
                    <span>{replyingTo.preview}</span>
                  </div>
                  <button type="button" onClick={() => setReplyingTo(null)} aria-label="Cancel reply"><X size={16} /></button>
                </div>
              ) : null}

              <form className="dm-compose" onSubmit={send}>
                <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Message..." aria-label="Message" />
                <button className="icon-button" type="submit" disabled={sending || !draft.trim()} aria-label="Send message">
                  {sending ? <LoaderCircle className="spin" size={19} /> : <Send size={19} />}
                </button>
              </form>
            </>
          ) : (
            <div className="state-card"><p>{threads.loading ? 'Loading conversations' : 'Select a conversation'}</p></div>
          )}
        </section>
      </div>
    </AppShell>
  );
};

export default Direct;
