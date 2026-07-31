import { useCallback, useEffect, useState } from 'react';
import { Copy, Grid3x3, LoaderCircle, Lock, PlayCircle } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import AppShell from './AppShell';
import Visual, { Avatar } from './Visual';
import { nativeClient } from '../nativeClient';
import { useAuth } from '../auth/AuthContext';
import { useResource } from '../useResource';
import { exactCount } from '../format';

const ProfilePage = () => {
  const { authState } = useAuth();
  const { username: routeUsername } = useParams();
  const username = routeUsername || authState.user?.username;
  const isSelf = Boolean(username && authState.user?.username && username === authState.user.username);

  const profileLoader = useCallback(() => nativeClient.profile(username), [username]);
  const mediaLoader = useCallback(() => nativeClient.userMedias({ username }), [username]);
  const profile = useResource(profileLoader);
  const medias = useResource(mediaLoader);
  const user = profile.data?.user;

  const [following, setFollowing] = useState(null);
  const [outgoing, setOutgoing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  useEffect(() => {
    setFollowing(null);
    setOutgoing(false);
    setActionError(null);
  }, [username]);

  const resolvedFollowing = following ?? Boolean(user?.following);
  const resolvedOutgoing = following == null ? Boolean(user?.outgoingRequest) : outgoing;

  const toggleFollow = async () => {
    if (!user?.id || busy || isSelf) return;
    const wasFollowing = resolvedFollowing;
    const wasOutgoing = resolvedOutgoing;
    const nextFollowing = !wasFollowing && !wasOutgoing;
    setFollowing(nextFollowing);
    setOutgoing(false);
    setBusy(true);
    setActionError(null);
    try {
      if (wasFollowing || wasOutgoing) {
        const result = await nativeClient.unfollow(user.id);
        setFollowing(Boolean(result.following));
        setOutgoing(Boolean(result.outgoingRequest));
      } else {
        const result = await nativeClient.follow(user.id);
        setFollowing(Boolean(result.following));
        setOutgoing(Boolean(result.outgoingRequest));
      }
    } catch (error) {
      setFollowing(wasFollowing);
      setOutgoing(wasOutgoing);
      setActionError(error?.message || 'Follow action failed.');
    } finally {
      setBusy(false);
    }
  };

  const followLabel = resolvedFollowing ? 'Following' : (resolvedOutgoing ? 'Requested' : 'Follow');

  return (
    <AppShell>
      <div className="profile-page">
        {profile.loading ? (
          <div className="state-card"><LoaderCircle className="spin" size={26} /><p>Loading profile</p></div>
        ) : profile.error ? (
          <div className="state-card error"><p>{profile.error}</p><button type="button" onClick={profile.reload}>Try again</button></div>
        ) : user ? (
          <header className="profile-head">
            <Avatar src={user.profilePictureUrl} username={user.username} size={150} ring="story" />
            <div className="profile-meta">
              <div className="profile-title">
                {user.isPrivate ? <Lock size={15} /> : null}
                <h1>{user.username}</h1>
                {user.verified ? <span className="verified" title="Verified">✓</span> : null}
                {!isSelf ? (
                  <button
                    type="button"
                    className={resolvedFollowing || resolvedOutgoing ? 'is-following' : ''}
                    disabled={busy}
                    onClick={toggleFollow}
                  >
                    {busy ? '…' : followLabel}
                  </button>
                ) : null}
                {routeUsername && isSelf ? (
                  <Link className="profile-self-link" to="/profile">Your profile</Link>
                ) : null}
              </div>
              <div className="profile-stats">
                <span><strong>{exactCount.format(user.mediaCount)}</strong> posts</span>
                <span><strong>{exactCount.format(user.followerCount)}</strong> followers</span>
                <span><strong>{exactCount.format(user.followingCount)}</strong> following</span>
              </div>
              {user.fullName ? <p className="profile-name">{user.fullName}</p> : null}
              {user.biography ? <p className="profile-bio">{user.biography}</p> : null}
              {actionError ? <p className="inline-error" role="status">{actionError}</p> : null}
            </div>
          </header>
        ) : null}

        <nav className="profile-tabs" aria-label="Profile sections">
          <button className="profile-tab is-active" type="button"><Grid3x3 size={18} /> Posts</button>
        </nav>

        {medias.loading ? (
          <div className="state-card"><LoaderCircle className="spin" size={24} /><p>Loading posts</p></div>
        ) : medias.error ? (
          <div className="state-card error"><p>{medias.error}</p><button type="button" onClick={medias.reload}>Try again</button></div>
        ) : (
          <div className="profile-grid">
            {(medias.data?.items || []).map((item) => (
              <button className="profile-tile" type="button" key={item.id} disabled>
                <Visual imageUrl={item.imageUrl} alt={item.caption || 'Post'} seed={item.id} />
                {item.kind === 'video' ? <PlayCircle className="tile-kind" size={17} /> : null}
                {item.kind === 'carousel' ? <Copy className="tile-kind" size={16} /> : null}
              </button>
            ))}
            {!medias.data?.items?.length ? <p className="profile-empty">No posts yet.</p> : null}
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default ProfilePage;
