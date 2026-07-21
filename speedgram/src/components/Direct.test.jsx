import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Direct from './Direct';
import { nativeClient } from '../nativeClient';

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ authState: { user: { id: 'viewer', username: 'speed_tester' } } }),
}));

vi.mock('./AppShell', () => ({
  default: ({ children }) => <main>{children}</main>,
}));

const user = (id, username) => ({
  id,
  username,
  fullName: username,
  profilePictureUrl: null,
});

const message = (id, text, userId = '1') => ({
  id,
  messageId: `mid.${id}`,
  userId,
  mine: false,
  kind: 'text',
  text,
  timestamp: 1_721_600_000,
  share: null,
  reply: null,
  reactions: [],
});

const thread = (id, title, username, unread, last, preview) => ({
  id,
  title,
  users: [user(id, username)],
  isGroup: false,
  muted: false,
  pending: false,
  unread,
  lastActivityAt: last,
  messages: [preview],
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('Direct conversations', () => {
  beforeEach(() => {
    vi.spyOn(nativeClient, 'notes').mockResolvedValue({ items: [] });
    vi.spyOn(nativeClient, 'markRead').mockResolvedValue({ ok: true });
    vi.spyOn(nativeClient, 'react').mockResolvedValue({ ok: true });
    vi.spyOn(nativeClient, 'threads').mockResolvedValue({
      items: [
        thread('a', 'Alpha', 'alpha', false, 100, message('preview-a', 'alpha preview')),
        thread('b', 'Beta', 'beta', true, 200, message('preview-b', 'beta preview')),
      ],
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('clears the previous history immediately while a newly selected thread loads', async () => {
    let resolveBeta;
    const betaResult = new Promise((resolve) => { resolveBeta = resolve; });
    vi.spyOn(nativeClient, 'thread').mockImplementation((id) => (
      id === 'a' ? Promise.resolve({ items: [message('a1', 'alpha history')] }) : betaResult
    ));

    render(<Direct />);
    expect(await screen.findByText('alpha history')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Beta/ }));
    expect(screen.queryByText('alpha history')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Loading messages')).toBeInTheDocument();

    resolveBeta({ items: [message('b1', 'beta history', 'b')] });
    expect(await screen.findByText('beta history')).toBeInTheDocument();
    await waitFor(() => expect(nativeClient.markRead).toHaveBeenCalledWith('b', 'mid.b1'));
  });

  it('renders a reel as a rich card and double-clicks it into a heart reaction', async () => {
    const reel = {
      ...message('reel-1', '', 'a'),
      kind: 'clip',
      share: {
        id: 'media-1',
        kind: 'video',
        shareType: 'reel',
        user: user('creator', 'creator'),
        caption: 'A proper reel preview',
        imageUrl: 'https://cdn.example/reel.jpg',
        videoUrl: null,
        audioUrl: null,
      },
    };
    vi.spyOn(nativeClient, 'thread').mockResolvedValue({ items: [reel] });
    vi.spyOn(nativeClient, 'comments').mockResolvedValue({ items: [] });

    render(<Direct />);
    expect(await screen.findByText('A proper reel preview')).toBeInTheDocument();
    expect(screen.getByText('Reel')).toBeInTheDocument();
    expect(screen.getByText('@creator')).toBeInTheDocument();

    fireEvent.doubleClick(screen.getByText('A proper reel preview'));
    await waitFor(() => expect(nativeClient.react).toHaveBeenCalledWith('a', 'mid.reel-1', '❤️'));
    expect(screen.getByText('♥')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open reel' }));
    expect(await screen.findByRole('dialog', { name: 'Post by creator' })).toBeInTheDocument();
    expect(screen.getByText('No comments yet')).toBeInTheDocument();
  });

  it('keeps a reel quote visible while its reply sends in the background', async () => {
    const reel = {
      ...message('reel-1', '', 'a'),
      kind: 'clip',
      share: {
        id: 'media-1',
        kind: 'video',
        shareType: 'reel',
        user: user('creator', 'creator'),
        caption: 'Reply to this reel',
        imageUrl: 'https://cdn.example/reel.jpg',
        videoUrl: null,
        audioUrl: null,
      },
    };
    const pending = deferred();
    vi.spyOn(nativeClient, 'thread').mockResolvedValue({ items: [reel] });
    vi.spyOn(nativeClient, 'sendMessage').mockReturnValue(pending.promise);

    render(<Direct />);
    expect(await screen.findByText('Reply to this reel')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(screen.getByText('Reel from @creator')).toBeInTheDocument();

    const composer = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(composer, { target: { value: 'That reel is perfect' } });
    fireEvent.submit(composer.closest('form'));

    expect(screen.getByText('That reel is perfect')).toBeInTheDocument();
    expect(screen.getByText('Sending…')).toBeInTheDocument();
    expect(screen.getByText('Reel from @creator')).toBeInTheDocument();
    expect(composer).toHaveValue('');
    fireEvent.change(composer, { target: { value: 'I can keep typing' } });
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
    await waitFor(() => expect(nativeClient.sendMessage).toHaveBeenCalledWith('a', 'That reel is perfect', 'mid.reel-1'));

    await act(async () => {
      pending.resolve({
        message: {
          ...message('confirmed-reply', 'That reel is perfect', 'viewer'),
          mine: true,
          clientContext: 'reply-context',
          reply: null,
        },
      });
    });
    expect(screen.queryByText('Sending…')).not.toBeInTheDocument();
    expect(screen.getByText('Reel from @creator')).toBeInTheDocument();
  });

  it('queues consecutive sends and reconciles the confirmed copy without duplication', async () => {
    const first = deferred();
    vi.spyOn(nativeClient, 'thread').mockResolvedValue({ items: [] });
    vi.spyOn(nativeClient, 'sendMessage')
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({
        message: {
          ...message('local-2', 'second', 'viewer'),
          mine: true,
          clientContext: 'context-2',
        },
      });

    render(<Direct />);
    await screen.findByText('Start the conversation.');
    const composer = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(composer, { target: { value: 'first' } });
    fireEvent.submit(composer.closest('form'));
    fireEvent.change(composer, { target: { value: 'second' } });
    fireEvent.submit(composer.closest('form'));

    expect(screen.getAllByText('Sending…')).toHaveLength(2);
    await waitFor(() => expect(nativeClient.sendMessage).toHaveBeenCalledTimes(1));
    await act(async () => {
      first.resolve({
        message: {
          ...message('local-1', 'first', 'viewer'),
          mine: true,
          clientContext: 'context-1',
        },
      });
    });
    await waitFor(() => expect(nativeClient.sendMessage).toHaveBeenCalledTimes(2));

    nativeClient.thread.mockResolvedValue({
      items: [
        { ...message('server-1', 'first', 'viewer'), mine: true, clientContext: 'context-1' },
        { ...message('server-2', 'second', 'viewer'), mine: true, clientContext: 'context-2' },
      ],
    });
    fireEvent.focus(window);
    await waitFor(() => expect(nativeClient.thread).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByText('first')).toHaveLength(1));
    expect(screen.getAllByText('second')).toHaveLength(1);
  });

  it('uses a participant stack and group-aware composer for group chats', async () => {
    nativeClient.threads.mockResolvedValue({
      items: [{
        ...thread('group', 'Design crew', 'first_member', false, 300, message('g1', 'hello', 'member-1')),
        isGroup: true,
        users: [user('member-1', 'first_member'), user('member-2', 'second_member'), user('member-3', 'third_member')],
      }],
    });
    vi.spyOn(nativeClient, 'thread').mockResolvedValue({ items: [message('g1', 'hello', 'member-1')] });

    const { container } = render(<Direct />);
    expect(await screen.findByText('hello')).toBeInTheDocument();
    expect(container.querySelectorAll('.group-avatar').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByPlaceholderText('Message Design crew')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Message @first_member')).not.toBeInTheDocument();
  });

  it('shows reaction activity as the inbox preview', async () => {
    nativeClient.threads.mockResolvedValue({
      items: [{
        ...thread('a', 'Alpha', 'alpha', true, 400, message('old', '', 'viewer')),
        lastPreview: 'Liked a message',
        lastReadMessageId: 'mid.reaction-1',
      }],
    });
    vi.spyOn(nativeClient, 'thread').mockResolvedValue({ items: [message('old', '', 'viewer')] });

    render(<Direct />);
    expect(await screen.findByText(/Liked a message/)).toBeInTheDocument();
    expect(screen.queryByText(/You sent an attachment/)).not.toBeInTheDocument();
    await waitFor(() => expect(nativeClient.markRead).toHaveBeenCalledWith('a', 'mid.reaction-1'));
  });
});
