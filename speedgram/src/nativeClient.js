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

  timeline(cursor = null) {
    return native('feed_timeline', { cursor });
  },

  stories() {
    return native('feed_stories');
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
    return native('direct_threads');
  },

  thread(threadId) {
    return native('direct_thread', { threadId });
  },

  sendMessage(threadId, text) {
    return native('direct_send', { threadId, text });
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
