import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { nativeClient } from './nativeClient';

const renderApp = () => render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>);

const emptyFeed = { items: [], nextCursor: null, hasMore: false };

const stubFeedRequests = () => {
  vi.spyOn(nativeClient, 'timeline').mockResolvedValue(emptyFeed);
  vi.spyOn(nativeClient, 'stories').mockResolvedValue({ items: [] });
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete window.__TAURI_INTERNALS__;
});

describe('SpeedGram application boundary', () => {
  it('locks the browser build out of Instagram entirely', async () => {
    renderApp();
    expect(await screen.findByLabelText(/Instagram username/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue in Instagram/i })).toBeDisabled();
    await expect(nativeClient.timeline()).rejects.toMatchObject({ code: 'native_required' });
    await expect(nativeClient.threads()).rejects.toMatchObject({ code: 'native_required' });
  });

  it('moves a native verification challenge through the code step into the timeline', async () => {
    window.__TAURI_INTERNALS__ = {};
    vi.spyOn(nativeClient, 'runtimeStatus').mockResolvedValue({
      native: true,
      protocolEngine: 'instagrapi',
      secureStorage: 'ready',
    });
    vi.spyOn(nativeClient, 'authState').mockResolvedValue({
      status: 'verification_required',
      operationId: 'operation-1',
      verificationKind: 'two_factor',
      verificationMethods: ['push_approval', 'authenticator_code', 'backup_code'],
      deviceName: 'Pixel 8 Pro',
    });
    const submitCode = vi.spyOn(nativeClient, 'submitCode').mockResolvedValue({
      status: 'authenticated',
      user: { username: 'secondary' },
    });
    stubFeedRequests();

    renderApp();
    expect(await screen.findByText(/Approve in Instagram/i)).toBeInTheDocument();
    expect(screen.getByText(/Pixel 8 Pro/i)).toBeInTheDocument();
    const code = screen.getByLabelText(/Authenticator code or backup code/i);
    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /Verify code/i }));

    await waitFor(() => expect(submitCode).toHaveBeenCalledWith('operation-1', '123456'));
    expect(await screen.findByText(/^secondary$/)).toBeInTheDocument();
  });

  it('renders guided official-app approval without exposing raw challenge data', async () => {
    window.__TAURI_INTERNALS__ = {};
    vi.spyOn(nativeClient, 'runtimeStatus').mockResolvedValue({ native: true, secureStorage: 'ready' });
    vi.spyOn(nativeClient, 'authState').mockResolvedValue({
      status: 'manual_approval_required',
      operationId: 'approval-1',
      message: 'safe message',
    });
    const continueManual = vi.spyOn(nativeClient, 'continueManual').mockResolvedValue({
      status: 'manual_approval_required',
      operationId: 'approval-1',
    });

    renderApp();
    expect(await screen.findByText(/Open the official Instagram app/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /I approved it/i }));
    await waitFor(() => expect(continueManual).toHaveBeenCalledWith('approval-1'));
    expect(document.body.textContent).not.toMatch(/sessionid|authorization_data|password_encryption_key/i);
  });

  it('keeps a rejected verification code recoverable and explains the next action', async () => {
    window.__TAURI_INTERNALS__ = {};
    vi.spyOn(nativeClient, 'runtimeStatus').mockResolvedValue({ native: true, secureStorage: 'ready' });
    vi.spyOn(nativeClient, 'authState').mockResolvedValue({
      status: 'verification_required',
      operationId: 'operation-2',
      verificationKind: 'two_factor',
      verificationMethods: ['push_approval', 'authenticator_code'],
      deviceName: 'Pixel 8 Pro',
      errorCode: 'invalid_verification_code',
      errorMessage: 'Instagram did not accept that code. Use a fresh code or approve the login in Instagram.',
    });

    renderApp();
    expect(await screen.findByRole('alert')).toHaveTextContent(/did not accept that code/i);
    expect(screen.getByRole('button', { name: /I approved it/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Verify code/i })).toBeDisabled();
  });

  it('surfaces a failed timeline request instead of showing placeholder posts', async () => {
    window.__TAURI_INTERNALS__ = {};
    vi.spyOn(nativeClient, 'runtimeStatus').mockResolvedValue({ native: true, secureStorage: 'ready' });
    vi.spyOn(nativeClient, 'authState').mockResolvedValue({ status: 'authenticated', user: { username: 'secondary' } });
    vi.spyOn(nativeClient, 'stories').mockResolvedValue({ items: [] });
    vi.spyOn(nativeClient, 'timeline').mockRejectedValue({
      code: 'rate_limited',
      message: 'Instagram asked this device to slow down.',
    });

    renderApp();
    expect(await screen.findByText(/asked this device to slow down/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
  });
});
