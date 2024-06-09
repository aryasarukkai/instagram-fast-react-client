const express = require('express');
const cors = require('cors');
const { IgApiClient, IgLoginBadPasswordError, IgResponseError } = require('instagram-private-api');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const ig = new IgApiClient();

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  ig.state.generateDevice(username);

  try {
    await ig.simulate.preLoginFlow();
    const loggedInUser = await ig.account.login(username, password);
    process.nextTick(async () => await ig.simulate.postLoginFlow());

    // Save the session for future use
    const session = ig.state.serialize();
    // Remove sensitive data
    delete session.constants;

    res.json({ success: true, session });
  } catch (error) {
    console.error('Login failed:', error);

    if (error instanceof IgLoginBadPasswordError) {
      res.status(401).json({ success: false, message: 'The username or password you entered is incorrect. Please try again.' });
    } else if (error instanceof IgResponseError && error.response.statusCode === 400 && error.response.body.message.includes("username")) {
      res.status(401).json({ success: false, message: 'The username you entered doesn\'t appear to belong to an account. Please check your username and try again.' });
    } else {
      res.status(500).json({ success: false, message: 'An unknown error occurred. Please try again later.' });
    }
  }
});

// Middleware to check session
app.use(async (req, res, next) => {
  if (!req.headers.session) {
    return res.status(401).json({ success: false, message: 'Session is required' });
  }
  try {
    await ig.state.deserialize(req.headers.session);
    next();
  } catch (error) {
    console.error('Session deserialization failed:', error);
    res.status(500).json({ success: false, message: 'Invalid session' });
  }
});

// Get User's Posts Feed
app.get('/feed', async (req, res) => {
  try {
    const feed = ig.feed.timeline();
    const items = await feed.items();
    res.json({ success: true, items });
  } catch (error) {
    console.error('Failed to get feed:', error);
    res.status(500).json({ success: false, message: 'Failed to get feed' });
  }
});

// Get User's Reels
app.get('/reels', async (req, res) => {
  try {
    const reelsFeed = ig.feed.reelsTray();
    const items = await reelsFeed.items();
    res.json({ success: true, items });
  } catch (error) {
    console.error('Failed to get reels:', error);
    res.status(500).json({ success: false, message: 'Failed to get reels' });
  }
});

// Get User's Stories
app.get('/stories', async (req, res) => {
  try {
    const storiesFeed = ig.feed.reelsMedia({ userIds: [ig.state.cookieUserId] });
    const items = await storiesFeed.items();
    res.json({ success: true, items });
  } catch (error) {
    console.error('Failed to get stories:', error);
    res.status(500).json({ success: false, message: 'Failed to get stories' });
  }
});

// Get User's Followers
app.get('/followers', async (req, res) => {
  try {
    const followersFeed = ig.feed.accountFollowers(ig.state.cookieUserId);
    const items = await followersFeed.items();
    res.json({ success: true, items });
  } catch (error) {
    console.error('Failed to get followers:', error);
    res.status(500).json({ success: false, message: 'Failed to get followers' });
  }
});

// Get User's Following
app.get('/following', async (req, res) => {
  try {
    const followingFeed = ig.feed.accountFollowing(ig.state.cookieUserId);
    const items = await followingFeed.items();
    res.json({ success: true, items });
  } catch (error) {
    console.error('Failed to get following:', error);
    res.status(500).json({ success: false, message: 'Failed to get following' });
  }
});

// Get User's Direct Message Threads
app.get('/direct/inbox', async (req, res) => {
  try {
    const inboxFeed = ig.feed.directInbox();
    const threads = await inboxFeed.items();
    res.json({ success: true, threads });
  } catch (error) {
    console.error('Failed to get inbox:', error);
    res.status(500).json({ success: false, message: 'Failed to get inbox' });
  }
});

// Get Messages from a Specific Thread
app.get('/direct/thread/:threadId', async (req, res) => {
  const { threadId } = req.params;
  try {
    const thread = ig.entity.directThread(threadId);
    const messages = await thread.items();
    res.json({ success: true, messages });
  } catch (error) {
    console.error('Failed to get thread messages:', error);
    res.status(500).json({ success: false, message: 'Failed to get thread messages' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
