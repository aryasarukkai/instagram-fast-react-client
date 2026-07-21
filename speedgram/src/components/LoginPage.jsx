import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  MessagesSquare,
  RefreshCw,
  Smartphone,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import logo from '../assets/speedgram-logo.png';
import { useAuth } from '../auth/AuthContext';

const messages = {
  invalid_credentials: 'Check the username and password, then try again.',
  rate_limited: 'Instagram asked this device to slow down. Wait a few minutes before retrying.',
  network_error: 'Instagram could not be reached. Check your connection and retry.',
  session_expired: 'The saved session expired. Sign in again to refresh it.',
  account_restricted: 'Instagram paused requests for this account. Check the official app before retrying.',
  secure_storage_unavailable: 'Secure storage is unavailable. SpeedGram will not accept credentials until it is ready.',
  native_required: 'Open the SpeedGram desktop app to sign in.',
};

const highlights = [
  { icon: Zap, title: 'Instant feed', copy: 'Native rendering, no page loads' },
  { icon: MessagesSquare, title: 'Reels and DMs', copy: 'Everything you actually open' },
];

const LoginPage = () => {
  const { authState, runtime, webLogin, saveWebSessionManual, submitCode, continueManual, cancel, retryBootstrap } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [cookies, setCookies] = useState('');
  const codeRef = useRef(null);
  const busy = authState.status === 'authenticating';
  const verificationMethods = authState.verificationMethods || [];
  const supportsApproval = verificationMethods.includes('push_approval');
  const supportsAuthenticator = verificationMethods.includes('authenticator_code');
  const supportsBackup = verificationMethods.includes('backup_code');
  const supportsSms = verificationMethods.includes('sms_code') || authState.verificationKind === 'sms';
  const supportsEmail = verificationMethods.includes('email_code') || authState.verificationKind === 'email';

  useEffect(() => {
    if (authState.status === 'verification_required' && (!supportsApproval || authState.errorCode)) {
      codeRef.current?.focus();
    }
  }, [authState.errorCode, authState.status, supportsApproval]);

  const handleWebLogin = async (event) => {
    event.preventDefault();
    await webLogin(username.trim(), password);
  };

  const handleManualSession = async () => {
    await saveWebSessionManual(username.trim(), password, cookies.trim());
  };

  const handleCode = async (event) => {
    event.preventDefault();
    await submitCode(authState.operationId, code.trim());
  };

  const reset = async () => {
    setPassword('');
    setCode('');
    await cancel();
  };

  const errorMessage = messages[authState.code] || authState.message;
  const codeLabel = supportsAuthenticator
    ? `Authenticator code${supportsBackup ? ' or backup code' : ''}`
    : supportsSms
      ? 'Text message code'
      : supportsEmail
        ? 'Email code'
        : 'Verification code';

  return (
    <main className="auth-stage">
      <section className="auth-thesis" aria-labelledby="auth-title">
        <img className="auth-logo" src={logo} alt="" width="76" height="76" />
        <div className="auth-copy">
          <h1 id="auth-title">Instagram at<br /><em>desktop speed.</em></h1>
          <p>Your feed, reels, Explore, and messages in one fast Mac app — built to open in a blink and stay out of the way.</p>
        </div>
        <div className="auth-highlights">
          {highlights.map(({ icon: Icon, title, copy }) => (
            <span key={title}><Icon size={18} /><strong>{title}</strong><small>{copy}</small></span>
          ))}
        </div>
      </section>

      <section className="auth-panel">
        {authState.status === 'verification_required' ? (
          <>
            <h2>Confirm it’s you</h2>
            <div className="auth-form verification-options">
              {authState.errorMessage ? (
                <div className="auth-error" role="alert"><TriangleAlert size={16} /><span>{authState.errorMessage}</span></div>
              ) : null}
              {supportsApproval ? (
                <section className="approval-option" aria-labelledby="approval-option-title">
                  <div className="verification-symbol phone"><Smartphone size={24} /></div>
                  <div>
                    <strong id="approval-option-title">Approve in Instagram</strong>
                    <p>Instagram may show this request as a <b>{authState.deviceName || 'Android device'}</b>. Approve it only if it appeared with this attempt.</p>
                  </div>
                  <button className="approval-button" type="button" disabled={busy} onClick={() => continueManual(authState.operationId)}>
                    {busy ? <><RefreshCw className="spin" size={15} /> Checking</> : <>I approved it <CheckCircle2 size={16} /></>}
                  </button>
                </section>
              ) : null}

              {supportsApproval ? <div className="auth-choice"><span>or use a code</span></div> : null}

              <form className="code-option" onSubmit={handleCode}>
                <div className="verification-symbol"><KeyRound size={24} /></div>
                <label htmlFor="verification-code">{codeLabel}</label>
                <input
                  id="verification-code"
                  ref={codeRef}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder={supportsBackup ? '6-digit code or 8-digit backup' : '123 456'}
                  required
                />
                <button className="auth-primary" type="submit" disabled={busy || !code.trim()}>Verify code</button>
              </form>
              <button className="auth-secondary" type="button" onClick={reset}>Cancel this login</button>
            </div>
          </>
        ) : authState.status === 'manual_approval_required' ? (
          <>
            <h2>Approve this device</h2>
            <div className="auth-form">
              <div className="verification-symbol phone"><Smartphone size={25} /></div>
              <p className="auth-direction">Open the official Instagram app on a trusted device and approve this login. Keep SpeedGram open so it can keep the same session.</p>
              <ol className="approval-steps">
                <li>Open Instagram and review the login alert.</li>
                <li>Confirm that the login was you.</li>
                <li>Return here and continue.</li>
              </ol>
              <button className="auth-primary" type="button" disabled={busy} onClick={() => continueManual(authState.operationId)}>
                I approved it
              </button>
              <button className="auth-secondary" type="button" onClick={reset}>Cancel this login</button>
            </div>
          </>
        ) : (
          <>
            <h2>Log into Instagram</h2>
            <form className="auth-form" onSubmit={handleWebLogin}>
              {authState.status === 'error' && errorMessage ? (
                <div className="auth-error" role="alert"><TriangleAlert size={16} /><span>{errorMessage}</span></div>
              ) : null}
              {authState.storageWarning ? <div className="auth-error" role="status">{authState.storageWarning}</div> : null}

              <label className="field-label" htmlFor="instagram-username">Instagram username</label>
              <input
                id="instagram-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck="false"
                placeholder="Username"
                required
              />

              <label className="field-label" htmlFor="instagram-password">Instagram password</label>
              <div className="password-field">
                <input
                  id="instagram-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="Password"
                  required
                />
                <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>

              <button
                className="auth-primary"
                type="submit"
                disabled={busy || !runtime?.native || runtime?.secureStorage !== 'ready' || !username.trim() || !password}
              >
                {busy ? <><RefreshCw className="spin" size={16} /> Opening Instagram</> : 'Continue in Instagram'}
              </button>
              <button
                className="auth-secondary"
                type="button"
                onClick={() => setShowPaste((open) => !open)}
              >
                {showPaste ? 'Hide manual session' : 'Paste session cookies instead'}
              </button>

              {showPaste ? (
                <div className="paste-session">
                  <label className="field-label" htmlFor="session-cookies">Instagram cookies</label>
                  <textarea
                    id="session-cookies"
                    value={cookies}
                    onChange={(event) => setCookies(event.target.value)}
                    rows={5}
                    spellCheck="false"
                    placeholder={'sessionid=...; ds_user_id=...; csrftoken=...\n\n— or paste a Cookie-Editor JSON export —'}
                  />
                  <p className="auth-note">Paste from a logged-in instagram.com tab: either the cookie string (<code>document.cookie</code>) or a Cookie-Editor JSON export. Must include <code>sessionid</code>.</p>
                  <button
                    className="auth-secondary"
                    type="button"
                    onClick={handleManualSession}
                    disabled={busy || !runtime?.native || runtime?.secureStorage !== 'ready' || !username.trim() || !password || !cookies.trim()}
                  >
                    Save session from cookies
                  </button>
                </div>
              ) : null}

              {authState.status === 'web_idle' && authState.message ? (
                <div className="auth-error" role="alert"><TriangleAlert size={16} /><span>{authState.message}</span></div>
              ) : null}

              {authState.status === 'error' && authState.code === 'protocol_unavailable' ? (
                <button className="auth-secondary" type="button" onClick={retryBootstrap}>Retry local engine</button>
              ) : null}
            </form>
            <p className="auth-note">Your login is encrypted and never leaves this Mac. Start with a secondary account.</p>
          </>
        )}
      </section>
    </main>
  );
};

export default LoginPage;
