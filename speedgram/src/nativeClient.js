export const isNativeRuntime = () => Boolean(window.__TAURI_INTERNALS__);

// Outside the native shell there is no protocol engine and no session. Every
// data call fails loudly rather than inventing content, and login stays locked.
const browserOnly = () => Promise.reject({
  code: 'native_required',
  message: 'Instagram data is only available in the SpeedGram desktop app.',
});

const invokeNative = async (command, input) => {
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    return await invoke(command, input === undefined ? {} : { input });
  } catch (error) {
    if (error && typeof error === 'object' && 'message' in error) throw error;
    throw {
      code: 'native_error',
      message: typeof error === 'string' ? error : 'The native app could not complete that action.',
    };
  }
};

const native = (command, input) => (isNativeRuntime() ? invokeNative(command, input) : browserOnly());

// Prefetch cache: warmup() kicks off the initial feed/stories/DM requests during
// app bootstrap so the first view has data ready instead of showing a second loader.
const _warm = new Map();
const warmed = (key, run) => {
  if (_warm.has(key)) {
    const cached = _warm.get(key);
    _warm.delete(key);
    return cached;
  }
  return run();
};

// Persist the loaded home feed across Home navigations so it isn't refetched on
// every visit — HomePage reuses it and offers a manual reload once it's stale.
let _feedCache = null;
export const feedCache = {
  get: () => _feedCache,
  set: (data) => { _feedCache = { ...data, fetchedAt: Date.now() }; },
  clear: () => { _feedCache = null; },
};

export const nativeClient = {
  async runtimeStatus() {
    if (!isNativeRuntime()) {
      return { native: false, protocolEngine: 'unavailable', secureStorage: 'unavailable' };
    }
    return invokeNative('runtime_status');
  },

  async authState() {
    if (!isNativeRuntime()) return { status: 'signed_out' };
    return invokeNative('auth_get_state');
  },

  login(username, password) {
    return native('auth_begin_login', { username, password });
  },

  submitCode(operationId, code) {
    return native('auth_submit_code', { operationId, code });
  },

  continueManual(operationId) {
    return native('auth_continue_manual', { operationId });
  },

  cancelAuth() {
    return native('auth_cancel');
  },

  logout() {
    return native('auth_logout');
  },

  // Fire the initial feed/stories/DM requests so they're in-flight (or done) by the
  // time the app renders — avoids the bootstrap loader → feed loader double flash.
  warmup() {
    if (!isNativeRuntime()) return;
    for (const [key, command, input] of [
      ['timeline', 'feed_timeline', { cursor: null }],
      ['stories', 'feed_stories', undefined],
      ['threads', 'direct_threads', undefined],
    ]) {
      const promise = invokeNative(command, input);
      promise.catch(() => {}); // swallow only if never consumed
      _warm.set(key, promise);
    }
  },

  // Resolve once the prefetched feed/stories/DMs are ready (or a safety timeout),
  // so the bootstrap screen can hold until the first view has data — no second loader.
  async warmupSettled(timeoutMs = 8000) {
    const pending = ['timeline', 'stories', 'threads'].map((key) => _warm.get(key)).filter(Boolean);
    if (!pending.length) return;
    await Promise.race([
      Promise.allSettled(pending),
      new Promise((resolve) => { setTimeout(resolve, timeoutMs); }),
    ]);
  },

  timeline(cursor = null) {
    if (cursor == null) return warmed('timeline', () => native('feed_timeline', { cursor: null }));
    return native('feed_timeline', { cursor });
  },

  stories() {
    return warmed('stories', () => native('feed_stories'));
  },

  reels({ cursor = null, source = 'following' } = {}) {
    return native('feed_reels', { cursor, source });
  },

  explore() {
    return native('feed_explore');
  },

  comments(mediaId) {
    return native('media_comments', { mediaId });
  },

  profile(username = null) {
    return native('user_profile', { username });
  },

  userMedias({ userId = null, username = null, cursor = null } = {}) {
    return native('user_medias', { userId, username, cursor });
  },

  activity() {
    return native('activity_inbox');
  },

  threads() {
    return warmed('threads', () => native('direct_threads'));
  },

  thread(threadId) {
    return native('direct_thread', { threadId });
  },

  sendMessage(threadId, text, replyToMessageId = null) {
    return native('direct_send', { threadId, text, replyToMessageId });
  },

  like(mediaId, trackingToken = null) {
    return native('media_like', { mediaId, trackingToken });
  },

  unlike(mediaId, trackingToken = null) {
    return native('media_unlike', { mediaId, trackingToken });
  },

  save(mediaId, loggingInfoToken = null) {
    return native('media_save', { mediaId, loggingInfoToken });
  },

  unsave(mediaId) {
    return native('media_unsave', { mediaId });
  },

  markRead(threadId, messageId) {
    return native('direct_mark_read', { threadId, messageId });
  },

  react(threadId, messageId, emoji) {
    return native('direct_react', { threadId, messageId, emoji });
  },

  shareMedia(mediaId, userId) {
    return native('direct_share_media', { mediaId, userId });
  },

  forwardMessage(fromThreadId, toThreadId, text) {
    return native('direct_forward', { fromThreadId, toThreadId, text });
  },

  translateMessage(messageId, text, dialect = null) {
    return native('direct_translate', { messageId, text, dialect });
  },

  notes() {
    return native('direct_notes');
  },

  presence() {
    return native('direct_presence');
  },

  telemetryConsent(enabled) {
    if (!isNativeRuntime()) return Promise.resolve({ enabled, sink: 'none' });
    return invokeNative('telemetry_set_consent', { enabled });
  },

  // --- Web (core) login: capture credentials, then drive Instagram's real web
  // login inside an embedded window and keep the browser-minted session. ---

  saveWebCredentials(username, password) {
    return invokeNative('save_web_credentials', { username, password });
  },

  beginWebLogin() {
    return invokeNative('begin_web_login');
  },

  saveWebSessionManual(cookies) {
    return invokeNative('save_web_session_manual', { cookies });
  },

  webSessionStatus() {
    if (!isNativeRuntime()) return Promise.resolve({ hasWebSession: false, hasCredentials: false });
    return invokeNative('web_session_status');
  },

  clearWebSession() {
    if (!isNativeRuntime()) return Promise.resolve({ cleared: false });
    return invokeNative('clear_web_session');
  },

  // Subscribe to web-login progress ("authenticated" | "cancelled" | "timeout" |
  // "error"). Returns a promise resolving to an unlisten function.
  async onWebLoginStatus(handler) {
    if (!isNativeRuntime()) return () => {};
    const { listen } = await import('@tauri-apps/api/event');
    return listen('web-login-status', (event) => handler(event.payload));
  },
};
