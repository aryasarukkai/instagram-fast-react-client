import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PostViewer from './PostViewer';
import { nativeClient } from '../nativeClient';

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    authState: {
      user: {
        username: 'real_viewer',
        profilePictureUrl: 'https://cdn.example/real-viewer.jpg',
      },
    },
  }),
}));

const post = {
  id: 'media-1',
  kind: 'image',
  user: {
    id: 'creator-1',
    username: 'creator',
    profilePictureUrl: 'https://cdn.example/creator.jpg',
    friendshipKnown: true,
    following: false,
  },
  imageUrl: 'https://cdn.example/post.jpg',
  caption: 'A post with mutual context',
  takenAt: 1_721_600_000,
  likeCount: 103_145,
  likedBy: [{
    id: 'mutual-1',
    username: 'mutual_friend',
    profilePictureUrl: 'https://cdn.example/mutual.jpg',
  }],
};

describe('PostViewer identity and social context', () => {
  beforeEach(() => {
    vi.spyOn(nativeClient, 'comments').mockResolvedValue({
      items: [{
        id: 'comment-1',
        user: { username: 'reader', profilePictureUrl: null },
        text: 'Nice shot',
        createdAt: 1_721_600_100,
        likeCount: 2,
        liked: false,
      }],
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('uses the authenticated profile photo and renders real mutual liker context', async () => {
    const { container } = render(
      <MemoryRouter>
        <PostViewer post={post} onClose={() => {}} onShare={() => {}} />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Nice shot')).toBeInTheDocument();
    expect(screen.getByText('mutual_friend')).toBeInTheDocument();
    expect(screen.getByText('103,144 others')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Follow' })).toBeInTheDocument();

    const composerImage = container.ownerDocument.querySelector('.post-viewer-compose img');
    expect(composerImage).toHaveAttribute('src', expect.stringContaining('igimg://img/'));
    expect(container.ownerDocument.querySelector('.viewer-like-facepile img')).toBeInTheDocument();
  });

  it('likes a comment from the post viewer', async () => {
    vi.spyOn(nativeClient, 'likeComment').mockResolvedValue({ liked: true, commentId: 'comment-1' });
    render(
      <MemoryRouter>
        <PostViewer post={post} onClose={() => {}} onShare={() => {}} />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: "Like reader's comment" }));
    await waitFor(() => expect(nativeClient.likeComment).toHaveBeenCalledWith('comment-1'));
  });
});
