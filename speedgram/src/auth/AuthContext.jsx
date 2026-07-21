import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { nativeClient } from '../nativeClient';

const AuthContext = createContext(null);

const safeErrorState = (error) => ({
  status: 'error',
  code: error?.code || 'native_error',
  message: error?.message || 'SpeedGram could not start the local account engine.',
});

export const AuthProvider = ({ children }) => {
  const [authState, setAuthState] = useState({ status: 'booting' });
  const [runtime, setRuntime] = useState(null);

  const bootstrap = useCallback(async () => {
    setAuthState({ status: 'booting' });
    try {
      const runtimeStatus = await nativeClient.runtimeStatus();
      setRuntime(runtimeStatus);
      setAuthState(await nativeClient.authState());
    } catch (error) {
      setAuthState(safeErrorState(error));
    }
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const runAuthAction = useCallback(async (action) => {
    setAuthState((current) => ({ ...current, status: 'authenticating' }));
    try {
      const next = await action();
      setAuthState(next);
      return next;
    } catch (error) {
      const next = safeErrorState(error);
      setAuthState(next);
      return next;
    }
  }, []);

  const actions = useMemo(() => ({
    login: (username, password) => runAuthAction(() => nativeClient.login(username, password)),
    submitCode: (operationId, code) => runAuthAction(() => nativeClient.submitCode(operationId, code)),
    continueManual: (operationId) => runAuthAction(() => nativeClient.continueManual(operationId)),
    cancel: async () => {
      try {
        setAuthState(await nativeClient.cancelAuth());
      } catch (error) {
        setAuthState(safeErrorState(error));
      }
    },
    logout: async () => {
      try {
        setAuthState(await nativeClient.logout());
      } catch (error) {
        setAuthState(safeErrorState(error));
      }
    },
    // Core (web) sign-in: store the credentials, then drive Instagram's real web
    // login in an embedded window and keep the browser-minted session cookies.
    webLogin: async (username, password) => {
      setAuthState((current) => ({ ...current, status: 'authenticating' }));
      let unlisten = () => {};
      const finish = (next) => {
        unlisten();
        setAuthState(next);
      };
      try {
        await nativeClient.saveWebCredentials(username.trim(), password);
        unlisten = await nativeClient.onWebLoginStatus((payload) => {
          switch (payload?.status) {
            case 'authenticated':
              finish({ status: 'web_captured', userId: payload.userId ?? null });
              break;
            case 'cancelled':
              finish({ status: 'web_idle', code: 'web_login_cancelled', message: 'The Instagram login window closed before finishing.' });
              break;
            case 'timeout':
              finish({ status: 'web_idle', code: 'web_login_timeout', message: 'The Instagram login timed out. Try again.' });
              break;
            case 'error':
              finish({ status: 'web_idle', code: 'web_login_failed', message: payload.message || 'The Instagram web session could not be saved.' });
              break;
            default:
              break;
          }
        });
        await nativeClient.beginWebLogin();
        return { status: 'web_login_started' };
      } catch (error) {
        unlisten();
        const next = safeErrorState(error);
        setAuthState(next);
        return next;
      }
    },
    // Stopgap while live logins are blocked: store the credentials, then accept a
    // web session from cookies the user pastes in by hand.
    saveWebSessionManual: async (username, password, cookies) => {
      setAuthState((current) => ({ ...current, status: 'authenticating' }));
      try {
        if (username && password) {
          await nativeClient.saveWebCredentials(username.trim(), password);
        }
        const result = await nativeClient.saveWebSessionManual(cookies);
        const next = { status: 'web_captured', userId: result?.userId ?? null };
        setAuthState(next);
        return next;
      } catch (error) {
        const next = safeErrorState(error);
        setAuthState(next);
        return next;
      }
    },
    webSessionStatus: () => nativeClient.webSessionStatus(),
    clearWebSession: () => nativeClient.clearWebSession(),
    retryBootstrap: bootstrap,
  }), [bootstrap, runAuthAction]);

  const value = useMemo(() => ({ authState, runtime, ...actions }), [actions, authState, runtime]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

AuthProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

// The hook intentionally shares the provider module so its context stays private.
// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
};
