import { cleanup, render, screen } from '@testing-library/react';
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
  user: { username: 'creator', profilePictureUrl: 'https://cdn.example/creator.jpg' },
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
    vi.spyOn(nativeClient, 'comments').mockResolvedValue({ items: [] });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('uses the authenticated profile photo and renders real mutual liker context', async () => {
    const { container } = render(<PostViewer post={post} onClose={() => {}} onShare={() => {}} />);
    expect(await screen.findByText('No comments yet')).toBeInTheDocument();
    expect(screen.getByText('mutual_friend')).toBeInTheDocument();
    expect(screen.getByText('103,144 others')).toBeInTheDocument();

    const composerImage = container.ownerDocument.querySelector('.post-viewer-compose img');
    expect(composerImage).toHaveAttribute('src', expect.stringContaining('igimg://img/'));
    expect(container.ownerDocument.querySelector('.viewer-like-facepile img')).toBeInTheDocument();
    expect(container.ownerDocument.querySelector('.viewer-comment button')).not.toBeInTheDocument();
  });
});
