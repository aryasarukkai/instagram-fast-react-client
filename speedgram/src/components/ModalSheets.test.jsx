import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CommentsSheet from './CommentsSheet';
import ShareSheet from './ShareSheet';
import { AuthProvider } from '../auth/AuthContext';
import { nativeClient } from '../nativeClient';

const post = {
  id: 'media-1',
  user: { id: 'creator-1', username: 'creator', profilePictureUrl: null },
};

describe('modal sheets', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('portals comments outside transformed page content', async () => {
    vi.spyOn(nativeClient, 'comments').mockResolvedValue({
      items: [{
        id: 'comment-1',
        user: { username: 'reader', profilePictureUrl: null },
        text: 'Visible in front of the scrim',
        createdAt: 1_721_600_000,
        likeCount: 0,
        liked: false,
      }],
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <div style={{ transform: 'scale(1)' }}><CommentsSheet post={post} onClose={() => {}} /></div>
        </AuthProvider>
      </MemoryRouter>,
    );

    const dialog = screen.getByRole('dialog', { name: "Comments on creator's post" });
    expect(dialog.parentElement).toBe(document.body);
    expect(await screen.findByText('Visible in front of the scrim')).toBeInTheDocument();
  });

  it('expands a reply thread on demand', async () => {
    vi.spyOn(nativeClient, 'comments').mockResolvedValue({
      items: [{
        id: 'comment-1',
        user: { username: 'reader', profilePictureUrl: null },
        text: 'Parent comment',
        createdAt: 1_721_600_000,
        likeCount: 3,
        liked: false,
        replyCount: 2,
      }],
    });
    vi.spyOn(nativeClient, 'commentReplies').mockResolvedValue({
      items: [
        { id: 'reply-1', user: { username: 'friend', profilePictureUrl: null }, text: 'First reply', createdAt: 1_721_600_100, replyTo: 'comment-1' },
        { id: 'reply-2', user: { username: 'other', profilePictureUrl: null }, text: 'Second reply', createdAt: 1_721_600_200, replyTo: 'comment-1' },
      ],
      replyCount: 2,
      nextCursor: null,
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <CommentsSheet post={post} onClose={() => {}} />
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'View 2 replies' }));
    await waitFor(() => expect(nativeClient.commentReplies).toHaveBeenCalledWith('media-1', 'comment-1', null));
    expect(await screen.findByText('First reply')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Hide replies' }));
    await waitFor(() => expect(screen.queryByText('First reply')).not.toBeInTheDocument());
  });

  it('portals the share picker and sends to the chosen conversation', async () => {
    vi.spyOn(nativeClient, 'shareTargets').mockResolvedValue({ items: [] });
    vi.spyOn(nativeClient, 'threads').mockResolvedValue({
      items: [{
        id: 'thread-1',
        title: 'Alpha',
        users: [{ id: 'person-1', username: 'alpha', profilePictureUrl: null }],
        isGroup: false,
      }],
    });
    vi.spyOn(nativeClient, 'shareMedia').mockResolvedValue({ ok: true });
    const onClose = vi.fn();

    render(<div style={{ transform: 'scale(1)' }}><ShareSheet mediaId="media-1" onClose={onClose} /></div>);

    const dialog = screen.getByRole('dialog', { name: 'Share post' });
    expect(dialog.parentElement).toBe(document.body);
    fireEvent.click(await screen.findByRole('button', { name: /Alpha/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(nativeClient.shareMedia).toHaveBeenCalledWith('media-1', { threadId: 'thread-1' }));
    expect(onClose).toHaveBeenCalled();
  });
});
