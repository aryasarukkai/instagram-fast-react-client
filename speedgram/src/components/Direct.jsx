import { useCallback, useEffect, useMemo, useState } from 'react';
import { LoaderCircle, Palette, Phone, Send, SquarePen, Video } from 'lucide-react';
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

const Bubble = ({ message, participants }) => {
  const author = participants[message.userId];
  if (message.share) {
    return (
      <div className={`bubble-row${message.mine ? ' is-mine' : ''}`}>
        {!message.mine ? <Avatar src={author?.profilePictureUrl} username={author?.username} size={26} /> : null}
        <div className="bubble-media">
          <Visual
            className="bubble-visual"
            rounded
            imageUrl={message.share.imageUrl}
            alt={`Shared post by ${message.share.user.username}`}
            seed={message.share.id}
          />
          <span className="bubble-share-author">{message.share.user.username}</span>
        </div>
      </div>
    );
  }
  if (!message.text) {
    return (
      <div className={`bubble-row${message.mine ? ' is-mine' : ''}`}>
        <div className={`bubble is-meta${message.mine ? ' is-mine' : ''}`}><p>{message.kind.replace(/_/g, ' ')}</p></div>
      </div>
    );
  }
  return (
    <div className={`bubble-row${message.mine ? ' is-mine' : ''}`}>
      {!message.mine ? <Avatar src={author?.profilePictureUrl} username={author?.username} size={26} /> : null}
      <div className={`bubble${message.mine ? ' is-mine' : ''}`}>
        {author && !message.mine ? <small className="bubble-author">{author.username}</small> : null}
        <p>{message.text}</p>
      </div>
    </div>
  );
};

Bubble.propTypes = { message: PropTypes.object.isRequired, participants: PropTypes.object.isRequired };

const Direct = () => {
  const { authState } = useAuth();
  const [activeId, setActiveId] = useState(null);
  const [themes, setThemes] = useState(readThemes);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [extra, setExtra] = useState({});

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

  const chooseTheme = (id) => {
    const next = { ...themes, [activeId]: id };
    setThemes(next);
    try {
      window.localStorage?.setItem(THEME_KEY, JSON.stringify(next));
    } catch {
      // Preference is best-effort; the session keeps working without it.
    }
  };

  const send = async (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !activeId) return;
    setSending(true);
    setSendError(null);
    try {
      const result = await nativeClient.sendMessage(activeId, text);
      setExtra((current) => ({ ...current, [activeId]: [...(current[activeId] || []), result.message] }));
      setDraft('');
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
              onClick={() => { setActiveId(item.id); setPickerOpen(false); setSendError(null); }}
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

              <div className="dm-messages">
                {messages.loading ? <p className="dm-state"><LoaderCircle className="spin" size={18} /> Loading messages</p> : null}
                {messages.error ? <p className="dm-state error">{messages.error}</p> : null}
                {thread.map((message) => (
                  <div key={message.id}>
                    <p className="dm-time">{clockTime(message.timestamp)}</p>
                    <Bubble message={message} participants={participants} />
                  </div>
                ))}
              </div>

              {pickerOpen ? <ThemePicker value={theme} onChange={chooseTheme} onClose={() => setPickerOpen(false)} /> : null}

              {sendError ? <p className="dm-state error">{sendError}</p> : null}

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
