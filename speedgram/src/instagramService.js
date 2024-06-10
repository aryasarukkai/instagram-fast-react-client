import { IgApiClient, IgLoginBadPasswordError, IgResponseError } from 'instagram-private-api';

const ig = new IgApiClient();

export const login = async (username, password) => {
  ig.state.generateDevice(username);

  try {
    await ig.simulate.preLoginFlow();
    const loggedInUser = await ig.account.login(username, password);
    await ig.simulate.postLoginFlow();

    // Save the session for future use
    const session = ig.state.serialize();
    // Remove sensitive data
    delete session.constants;

    return { success: true, session };
  } catch (error) {
    console.error('Login failed:', error);

    if (error instanceof IgLoginBadPasswordError) {
      throw new Error('The username or password you entered is incorrect. Please try again.');
    } else if (error instanceof IgResponseError && error.response.statusCode === 400 && error.response.body.message.includes("username")) {
      throw new Error('The username you entered doesn\'t appear to belong to an account. Please check your username and try again.');
    } else {
      throw new Error('An unknown error occurred. Please try again later.');
    }
  }
};

export const deserializeSession = async (session) => {
  try {
    await ig.state.deserialize(session);
  } catch (error) {
    console.error('Session deserialization failed:', error);
    throw new Error('Invalid session');
  }
};

export const getFeed = async () => {
  try {
    const feed = ig.feed.timeline();
    const items = await feed.items();
    return { success: true, items };
  } catch (error) {
    console.error('Failed to get feed:', error);
    throw new Error('Failed to get feed');
  }
};

export const getReels = async () => {
  try {
    const reelsFeed = ig.feed.reelsTray();
    const items = await reelsFeed.items();
    return { success: true, items };
  } catch (error) {
    console.error('Failed to get reels:', error);
    throw new Error('Failed to get reels');
  }
};

export const getStories = async () => {
  try {
    const storiesFeed = ig.feed.reelsMedia({ userIds: [ig.state.cookieUserId] });
    const items = await storiesFeed.items();
    return { success: true, items };
  } catch (error) {
    console.error('Failed to get stories:', error);
    throw new Error('Failed to get stories');
  }
};

export const getFollowers = async () => {
  try {
    const followersFeed = ig.feed.accountFollowers(ig.state.cookieUserId);
    const items = await followersFeed.items();
    return { success: true, items };
  } catch (error) {
    console.error('Failed to get followers:', error);
    throw new Error('Failed to get followers');
  }
};

export const getFollowing = async () => {
  try {
    const followingFeed = ig.feed.accountFollowing(ig.state.cookieUserId);
    const items = await followingFeed.items();
    return { success: true, items };
  } catch (error) {
    console.error('Failed to get following:', error);
    throw new Error('Failed to get following');
  }
};

export const getInbox = async () => {
  try {
    const inboxFeed = ig.feed.directInbox();
    const threads = await inboxFeed.items();
    return { success: true, threads };
  } catch (error) {
    console.error('Failed to get inbox:', error);
    throw new Error('Failed to get inbox');
  }
};

export const getThreadMessages = async (threadId) => {
  try {
    const thread = ig.entity.directThread(threadId);
    const messages = await thread.items();
    return { success: true, messages };
  } catch (error) {
    console.error('Failed to get thread messages:', error);
    throw new Error('Failed to get thread messages');
  }
};

export const getCurrentUserProfile = async () => {
  try {
    const user = await ig.account.currentUser();
    return { success: true, user };
  } catch (error) {
    console.error('Failed to get profile:', error);
    throw new Error('Failed to get profile');
  }
};
