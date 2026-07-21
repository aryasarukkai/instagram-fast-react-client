import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CornerUpLeft,
  Film,
  Forward,
  Images,
  Languages,
  Link2,
  LoaderCircle,
  Maximize2,
  Mic2,
  Palette,
  Phone,
  Play,
  Search,
  Send,
  SmilePlus,
  Sparkles,
  SquarePen,
  Video,
  X,
} from 'lucide-react';
import PropTypes from 'prop-types';
import AppShell from './AppShell';
import ModalPortal from './ModalPortal';
import PostViewer from './PostViewer';
import ShareSheet from './ShareSheet';
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

const REACTION_EMOJIS = ['😂', '👍', '❤️', '🔥', '😢'];
const THEME_KEY = 'speedgram:chat-themes';
let optimisticSequence = 0;

const readThemes = () => {
  try {
    return JSON.parse(window.localStorage?.getItem(THEME_KEY) || '{}');
  } catch {
    return {};
  }
};

const messageKey = (message) => message.messageId || message.id;

const scrollToNewest = (element, smooth = false) => {
  if (!element) return;
  if (typeof element.scrollTo === 'function') {
    element.scrollTo({ top: element.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  } else {
    element.scrollTop = element.scrollHeight;
  }
};

const optimisticMessageId = () => {
  optimisticSequence += 1;
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${optimisticSequence}`;
  return `pending:${random}`;
};

const unreconciledLocalMessages = (serverMessages, localMessages) => {
  const claimedServerMessages = new Set();
  return localMessages.filter((candidate) => {
    if (candidate.deliveryStatus) return true;
    const candidateKey = messageKey(candidate);
    const matchIndex = serverMessages.findIndex((serverMessage, index) => {
      if (claimedServerMessages.has(index)) return false;
      const serverKey = messageKey(serverMessage);
      if (candidateKey && serverKey && candidateKey === serverKey) return true;
      if (candidate.clientContext && serverMessage.clientContext) {
        return candidate.clientContext === serverMessage.clientContext;
      }
      return Boolean(
        candidate.mine
        && serverMessage.mine
        && candidate.text
        && candidate.text === serverMessage.text
        && candidate.timestamp
        && serverMessage.timestamp
        && Math.abs(candidate.timestamp - serverMessage.timestamp) <= 15,
      );
    });
    if (matchIndex < 0) return true;
    claimedServerMessages.add(matchIndex);
    return false;
  });
};

const attachmentLabel = (message) => {
  const shareType = message?.share?.shareType;
  const kind = message?.kind || message?.share?.kind || '';
  if (shareType === 'reel' || kind === 'clip' || kind === 'reel_share') return 'Reel';
  if (shareType === 'story' || kind === 'story_share') return 'Story';
  if (shareType === 'voice' || kind === 'voice_media') return 'Voice message';
  if (shareType === 'gif' || kind === 'animated_media') return 'GIF';
  if (shareType === 'link' || kind === 'link') return 'Link';
  if (shareType === 'disappearing' || kind === 'visual_media' || kind === 'raven_media') return 'Disappearing media';
  if (message?.share?.kind === 'carousel') return 'Carousel';
  if (message?.share?.kind === 'video' || kind === 'video') return 'Video';
  if (message?.share?.kind === 'image' || kind === 'photo') return shareType === 'post' ? 'Post' : 'Photo';
  if (message?.share) return 'Post';
  if (kind === 'profile') return 'Profile';
  return 'Attachment';
};

const messagePreview = (message) => {
  if (!message) return 'No messages yet';
  const text = message.text?.trim();
  if (text) return `${message.mine ? 'You: ' : ''}${text}`;
  const label = attachmentLabel(message);
  return message.mine ? `You sent a ${label.toLowerCase()}` : label;
};

const AttachmentIcon = ({ label, size = 14 }) => {
  if (label === 'Reel' || label === 'Video') return <Film size={size} />;
  if (label === 'Voice message') return <Mic2 size={size} />;
  if (label === 'Link') return <Link2 size={size} />;
  if (label === 'GIF') return <Sparkles size={size} />;
  return <Images size={size} />;
};

AttachmentIcon.propTypes = { label: PropTypes.string.isRequired, size: PropTypes.number };

const ThreadAvatar = ({ thread, size = 44 }) => {
  if (!thread?.isGroup || thread.threadImageUrl) {
    return (
      <Avatar
        src={thread?.threadImageUrl || thread?.users?.[0]?.profilePictureUrl}
        username={thread?.isGroup ? thread.title : (thread?.users?.[0]?.username || thread?.title)}
        size={size}
      />
    );
  }
  const members = (thread.users || []).slice(0, 3);
  return (
    <span className="group-avatar" style={{ '--group-avatar-size': `${size}px` }} aria-hidden="true">
      {members.map((member, index) => (
        <Avatar
          className={`group-avatar-member member-${index + 1}`}
          key={member.id || member.username || index}
          src={member.profilePictureUrl}
          username={member.username}
          size={Math.round(size * 0.64)}
        />
      ))}
    </span>
  );
};

ThreadAvatar.propTypes = { size: PropTypes.number, thread: PropTypes.object.isRequired };

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

const ThreadPicker = ({ title, threads, excludeId, onPick, onClose, busy }) => (
  <ModalPortal>
    <div className="sheet-scrim" role="dialog" aria-modal="true" aria-label={title}>
      <button className="sheet-dismiss" type="button" aria-label="Close" onClick={onClose} />
      <div className="sheet share-sheet">
        <header className="sheet-head">
          <span className="sheet-grip" />
          <h2>{title}</h2>
          <button className="icon-button sheet-close" type="button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </header>
        <div className="sheet-body">
          {threads.filter((thread) => thread.id !== excludeId).map((thread) => (
            <button
              className="share-row"
              type="button"
              key={thread.id}
              disabled={busy}
              onClick={() => onPick(thread)}
            >
              <ThreadAvatar thread={thread} size={44} />
              <span>
                <strong>{thread.title}</strong>
                <small>{thread.users[0]?.username || (thread.isGroup ? 'Group' : 'Direct')}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  </ModalPortal>
);

ThreadPicker.propTypes = {
  busy: PropTypes.bool,
  excludeId: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  onPick: PropTypes.func.isRequired,
  threads: PropTypes.array.isRequired,
  title: PropTypes.string.isRequired,
};

const BubbleActions = ({ message, onReply, onReact, onForward, onTranslate, reacting }) => (
  <div className="bubble-actions">
    <button className="bubble-reply-btn" type="button" onClick={() => onReply(message)} aria-label="Reply">
      <CornerUpLeft size={15} />
    </button>
    <div className="bubble-react-wrap">
      <button className="bubble-reply-btn" type="button" aria-label="React" disabled={reacting}>
        <SmilePlus size={15} />
      </button>
      <div className="bubble-react-menu" role="menu">
        {REACTION_EMOJIS.map((emoji) => (
          <button key={emoji} type="button" onClick={() => onReact(message, emoji)} aria-label={`React ${emoji}`}>
            {emoji}
          </button>
        ))}
      </div>
    </div>
    {message.text ? (
      <>
        <button className="bubble-reply-btn" type="button" onClick={() => onForward(message)} aria-label="Forward">
          <Forward size={15} />
        </button>
        <button className="bubble-reply-btn" type="button" onClick={() => onTranslate(message)} aria-label="Translate">
          <Languages size={15} />
        </button>
      </>
    ) : null}
  </div>
);

BubbleActions.propTypes = {
  message: PropTypes.object.isRequired,
  onForward: PropTypes.func.isRequired,
  onReact: PropTypes.func.isRequired,
  onReply: PropTypes.func.isRequired,
  onTranslate: PropTypes.func.isRequired,
  reacting: PropTypes.bool,
};

const Reactions = ({ reactions }) => (
  reactions?.length ? <span className="bubble-reactions">{reactions.join(' ')}</span> : null
);
Reactions.propTypes = { reactions: PropTypes.array };

const SharedMedia = ({ message, onOpen }) => {
  const { share } = message;
  const label = attachmentLabel(message);
  const username = share.user?.username && share.user.username !== 'instagram' ? share.user.username : null;
  const caption = share.caption?.trim();
  const isGif = label === 'GIF';
  return (
    <div className={`bubble-media is-${share.shareType || share.kind || 'post'}`}>
      <div className="bubble-share-head">
        <span><AttachmentIcon label={label} /> {label}</span>
        <div>
          {username ? <strong>@{username}</strong> : null}
          {!share.audioUrl ? (
            <button
              className="bubble-media-expand"
              type="button"
              onClick={() => onOpen(message)}
              onDoubleClick={(event) => event.stopPropagation()}
              aria-label={`Open ${label.toLowerCase()}`}
            >
              <Maximize2 size={15} />
            </button>
          ) : null}
        </div>
      </div>
      {share.audioUrl ? (
        <div className="bubble-audio">
          <Mic2 size={22} />
          <audio src={share.audioUrl} controls preload="metadata" />
        </div>
      ) : (
        <Visual
          className="bubble-visual"
          rounded
          controls={Boolean(share.videoUrl) && !isGif}
          autoPlay={isGif}
          loop={isGif}
          muted={isGif}
          imageUrl={share.imageUrl}
          videoUrl={share.videoUrl}
          label={`${label} preview unavailable`}
          alt={`${label} shared by ${username || 'someone'}`}
          seed={share.id}
        >
          {label === 'Reel' && !share.videoUrl ? <span className="bubble-media-play"><Play size={22} fill="currentColor" /></span> : null}
        </Visual>
      )}
      {caption ? <p className="bubble-share-caption">{caption}</p> : null}
      <Reactions reactions={message.reactions} />
    </div>
  );
};

SharedMedia.propTypes = { message: PropTypes.object.isRequired, onOpen: PropTypes.func.isRequired };

const Bubble = ({
  message,
  participants,
  isNew,
  onReply,
  onReact,
  onForward,
  onTranslate,
  onQuickLike,
  onOpenMedia,
  reacting,
  showAvatar,
  showName,
  translation,
  heartBurst,
}) => {
  const author = participants[message.userId];
  const pop = isNew ? ' bubble--pop' : '';
  const canAct = Boolean(messageKey(message)) && !message.deliveryStatus;
  const leading = message.mine ? null : (showAvatar
    ? <Avatar src={author?.profilePictureUrl} username={author?.username} size={26} />
    : <span className="avatar-spacer" aria-hidden="true" />);

  const actions = canAct ? (
    <BubbleActions
      message={message}
      onReply={onReply}
      onReact={onReact}
      onForward={onForward}
      onTranslate={onTranslate}
      reacting={reacting}
    />
  ) : null;

  if (message.share) {
    return (
      <div
        className={`bubble-row${message.mine ? ' is-mine' : ''}${pop}`}
        onDoubleClick={(event) => onQuickLike(message, event)}
        title="Double-click to like"
      >
        {leading}
        <SharedMedia message={message} onOpen={onOpenMedia} />
        {heartBurst ? <span className="bubble-heart-burst" aria-hidden="true">♥</span> : null}
        {actions}
      </div>
    );
  }
  if (!message.text) {
    const label = attachmentLabel(message);
    return (
      <div
        className={`bubble-row${message.mine ? ' is-mine' : ''}${pop}`}
        onDoubleClick={(event) => onQuickLike(message, event)}
        title="Double-click to like"
      >
        {leading}
        <div className={`bubble is-meta${message.mine ? ' is-mine' : ''}`}>
          <p><AttachmentIcon label={label} /> {label}</p>
          <Reactions reactions={message.reactions} />
        </div>
        {heartBurst ? <span className="bubble-heart-burst" aria-hidden="true">♥</span> : null}
        {actions}
      </div>
    );
  }
  return (
    <div
      className={`bubble-row${message.mine ? ' is-mine' : ''}${pop}`}
      onDoubleClick={(event) => onQuickLike(message, event)}
      title="Double-click to like"
    >
      {leading}
      <div className="bubble-stack">
        <div className={`bubble${message.mine ? ' is-mine' : ''}`}>
          {showName && author && !message.mine ? <small className="bubble-author">{author.username}</small> : null}
          {message.reply ? <span className="bubble-reply-quote">{message.reply}</span> : null}
          <p>{message.text}</p>
          {translation ? <p className="bubble-translation">{translation}</p> : null}
          <Reactions reactions={message.reactions} />
        </div>
        {message.deliveryStatus ? (
          <small className={`bubble-delivery is-${message.deliveryStatus}`}>
            {message.deliveryStatus === 'sending' ? 'Sending…' : 'Not sent'}
          </small>
        ) : null}
      </div>
      {heartBurst ? <span className="bubble-heart-burst" aria-hidden="true">♥</span> : null}
      {actions}
    </div>
  );
};

Bubble.propTypes = {
  isNew: PropTypes.bool,
  message: PropTypes.object.isRequired,
  heartBurst: PropTypes.bool,
  onForward: PropTypes.func.isRequired,
  onReact: PropTypes.func.isRequired,
  onReply: PropTypes.func.isRequired,
  onQuickLike: PropTypes.func.isRequired,
  onOpenMedia: PropTypes.func.isRequired,
  onTranslate: PropTypes.func.isRequired,
  participants: PropTypes.object.isRequired,
  reacting: PropTypes.bool,
  showAvatar: PropTypes.bool,
  showName: PropTypes.bool,
  translation: PropTypes.string,
};

const Direct = () => {
  const { authState } = useAuth();
  const [activeId, setActiveId] = useState(null);
  const [themes, setThemes] = useState(readThemes);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [query, setQuery] = useState('');
  const [sendError, setSendError] = useState(null);
  const [extra, setExtra] = useState({});
  const [reactionOverrides, setReactionOverrides] = useState({});
  const [translations, setTranslations] = useState({});
  const [justSentId, setJustSentId] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [forwarding, setForwarding] = useState(null);
  const [forwardBusy, setForwardBusy] = useState(false);
  const [reacting, setReacting] = useState({});
  const [heartBurst, setHeartBurst] = useState(null);
  const [unreadOverrides, setUnreadOverrides] = useState({});
  const [viewingPost, setViewingPost] = useState(null);
  const [sharePost, setSharePost] = useState(null);
  const markedRead = useRef(new Set());
  const messagesRef = useRef(null);
  const followNewest = useRef(true);
  const composerRef = useRef(null);
  const sendQueues = useRef(new Map());

  const threadsLoader = useCallback(() => nativeClient.threads(), []);
  const notesLoader = useCallback(() => nativeClient.notes(), []);
  const threads = useResource(threadsLoader);
  const notes = useResource(notesLoader);

  const rawItems = useMemo(() => threads.data?.items || [], [threads.data]);
  const items = useMemo(() => rawItems.map((item) => {
    const readThrough = unreadOverrides[item.id];
    return readThrough >= (item.lastActivityAt || 0) ? { ...item, unread: false } : item;
  }), [rawItems, unreadOverrides]);
  const visibleItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return items;
    return items.filter((item) => [item.title, ...item.users.map((user) => user.username)]
      .some((value) => value?.toLocaleLowerCase().includes(needle)));
  }, [items, query]);

  useEffect(() => {
    if (!activeId && items.length) setActiveId(items[0].id);
  }, [activeId, items]);

  const conversation = items.find((item) => item.id === activeId) || null;
  const rawConversation = rawItems.find((item) => item.id === activeId) || null;
  const theme = themes[activeId] || 'default';
  const draft = drafts[activeId] || '';

  const messagesLoader = useCallback(
    async () => {
      if (!activeId) return { items: [], resourceThreadId: null };
      const result = await nativeClient.thread(activeId);
      return { ...result, resourceThreadId: activeId };
    },
    [activeId],
  );
  const messages = useResource(messagesLoader, { skip: !activeId });
  const reloadThreads = threads.reload;
  const reloadMessages = messages.reload;

  const participants = useMemo(() => Object.fromEntries((conversation?.users || []).map((user) => [user.id, user])), [conversation]);
  const messageDataMatches = messages.data?.resourceThreadId === activeId;
  const loadedMessages = useMemo(
    () => (messages.data?.resourceThreadId === activeId ? (messages.data.items || []) : []),
    [activeId, messages.data],
  );
  const thread = useMemo(() => {
    const local = extra[activeId] || [];
    const remainingLocal = unreconciledLocalMessages(loadedMessages, local);
    return [...loadedMessages, ...remainingLocal].map((message) => {
      const override = reactionOverrides[messageKey(message)];
      return override ? { ...message, reactions: override } : message;
    });
  }, [activeId, extra, loadedMessages, reactionOverrides]);

  // Once Instagram returns the authoritative copy, remove the local copy from
  // the outbox. This prevents it resurfacing later when the server history window advances.
  useEffect(() => {
    if (!activeId || !messageDataMatches) return;
    setExtra((current) => {
      const local = current[activeId] || [];
      const remaining = unreconciledLocalMessages(loadedMessages, local);
      if (remaining.length === local.length) return current;
      return { ...current, [activeId]: remaining };
    });
  }, [activeId, extra, loadedMessages, messageDataMatches]);

  // Jump to the newest message when a conversation opens or its history loads.
  useEffect(() => {
    const el = messagesRef.current;
    if (el && followNewest.current) scrollToNewest(el);
  }, [activeId, messages.data]);

  // Smoothly follow the thread down when a message is sent.
  const sentCount = extra[activeId]?.length || 0;
  useEffect(() => {
    if (!sentCount) return;
    scrollToNewest(messagesRef.current, true);
  }, [sentCount]);

  // Keep the latest message visible when the reply bar opens/closes.
  useEffect(() => {
    scrollToNewest(messagesRef.current, true);
  }, [replyingTo]);

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 110)}px`;
  }, [activeId, draft]);

  // Match the web client's "hydrate, then update quietly" behavior while the
  // realtime transport is being completed. Active chats sync quickly; hidden
  // windows back off, and returning to the app triggers one immediate catch-up.
  useEffect(() => {
    if (!activeId) return undefined;
    let timer;
    let syncing = false;
    let cycle = 0;
    let stopped = false;

    const delay = () => (document.visibilityState === 'hidden' ? 25000 : 4000);
    const arm = () => {
      window.clearTimeout(timer);
      if (!stopped) timer = window.setTimeout(runSync, delay());
    };
    const runSync = async () => {
      if (syncing || stopped) return;
      syncing = true;
      try {
        await reloadMessages({ background: true });
        cycle += 1;
        // Keep inbox previews/unread badges current without placing a second
        // request beside every active-thread refresh on the serial sidecar.
        if (document.visibilityState === 'hidden' || cycle % 3 === 0) {
          await reloadThreads({ background: true });
        }
      } finally {
        syncing = false;
        arm();
      }
    };
    const catchUp = () => {
      window.clearTimeout(timer);
      if (document.visibilityState === 'hidden') arm();
      else void runSync();
    };

    arm();
    document.addEventListener('visibilitychange', catchUp);
    window.addEventListener('focus', catchUp);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', catchUp);
      window.removeEventListener('focus', catchUp);
    };
  }, [activeId, reloadMessages, reloadThreads]);

  // Auto mark-read when opening an unread thread.
  useEffect(() => {
    if (!activeId || !rawConversation?.unread || !messageDataMatches || messages.loading) return undefined;
    const last = thread[thread.length - 1];
    const mid = rawConversation.lastReadMessageId || (last ? messageKey(last) : null);
    if (!mid || markedRead.current.has(`${activeId}:${mid}`)) return undefined;
    markedRead.current.add(`${activeId}:${mid}`);
    setUnreadOverrides((current) => ({
      ...current,
      [activeId]: Math.max(current[activeId] || 0, rawConversation.lastActivityAt || 0),
    }));
    nativeClient.markRead(activeId, mid).catch(() => {
      markedRead.current.delete(`${activeId}:${mid}`);
      setUnreadOverrides((current) => {
        const next = { ...current };
        delete next[activeId];
        return next;
      });
    });
    return undefined;
  }, [activeId, messageDataMatches, messages.loading, rawConversation, thread]);

  const openConversation = (item) => {
    followNewest.current = true;
    setActiveId(item.id);
    setPickerOpen(false);
    setSendError(null);
    setReplyingTo(null);
    if (item.unread) {
      setUnreadOverrides((current) => ({
        ...current,
        [item.id]: Math.max(current[item.id] || 0, item.lastActivityAt || 0),
      }));
    }
  };

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
    const label = attachmentLabel(message);
    const creator = message.share?.user?.username;
    const richPreview = creator && creator !== 'instagram'
      ? `${label} from @${creator.replace(/^@/, '')}`
      : label;
    setReplyingTo({
      id: messageKey(message),
      username: message.mine ? 'yourself' : (participants[message.userId]?.username || conversation?.title || 'message'),
      preview: message.text || richPreview,
    });
  };

  const handleReact = async (message, emoji) => {
    if (!activeId) return;
    const key = messageKey(message);
    if (!key || reacting[key]) return;
    const previous = message.reactions || [];
    const next = previous.includes(emoji) ? previous : [...previous, emoji];
    setReactionOverrides((current) => ({ ...current, [key]: next }));
    setReacting((current) => ({ ...current, [key]: true }));
    setSendError(null);
    try {
      await nativeClient.react(activeId, key, emoji);
    } catch (error) {
      setReactionOverrides((current) => ({ ...current, [key]: previous }));
      setSendError(error?.message || 'Reaction failed.');
    } finally {
      setReacting((current) => {
        const nextBusy = { ...current };
        delete nextBusy[key];
        return nextBusy;
      });
    }
  };

  const handleQuickLike = (message) => {
    const key = messageKey(message);
    if (!key) return;
    setHeartBurst(key);
    window.setTimeout(() => setHeartBurst((current) => (current === key ? null : current)), 620);
    void handleReact(message, '❤️');
  };

  const openSharedMedia = (message) => {
    const share = message.share;
    if (!share) return;
    setViewingPost({
      ...share,
      kind: share.kind === 'clip' ? 'video' : share.kind,
      user: share.user || {},
      caption: share.caption || '',
      takenAt: message.timestamp || 0,
      likeCount: share.likeCount || 0,
      commentCount: share.commentCount || 0,
    });
  };

  const handleTranslate = async (message) => {
    const key = messageKey(message);
    if (!message.text) return;
    setSendError(null);
    try {
      const result = await nativeClient.translateMessage(key, message.text);
      setTranslations((current) => ({ ...current, [key]: result.translatedText }));
    } catch (error) {
      if (error?.code === 'translate_unavailable') {
        setTranslations((current) => ({ ...current, [key]: 'Translation unavailable' }));
      } else {
        setSendError(error?.message || 'Translation failed.');
      }
    }
  };

  const handleForwardPick = async (dest) => {
    if (!forwarding || !activeId) return;
    setForwardBusy(true);
    setSendError(null);
    try {
      await nativeClient.forwardMessage(activeId, dest.id, forwarding.text);
      setForwarding(null);
    } catch (error) {
      setSendError(error?.message || 'Forward failed.');
    } finally {
      setForwardBusy(false);
    }
  };

  const send = (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !activeId) return;
    const threadId = activeId;
    const reply = replyingTo;
    const pendingId = optimisticMessageId();
    const timestamp = Math.floor(Date.now() / 1000);
    const optimistic = {
      id: pendingId,
      messageId: pendingId,
      clientContext: null,
      userId: authState.user?.id || 'viewer',
      mine: true,
      kind: 'text',
      text,
      timestamp,
      share: null,
      reply: reply?.preview || null,
      reactions: [],
      deliveryStatus: 'sending',
    };

    setSendError(null);
    setExtra((current) => ({ ...current, [threadId]: [...(current[threadId] || []), optimistic] }));
    setJustSentId(pendingId);
    setDrafts((current) => ({ ...current, [threadId]: '' }));
    setReplyingTo(null);

    const previous = sendQueues.current.get(threadId) || Promise.resolve();
    const queued = previous.catch(() => {}).then(async () => {
      try {
        const result = await nativeClient.sendMessage(threadId, text, reply?.id ?? null);
        const confirmed = {
          ...result.message,
          clientContext: result.message?.clientContext || null,
          timestamp: result.message?.timestamp || timestamp,
          reply: result.message?.reply || reply?.preview || null,
          deliveryStatus: null,
        };
        setExtra((current) => ({
          ...current,
          [threadId]: (current[threadId] || []).map((item) => (
            messageKey(item) === pendingId ? confirmed : item
          )),
        }));
        setJustSentId(confirmed.id || confirmed.messageId || pendingId);
      } catch (error) {
        setExtra((current) => ({
          ...current,
          [threadId]: (current[threadId] || []).map((item) => (
            messageKey(item) === pendingId ? { ...item, deliveryStatus: 'failed' } : item
          )),
        }));
        setSendError(error?.message || 'The message could not be sent.');
      }
    });
    sendQueues.current.set(threadId, queued);
    void queued.finally(() => {
      if (sendQueues.current.get(threadId) === queued) sendQueues.current.delete(threadId);
    });
  };

  const updateDraft = (value) => {
    if (!activeId) return;
    setDrafts((current) => ({ ...current, [activeId]: value }));
  };

  const handleComposerKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <AppShell wide>
      <div className="direct-layout">
        <section className="dm-list" aria-label="Conversations">
          <header className="dm-list-head">
            <div>
              <strong>Messages</strong>
              <small>@{authState.user?.username}</small>
            </div>
            <button className="icon-button" type="button" disabled aria-label="New message"><SquarePen size={20} /></button>
          </header>

          <label className="dm-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search conversations"
              aria-label="Search conversations"
            />
            {query ? <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button> : null}
          </label>

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

          <div className="dm-section">
            <strong>Inbox</strong>
            {items.some((item) => item.unread) ? <span>{items.filter((item) => item.unread).length} new</span> : <span>All caught up</span>}
          </div>

          {threads.loading ? <p className="dm-state"><LoaderCircle className="spin" size={18} /> Loading</p> : null}
          {threads.error ? <p className="dm-state error">{threads.error}</p> : null}

          {visibleItems.map((item) => {
            const latest = item.messages?.[item.messages.length - 1];
            return (
            <button
              className={`dm-row${item.id === activeId ? ' is-active' : ''}`}
              key={item.id}
              type="button"
              onClick={() => openConversation(item)}
              aria-current={item.id === activeId ? 'true' : undefined}
            >
              <ThreadAvatar thread={item} size={54} />
              <span className="dm-copy">
                <strong>{item.title}</strong>
                <small className={item.unread ? 'is-unread' : ''}>
                  {item.lastPreview || messagePreview(latest)} <span aria-hidden="true">·</span> {relativeTime(item.lastActivityAt)}
                </small>
              </span>
              {item.unread ? <i className="dm-dot" aria-label="Unread" /> : null}
            </button>
            );
          })}
          {!threads.loading && !visibleItems.length ? (
            <div className="dm-list-empty">
              <Search size={18} />
              <p>{query ? 'No conversations match that search.' : 'No conversations yet.'}</p>
            </div>
          ) : null}
        </section>

        <section
          className={`dm-thread theme-${theme}`}
          aria-label={conversation ? `Conversation with ${conversation.title}` : 'Conversation'}
          aria-busy={Boolean(conversation && (!messageDataMatches || messages.loading))}
        >
          {conversation ? (
            <>
              <header className="dm-thread-head">
                <ThreadAvatar thread={conversation} size={34} />
                <div>
                  <strong>{conversation.title}</strong>
                  <small>{conversation.isGroup ? `${conversation.users.length} people` : 'Direct message'}</small>
                </div>
                <button className="icon-button" type="button" onClick={() => setPickerOpen((open) => !open)} aria-label="Chat theme"><Palette size={20} /></button>
                <button className="icon-button" type="button" disabled aria-label="Audio call"><Phone size={20} /></button>
                <button className="icon-button" type="button" disabled aria-label="Video call"><Video size={20} /></button>
              </header>

              <div className="dm-backdrop" aria-hidden="true"><span className="glow one" /><span className="glow two" /><span className="spark" /></div>

              <div
                className="dm-messages"
                ref={messagesRef}
                onScroll={(event) => {
                  const el = event.currentTarget;
                  followNewest.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
                }}
              >
                {!messageDataMatches || messages.loading ? (
                  <div className="dm-thread-loading" aria-label="Loading messages">
                    <span /><span /><span />
                  </div>
                ) : null}
                {messages.error ? <p className="dm-state error">{messages.error}</p> : null}
                {messageDataMatches ? thread.map((message, index) => {
                  const prev = thread[index - 1];
                  const next = thread[index + 1];
                  const gapFromPrev = prev && prev.timestamp && message.timestamp && message.timestamp - prev.timestamp > 900;
                  const gapToNext = next && next.timestamp && message.timestamp && next.timestamp - message.timestamp > 900;
                  const contPrev = prev && prev.mine === message.mine && prev.userId === message.userId && !gapFromPrev;
                  const contNext = next && next.mine === message.mine && next.userId === message.userId && !gapToNext;
                  const showTime = message.timestamp && (!prev || gapFromPrev);
                  return (
                    <div key={messageKey(message) || `${message.timestamp}-${index}`} className={`dm-msg${contPrev ? '' : ' group-start'}`}>
                      {showTime ? <p className="dm-time">{clockTime(message.timestamp)}</p> : null}
                      <Bubble
                        message={message}
                        participants={participants}
                        isNew={message.id === justSentId}
                        onReply={handleReply}
                        onQuickLike={handleQuickLike}
                        onOpenMedia={openSharedMedia}
                        onReact={handleReact}
                        onForward={setForwarding}
                        onTranslate={handleTranslate}
                        reacting={Boolean(reacting[messageKey(message)])}
                        heartBurst={heartBurst === messageKey(message)}
                        showAvatar={!contNext}
                        showName={conversation?.isGroup && !contPrev}
                        translation={translations[messageKey(message)]}
                      />
                    </div>
                  );
                }) : null}
                {messageDataMatches && !messages.loading && !messages.error && !thread.length ? (
                  <div className="dm-thread-empty">
                    <ThreadAvatar thread={conversation} size={72} />
                    <strong>{conversation.title}</strong>
                    <span>Start the conversation.</span>
                  </div>
                ) : null}
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
                <textarea
                  ref={composerRef}
                  rows={1}
                  value={draft}
                  onChange={(event) => updateDraft(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder={conversation.isGroup
                    ? `Message ${conversation.title || 'group'}`
                    : `Message ${conversation.users[0]?.username ? `@${conversation.users[0].username}` : conversation.title}`}
                  aria-label="Message"
                />
                <button className="icon-button" type="submit" disabled={!draft.trim()} aria-label="Send message">
                  <Send size={19} />
                </button>
              </form>
            </>
          ) : (
            <div className="state-card"><p>{threads.loading ? 'Loading conversations' : 'Select a conversation'}</p></div>
          )}
        </section>
      </div>

      {forwarding ? (
        <ThreadPicker
          title="Forward to"
          threads={items}
          excludeId={activeId}
          busy={forwardBusy}
          onPick={handleForwardPick}
          onClose={() => setForwarding(null)}
        />
      ) : null}
      {viewingPost ? (
        <PostViewer
          post={viewingPost}
          onClose={() => setViewingPost(null)}
          onShare={(post) => setSharePost(post)}
        />
      ) : null}
      {sharePost ? <ShareSheet mediaId={sharePost.id} onClose={() => setSharePost(null)} /> : null}
    </AppShell>
  );
};

export default Direct;
