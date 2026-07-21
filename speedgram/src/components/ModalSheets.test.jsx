import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CommentsSheet from './CommentsSheet';
import ShareSheet from './ShareSheet';
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

    render(<div style={{ transform: 'scale(1)' }}><CommentsSheet post={post} onClose={() => {}} /></div>);

    const dialog = screen.getByRole('dialog', { name: "Comments on creator's post" });
    expect(dialog.parentElement).toBe(document.body);
    expect(await screen.findByText('Visible in front of the scrim')).toBeInTheDocument();
  });

  it('portals the share picker and sends to the chosen conversation', async () => {
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
    await waitFor(() => expect(nativeClient.shareMedia).toHaveBeenCalledWith('media-1', 'person-1'));
    expect(onClose).toHaveBeenCalled();
  });
});
