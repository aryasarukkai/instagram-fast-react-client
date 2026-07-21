mod sidecar;
mod vault;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sidecar::{RpcError, SidecarManager};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::webview::Cookie;
use tauri::{
    AppHandle, Emitter, Manager, State, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use vault::SecretVault;

/// Label of the throwaway window that hosts Instagram's real web login form.
const LOGIN_WEBVIEW_LABEL: &str = "ig-web-login";
const IG_LOGIN_URL: &str = "https://www.instagram.com/accounts/login/";
const IG_ORIGIN: &str = "https://www.instagram.com";
/// Presence of this (HTTP-only) cookie is our signal that the web login landed.
const WEB_SESSION_COOKIE: &str = "sessionid";
/// Event the capture task emits so the frontend can react to login progress.
const WEB_LOGIN_EVENT: &str = "web-login-status";
/// Custom scheme the webview uses to load Instagram images through our proxy.
const IMAGE_SCHEME: &str = "igimg";
const WEB_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

struct AppState {
    sidecar: SidecarManager,
    vault: Option<SecretVault>,
    vault_error: Option<String>,
    telemetry_consent: AtomicBool,
    http_client: reqwest::Client,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandError {
    code: String,
    message: String,
}

impl CommandError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl From<RpcError> for CommandError {
    fn from(error: RpcError) -> Self {
        Self {
            code: error.code,
            message: error.message,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginInput {
    username: String,
    password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodeInput {
    operation_id: String,
    code: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OperationInput {
    operation_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TimelineInput {
    cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReelsInput {
    cursor: Option<String>,
    source: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaInput {
    media_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileInput {
    username: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediasInput {
    user_id: Option<String>,
    username: Option<String>,
    cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThreadInput {
    thread_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendInput {
    thread_id: String,
    text: String,
    reply_to_message_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaEngageInput {
    media_id: String,
    tracking_token: Option<String>,
    logging_info_token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarkReadInput {
    thread_id: String,
    message_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReactInput {
    thread_id: String,
    message_id: String,
    emoji: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShareMediaInput {
    media_id: String,
    user_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForwardInput {
    from_thread_id: String,
    to_thread_id: String,
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranslateInput {
    message_id: String,
    text: String,
    dialect: Option<String>,
}

#[derive(Deserialize)]
struct TelemetryInput {
    enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CredentialsInput {
    username: String,
    password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManualSessionInput {
    cookies: String,
}

fn require_vault(state: &AppState) -> Result<&SecretVault, CommandError> {
    state.vault.as_ref().ok_or_else(|| {
        CommandError::new(
            "secure_storage_unavailable",
            state
                .vault_error
                .as_deref()
                .unwrap_or("Secure storage is unavailable."),
        )
    })
}

/// The cookie jar of the stored web session, if one exists — the core backend's
/// credential. Presence of this means the app should serve the web (core) feed.
fn web_session_cookies(state: &AppState) -> Result<Option<Value>, CommandError> {
    let session = require_vault(state)?
        .load_web_session()
        .map_err(|message| CommandError::new("secure_storage_unavailable", message))?;
    Ok(session.and_then(|session| session.get("cookies").cloned()))
}

/// Authenticated web state without a confirmed account fetch — used when the
/// account call fails for a transient reason but the session is likely still valid.
fn web_fallback_state(session: &Value) -> Value {
    json!({
        "status": "authenticated",
        "mode": "web",
        "user": { "id": session.get("userId").cloned().unwrap_or(Value::Null), "username": "" },
    })
}

/// The authenticated app state for a web (core) session. Best-effort fetches the
/// account (username/avatar) so the app has a real identity; falls back to just the
/// user id if that call fails, since the session itself is still valid.
async fn web_authenticated_state(state: &AppState, session: &Value) -> Value {
    let cookies = session.get("cookies").cloned().unwrap_or(Value::Null);
    let user = state
        .sidecar
        .call("web.account", json!({ "cookies": cookies }), false)
        .await
        .ok()
        .filter(|account| {
            account
                .get("username")
                .and_then(Value::as_str)
                .map(|name| !name.is_empty())
                .unwrap_or(false)
        })
        .unwrap_or_else(|| {
            json!({
                "id": session.get("userId").cloned().unwrap_or(Value::Null),
                "username": "",
            })
        });
    json!({ "status": "authenticated", "mode": "web", "user": user })
}

async fn persist_session(state: &AppState, auth_state: &Value) -> Result<(), CommandError> {
    if auth_state.get("status").and_then(Value::as_str) != Some("authenticated") {
        return Ok(());
    }
    let exported = state
        .sidecar
        .call("auth.export_session", json!({}), false)
        .await
        .map_err(CommandError::from)?;
    let bundle = exported.get("bundle").ok_or_else(|| {
        CommandError::new(
            "session_persistence_failed",
            "The Instagram session could not be saved.",
        )
    })?;
    require_vault(state)?
        .save_bundle(bundle)
        .map_err(|message| CommandError::new("session_persistence_failed", message))
}

async fn persist_device(state: &AppState) -> Result<(), CommandError> {
    let exported = state
        .sidecar
        .call("auth.export_device", json!({}), false)
        .await
        .map_err(CommandError::from)?;
    let bundle = exported.get("bundle").ok_or_else(|| {
        CommandError::new(
            "device_persistence_failed",
            "The Instagram device identity could not be saved.",
        )
    })?;
    require_vault(state)?
        .save_device_bundle(bundle)
        .map_err(|message| CommandError::new("device_persistence_failed", message))
}

#[tauri::command]
async fn runtime_status(state: State<'_, AppState>) -> Result<Value, CommandError> {
    let health = state
        .sidecar
        .call("health", json!({}), true)
        .await
        .map_err(CommandError::from)?;
    Ok(json!({
        "native": true,
        "protocolEngine": health.get("engine").and_then(Value::as_str).unwrap_or("unavailable"),
        "engineVersion": health.get("engineVersion").and_then(Value::as_str),
        "sessionState": health.get("session").and_then(Value::as_str).unwrap_or("signed_out"),
        "secureStorage": if state.vault.is_some() { "ready" } else { "unavailable" },
    }))
}

#[tauri::command]
async fn auth_get_state(state: State<'_, AppState>) -> Result<Value, CommandError> {
    let current = state
        .sidecar
        .call("auth.state", json!({}), true)
        .await
        .map_err(CommandError::from)?;
    if current.get("status").and_then(Value::as_str) != Some("signed_out") {
        return Ok(current);
    }

    // Core (web) session takes precedence: enter the app on the browser-minted session.
    // Validate it first so a session Instagram has killed drops cleanly to login
    // instead of leaving the app spinning forever.
    if let Some(session) = require_vault(&state)?
        .load_web_session()
        .map_err(|message| CommandError::new("secure_storage_unavailable", message))?
    {
        let cookies = session.get("cookies").cloned().unwrap_or(Value::Null);
        match state
            .sidecar
            .call("web.account", json!({ "cookies": cookies }), false)
            .await
        {
            Ok(user)
                if user
                    .get("username")
                    .and_then(Value::as_str)
                    .map(|name| !name.is_empty())
                    .unwrap_or(false) =>
            {
                return Ok(json!({ "status": "authenticated", "mode": "web", "user": user }));
            }
            Err(error) if error.code == "session_expired" => {
                let _ = require_vault(&state)?.clear_web_session();
                return Ok(json!({
                    "status": "signed_out",
                    "storageWarning": "Your Instagram web session expired. Sign in again.",
                }));
            }
            // Transient failure (network) — keep the session and enter with a fallback identity.
            _ => return Ok(web_fallback_state(&session)),
        }
    }

    let vault = require_vault(&state)?;
    let bundle = match vault.load_bundle() {
        Ok(bundle) => bundle,
        Err(message) => {
            let _ = vault.clear_bundle();
            return Ok(json!({
                "status": "signed_out",
                "storageWarning": message,
            }));
        }
    };
    let Some(bundle) = bundle else {
        return Ok(current);
    };
    let restored = state
        .sidecar
        .call("auth.restore", json!({ "bundle": bundle }), false)
        .await
        .map_err(CommandError::from)?;
    persist_session(&state, &restored).await?;
    Ok(restored)
}

#[tauri::command]
async fn auth_begin_login(
    input: LoginInput,
    state: State<'_, AppState>,
) -> Result<Value, CommandError> {
    let vault = require_vault(&state)?;
    let saved_device = vault
        .load_device_bundle()
        .map_err(|message| CommandError::new("device_restore_failed", message))?;
    let settings = saved_device.and_then(|bundle| {
        let saved_username = bundle.get("username")?.as_str()?;
        if saved_username.eq_ignore_ascii_case(&input.username) {
            bundle.get("settings").cloned()
        } else {
            None
        }
    });
    let result = state
        .sidecar
        .call(
            "auth.login",
            json!({
                "username": input.username,
                "password": input.password,
                "settings": settings,
            }),
            false,
        )
        .await
        .map_err(CommandError::from)?;
    persist_device(&state).await?;
    persist_session(&state, &result).await?;
    Ok(result)
}

#[tauri::command]
async fn auth_submit_code(
    input: CodeInput,
    state: State<'_, AppState>,
) -> Result<Value, CommandError> {
    let result = state
        .sidecar
        .call(
            "auth.submit_code",
            json!({ "operationId": input.operation_id, "code": input.code }),
            false,
        )
        .await
        .map_err(CommandError::from)?;
    persist_device(&state).await?;
    persist_session(&state, &result).await?;
    Ok(result)
}

#[tauri::command]
async fn auth_continue_manual(
    input: OperationInput,
    state: State<'_, AppState>,
) -> Result<Value, CommandError> {
    let result = state
        .sidecar
        .call(
            "auth.continue_manual",
            json!({ "operationId": input.operation_id }),
            false,
        )
        .await
        .map_err(CommandError::from)?;
    persist_device(&state).await?;
    persist_session(&state, &result).await?;
    Ok(result)
}

#[tauri::command]
async fn auth_cancel(state: State<'_, AppState>) -> Result<Value, CommandError> {
    state
        .sidecar
        .call("auth.cancel", json!({}), false)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
async fn auth_logout(state: State<'_, AppState>) -> Result<Value, CommandError> {
    let remote = state.sidecar.call("auth.logout", json!({}), false).await;
    require_vault(&state)?
        .clear_bundle()
        .map_err(|message| CommandError::new("logout_failed", message))?;
    match remote {
        Ok(result) => Ok(result),
        Err(_) => Ok(json!({ "status": "signed_out" })),
    }
}

/// Run a data method, restoring the saved session once if the engine reports it
/// is not authenticated (cold sidecar start, or a session that was dropped).
async fn call_with_restore(
    state: &AppState,
    method: &str,
    params: Value,
) -> Result<Value, CommandError> {
    let first = state.sidecar.call(method, params.clone(), false).await;
    if first.as_ref().is_err_and(|error| {
        error.code == "protocol_unavailable" || error.code == "not_authenticated"
    }) {
        if let Some(bundle) = require_vault(state)?
            .load_bundle()
            .map_err(|message| CommandError::new("session_restore_failed", message))?
        {
            let restored = state
                .sidecar
                .call("auth.restore", json!({ "bundle": bundle }), false)
                .await
                .map_err(CommandError::from)?;
            if restored.get("status").and_then(Value::as_str) == Some("authenticated") {
                return state
                    .sidecar
                    .call(method, params, false)
                    .await
                    .map_err(CommandError::from);
            }
        }
    }
    first.map_err(CommandError::from)
}

#[tauri::command]
async fn feed_timeline(
    input: TimelineInput,
    state: State<'_, AppState>,
) -> Result<Value, CommandError> {
    if let Some(cookies) = web_session_cookies(&state)? {
        return state
            .sidecar
            .call(
                "web.timeline",
                json!({ "cookies": cookies, "cursor": input.cursor }),
                false,
            )
            .await
            .map_err(CommandError::from);
    }
    call_with_restore(&state, "feed.timeline", json!({ "cursor": input.cursor })).await
}

#[tauri::command]
async fn feed_stories(state: State<'_, AppState>) -> Result<Value, CommandError> {
    if let Some(cookies) = web_session_cookies(&state)? {
        return state
            .sidecar
            .call("web.stories", json!({ "cookies": cookies }), false)
            .await
            .map_err(CommandError::from);
    }
    call_with_restore(&state, "feed.stories", json!({})).await
}

#[tauri::command]
async fn feed_reels(input: ReelsInput, state: State<'_, AppState>) -> Result<Value, CommandError> {
    call_with_restore(
        &state,
        "feed.reels",
        json!({ "cursor": input.cursor, "source": input.source }),
    )
    .await
}

#[tauri::command]
async fn feed_explore(state: State<'_, AppState>) -> Result<Value, CommandError> {
    call_with_restore(&state, "feed.explore", json!({})).await
}

#[tauri::command]
async fn media_comments(
    input: MediaInput,
    state: State<'_, AppState>,
) -> Result<Value, CommandError> {
    if let Some(cookies) = web_session_cookies(&state)? {
        return state
            .sidecar
            .call(
                "web.comments",
                json!({ "cookies": cookies, "mediaId": input.media_id }),
                false,
            )
            .await
            .map_err(CommandError::from);
    }
    call_with_restore(
        &state,
        "media.comments",
        json!({ "mediaId": input.media_id }),
    )
    .await
}

#[tauri::command]
async fn user_profile(
    input: ProfileInput,
    state: State<'_, AppState>,
) -> Result<Value, CommandError> {
    if let Some(cookies) = web_session_cookies(&state)? {
        return state
            .sidecar
            .call(
                "web.profile",
                json!({ "cookies": cookies, "username": input.username }),
                false,
            )
            .await
            .map_err(CommandError::from);
    }
    call_with_restore(
        &state,
        "user.profile",
        json!({ "username": input.username }),
    )
    .await
}

#[tauri::command]
async fn user_medias(
    input: MediasInput,
    state: State<'_, AppState>,
) -> Result<Value, CommandError> {
    if let Some(cookies) = web_session_cookies(&state)? {
        return state
            .sidecar
            .call(
                "web.medias",
                json!({ "cookies": cookies, "username": input.username }),
                false,
            )
            .await
            .map_err(CommandError::from);
    }
    call_with_restore(
        &state,
        "user.medias",
        json!({ "userId": input.user_id, "username": input.username, "cursor": input.cursor }),
    )
    .await
}

#[tauri::command]
async fn activity_inbox(state: State<'_, AppState>) -> Result<Value, CommandError> {
    call_with_restore(&state, "activity.inbox", json!({})).await
}

#[tauri::command]
async fn direct_threads(state: State<'_, AppState>) -> Result<Value, CommandError> {
    if let Some(cookies) = web_session_cookies(&state)? {
        return state
            .sidecar
            .call("web.threads", json!({ "cookies": cookies }), false)
            .await
            .map_err(CommandError::from);
    }
    call_with_restore(&state, "direct.threads", json!({})).await
}

#[tauri::command]
async fn direct_thread(
    input: ThreadInput,
    state: State<'_, AppState>,
) -> Result<Value, CommandError> {
    if let Some(cookies) = web_session_cookies(&state)? {
        return state
            .sidecar
            .call(
                "web.thread",
                json!({ "cookies": cookies, "threadId": input.thread_id }),
                false,
            )
            .await
            .map_err(CommandError::from);
    }
    call_with_restore(
        &state,
        "direct.thread",
        json!({ "threadId": input.thread_id }),
    )
    .await
}

#[tauri::command]
async fn direct_send(input: SendInput, state: State<'_, AppState>) -> Result<Value, CommandError> {
    if let Some(cookies) = web_session_cookies(&state)? {
        return state
            .sidecar
            .call(
                "web.send",
                json!({
                    "cookies": cookies,
                    "threadId": input.thread_id,
                    "text": input.text,
                    "replyToMessageId": input.reply_to_message_id,
                }),
                false,
            )
            .await
            .map_err(CommandError::from);
    }
    call_with_restore(
        &state,
        "direct.send",
        json!({ "threadId": input.thread_id, "text": input.text }),
    )
    .await
}

#[tauri::command]
async fn direct_notes(state: State<'_, AppState>) -> Result<Value, CommandError> {
    // Notes/presence are web GraphQL-only; return empty in web mode rather than erroring.
    if web_session_cookies(&state)?.is_some() {
        return Ok(json!({ "items": [] }));
    }
    call_with_restore(&state, "direct.notes", json!({})).await
}

#[tauri::command]
async fn direct_presence(state: State<'_, AppState>) -> Result<Value, CommandError> {
    if web_session_cookies(&state)?.is_some() {
        return Ok(json!({ "users": {} }));
    }
    call_with_restore(&state, "direct.presence", json!({})).await
}

fn web_session_required() -> CommandError {
    CommandError::new(
        "web_session_required",
        "This action needs an Instagram web session.",
    )
}

#[tauri::command]
async fn media_like(
    input: MediaEngageInput,
    state: State<'_, AppState>,
) -> Result<Value, CommandError> {
    if let Some(cookies) = web_session_cookies(&state)? {
        return state
            .sidecar
            .call(
                "web.like",
                json!({
                    "cookies": cookies,
                    "mediaId": input.media_id,
                    "trackingToken": input.tracking_token,
                }),
                false,
            )
            .await
            .map_err(CommandError::from);
    }
    call_with_restore(&state, "media.like", json!({ "mediaId": input.media_id })).await
}

#[tauri::command]
async fn media_unlike(
    input: MediaEngageInput,
    state: State<'_, AppState>,
) -> Result<Value, CommandError> {
    if let Some(cookies) = web_session_cookies(&state)? {
        return state
            .sidecar
            .call(
                "web.unlike",
                json!({
                    "cookies": cookies,
                    "mediaId": input.media_id,
                    "trackingToken": input.tracking_token,
                }),
                false,
            )
            .await
            .map_err(CommandError::from);
    }
    call_with_restore(&state, "media.unlike", json!({ "mediaId": input.media_id })).await
}

#[tauri::command]
async fn media_save(
    input: MediaEngageInput,
    state: State<'_, AppState>,
) -> Result<Value, CommandError> {
    if let Some(cookies) = web_session_cookies(&state)? {
        return state
            .sidecar
            .call(
                "web.save",
                json!({
                    "cookies": cookies,
                    "mediaId": input.media_id,
                    "loggingInfoToken": input.logging_info_token,
                }),
                false,
            )
            .await
            .map_err(CommandError::from);
    }
    call_with_restore(&state, "media.save", json!({ "mediaId": input.media_id })).await
}

#[tauri::command]
async fn media_unsave(
    input: MediaEngageInput,
    state: State<'_, AppState>,
) -> Result<Value, CommandError> {
    if let Some(cookies) = web_session_cookies(&state)? {
        return state
            .sidecar
            .call(
                "web.unsave",
                json!({
                    "cookies": cookies,
                    "mediaId": input.media_id,
                }),
                false,
            )
            .await
            .map_err(CommandError::from);
    }
    call_with_restore(&state, "media.unsave", json!({ "mediaId": input.media_id })).await
}

#[tauri::command]
async fn direct_mark_read(
    input: MarkReadInput,
    state: State<'_, AppState>,
) -> Result<Value, CommandError> {
    if let Some(cookies) = web_session_cookies(&state)? {
        return state
            .sidecar
            .call(
                "web.mark_read",
                json!({
                    "cookies": cookies,
                    "threadId": input.thread_id,
                    "messageId": input.message_id,
                }),
                false,
            )
            .await
            .map_err(CommandError::from);
    }
    call_with_restore(
        &state,
        "direct.mark_read",
        json!({ "threadId": input.thread_id, "messageId": input.message_id }),
    )
    .await
}

#[tauri::command]
async fn direct_react(
    input: ReactInput,
    state: State<'_, AppState>,
) -> Result<Value, CommandError> {
    if let Some(cookies) = web_session_cookies(&state)? {
        return state
            .sidecar
            .call(
                "web.react",
                json!({
                    "cookies": cookies,
                    "threadId": input.thread_id,
                    "messageId": input.message_id,
                    "emoji": input.emoji,
                }),
                false,
            )
            .await
            .map_err(CommandError::from);
    }
    call_with_restore(
        &state,
        "direct.react",
        json!({
            "threadId": input.thread_id,
            "messageId": input.message_id,
            "emoji": input.emoji,
        }),
    )
    .await
}

#[tauri::command]
async fn direct_share_media(
    input: ShareMediaInput,
    state: State<'_, AppState>,
) -> Result<Value, CommandError> {
    let cookies = web_session_cookies(&state)?.ok_or_else(web_session_required)?;
    state
        .sidecar
        .call(
            "web.share_media",
            json!({
                "cookies": cookies,
                "mediaId": input.media_id,
                "userId": input.user_id,
            }),
            false,
        )
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
async fn direct_forward(
    input: ForwardInput,
    state: State<'_, AppState>,
) -> Result<Value, CommandError> {
    let cookies = web_session_cookies(&state)?.ok_or_else(web_session_required)?;
    state
        .sidecar
        .call(
            "web.forward",
            json!({
                "cookies": cookies,
                "fromThreadId": input.from_thread_id,
                "toThreadId": input.to_thread_id,
                "text": input.text,
            }),
            false,
        )
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
async fn direct_translate(
    input: TranslateInput,
    state: State<'_, AppState>,
) -> Result<Value, CommandError> {
    let cookies = web_session_cookies(&state)?.ok_or_else(web_session_required)?;
    state
        .sidecar
        .call(
            "web.translate",
            json!({
                "cookies": cookies,
                "messageId": input.message_id,
                "text": input.text,
                "dialect": input.dialect,
            }),
            false,
        )
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
fn telemetry_set_consent(input: TelemetryInput, state: State<'_, AppState>) -> Value {
    state
        .telemetry_consent
        .store(input.enabled, Ordering::Relaxed);
    json!({ "enabled": input.enabled, "sink": "none" })
}

/// Store the credentials captured in SpeedGram's own UI. One capture serves both
/// contexts: it autofills the web login here, and later mints the mobile session.
#[tauri::command]
async fn save_web_credentials(
    input: CredentialsInput,
    state: State<'_, AppState>,
) -> Result<Value, CommandError> {
    let username = input.username.trim().to_owned();
    if username.is_empty() || input.password.is_empty() {
        return Err(CommandError::new(
            "invalid_credentials",
            "A username and password are required.",
        ));
    }
    require_vault(&state)?
        .save_credentials(&json!({ "username": username, "password": input.password }))
        .map_err(|message| CommandError::new("credential_persistence_failed", message))?;
    Ok(json!({ "stored": true, "username": username }))
}

/// Store a web session from cookies the user pasted in by hand — a stopgap for when
/// a live login can't be initiated (e.g. the IP is temporarily blocked).
#[tauri::command]
async fn save_web_session_manual(
    input: ManualSessionInput,
    state: State<'_, AppState>,
) -> Result<Value, CommandError> {
    let session = parse_web_session(&input.cookies).ok_or_else(|| {
        CommandError::new(
            "invalid_cookies",
            "Paste the Instagram cookies, including a non-empty sessionid.",
        )
    })?;
    require_vault(&state)?
        .save_web_session(&session)
        .map_err(|message| CommandError::new("session_persistence_failed", message))?;
    // Return the full authenticated state so the UI enters the app with a real account.
    Ok(web_authenticated_state(&state, &session).await)
}

/// Report what the vault already holds so the UI can skip steps the user has done.
#[tauri::command]
fn web_session_status(state: State<'_, AppState>) -> Result<Value, CommandError> {
    let vault = require_vault(&state)?;
    let has_web_session = vault
        .load_web_session()
        .map_err(|message| CommandError::new("secure_storage_unavailable", message))?
        .is_some();
    let has_credentials = vault
        .load_credentials()
        .map_err(|message| CommandError::new("secure_storage_unavailable", message))?
        .is_some();
    Ok(json!({ "hasWebSession": has_web_session, "hasCredentials": has_credentials }))
}

/// Forget the captured web cookies (e.g. "sign out of web") without touching the
/// stored credentials or the mobile session.
#[tauri::command]
fn clear_web_session(state: State<'_, AppState>) -> Result<Value, CommandError> {
    require_vault(&state)?
        .clear_web_session()
        .map_err(|message| CommandError::new("secure_storage_unavailable", message))?;
    Ok(json!({ "cleared": true }))
}

/// Open Instagram's real web login in a dedicated window, autofill the stored
/// credentials, and hand off to a background task that captures the browser-minted
/// session cookies once the user completes login (including any 2FA/checkpoint).
#[tauri::command]
async fn begin_web_login(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, CommandError> {
    let credentials = require_vault(&state)?
        .load_credentials()
        .map_err(|message| CommandError::new("credential_restore_failed", message))?;

    if let Some(existing) = app.get_webview_window(LOGIN_WEBVIEW_LABEL) {
        let _ = existing.set_focus();
        return Ok(json!({ "status": "web_login_in_progress" }));
    }

    let url: Url = IG_LOGIN_URL.parse().map_err(|_| {
        CommandError::new("web_login_failed", "The Instagram login URL is invalid.")
    })?;
    let mut builder =
        WebviewWindowBuilder::new(&app, LOGIN_WEBVIEW_LABEL, WebviewUrl::External(url))
            .title("Log into Instagram")
            .inner_size(480.0, 720.0)
            .center();
    if let Some(script) = autofill_script(credentials.as_ref()) {
        builder = builder.initialization_script(&script);
    }
    let window = builder.build().map_err(|error| {
        CommandError::new(
            "web_login_failed",
            format!("The Instagram login window could not open: {error}"),
        )
    })?;

    spawn_cookie_capture(app.clone(), window);
    Ok(json!({ "status": "web_login_started" }))
}

/// Best-effort autofill for Instagram's React-controlled login form. Fills the
/// fields but never submits — the user reviews and completes login themselves,
/// which also lets Instagram's own UI handle 2FA and checkpoints naturally.
fn autofill_script(credentials: Option<&Value>) -> Option<String> {
    let credentials = credentials?;
    let username = credentials
        .get("username")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let password = credentials
        .get("password")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if username.is_empty() || password.is_empty() {
        return None;
    }
    // serde_json produces a safely-quoted, escaped JS string literal.
    let username_literal = serde_json::to_string(username).ok()?;
    let password_literal = serde_json::to_string(password).ok()?;
    Some(format!(
        r#"(function() {{
  var U = {username_literal}, P = {password_literal};
  function setValue(el, val) {{
    var desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    if (desc && desc.set) {{ desc.set.call(el, val); }} else {{ el.value = val; }}
    el.dispatchEvent(new Event('input', {{ bubbles: true }}));
  }}
  function fill() {{
    var user = document.querySelector('input[name="username"], input[autocomplete="username"]');
    var pass = document.querySelector('input[name="password"], input[type="password"], input[autocomplete="current-password"]');
    if (!user || !pass) return false;
    if (!user.value) setValue(user, U);
    if (!pass.value) setValue(pass, P);
    return true;
  }}
  var tries = 0;
  var timer = setInterval(function() {{
    if (fill() || ++tries > 40) clearInterval(timer);
  }}, 250);
}})();"#
    ))
}

/// Poll the login window's cookie store until Instagram sets a `sessionid`, then
/// persist the browser-minted web session and close the window.
fn spawn_cookie_capture(app: AppHandle, window: WebviewWindow) {
    tauri::async_runtime::spawn(async move {
        let origin: Url = match IG_ORIGIN.parse() {
            Ok(url) => url,
            Err(_) => return,
        };
        let deadline = Instant::now() + Duration::from_secs(300);
        loop {
            // The user closed the window before finishing.
            if app.get_webview_window(LOGIN_WEBVIEW_LABEL).is_none() {
                let _ = app.emit(WEB_LOGIN_EVENT, json!({ "status": "cancelled" }));
                return;
            }
            if Instant::now() > deadline {
                let _ = app.emit(WEB_LOGIN_EVENT, json!({ "status": "timeout" }));
                let _ = window.destroy();
                return;
            }
            if let Ok(cookies) = window.cookies_for_url(origin.clone()) {
                if let Some(session) = build_web_session(&cookies) {
                    let persisted = {
                        let state = app.state::<AppState>();
                        match state.vault.as_ref() {
                            Some(vault) => vault.save_web_session(&session),
                            None => Err("Secure storage is unavailable.".to_owned()),
                        }
                    };
                    match persisted {
                        Ok(()) => {
                            let _ = app.emit(
                                WEB_LOGIN_EVENT,
                                json!({ "status": "authenticated", "userId": session.get("userId") }),
                            );
                        }
                        Err(message) => {
                            let _ = app.emit(
                                WEB_LOGIN_EVENT,
                                json!({ "status": "error", "message": message }),
                            );
                        }
                    }
                    let _ = window.destroy();
                    return;
                }
            }
            tokio::time::sleep(Duration::from_millis(1500)).await;
        }
    });
}

/// Collect cookies captured from the login webview into a session bundle.
fn build_web_session(cookies: &[Cookie<'static>]) -> Option<Value> {
    let mut jar = serde_json::Map::new();
    for cookie in cookies {
        jar.insert(
            cookie.name().to_owned(),
            Value::String(cookie.value().to_owned()),
        );
    }
    web_session_from_jar(jar)
}

/// Accept either a Cookie-Editor style JSON export (array of `{name, value, ...}`)
/// or a raw `name=value; name=value` string, auto-detecting which was pasted.
fn parse_web_session(raw: &str) -> Option<Value> {
    let trimmed = raw.trim();
    if trimmed.starts_with('[') || trimmed.starts_with('{') {
        if let Some(session) = parse_cookie_json(trimmed) {
            return Some(session);
        }
    }
    parse_cookie_header(trimmed)
}

/// Parse a JSON cookie export (browser cookie-editor extensions): an array of
/// objects each carrying at least `name` and `value`.
fn parse_cookie_json(raw: &str) -> Option<Value> {
    let parsed: Value = serde_json::from_str(raw).ok()?;
    let items = match parsed {
        Value::Array(items) => items,
        object @ Value::Object(_) => vec![object],
        _ => return None,
    };
    let mut jar = serde_json::Map::new();
    for item in items {
        let name = item.get("name").and_then(Value::as_str).unwrap_or_default();
        let value = item.get("value").and_then(Value::as_str);
        if let (false, Some(value)) = (name.is_empty(), value) {
            jar.insert(name.to_owned(), Value::String(value.to_owned()));
        }
    }
    web_session_from_jar(jar)
}

/// Parse a raw `name=value; name=value` cookie string (as copied from a browser's
/// devtools or `document.cookie`) into the same session bundle shape.
fn parse_cookie_header(raw: &str) -> Option<Value> {
    let mut jar = serde_json::Map::new();
    for part in raw.split(';') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some((name, value)) = part.split_once('=') {
            let name = name.trim();
            if !name.is_empty() {
                let value = value.trim().trim_matches('"');
                jar.insert(name.to_owned(), Value::String(value.to_owned()));
            }
        }
    }
    web_session_from_jar(jar)
}

/// A bundle is only valid once a non-empty `sessionid` is present — that is what
/// marks a real, logged-in session. Lift out the user id for display.
fn web_session_from_jar(jar: serde_json::Map<String, Value>) -> Option<Value> {
    let has_session = jar
        .get(WEB_SESSION_COOKIE)
        .and_then(Value::as_str)
        .map(|value| !value.is_empty())
        .unwrap_or(false);
    if !has_session {
        return None;
    }
    let user_id = jar.get("ds_user_id").cloned().unwrap_or(Value::Null);
    Some(json!({ "userId": user_id, "cookies": Value::Object(jar) }))
}

/// Decode the target image URL from an `igimg://img/<base64url>` request path, and
/// only allow Instagram/Meta image hosts (SSRF guard).
fn decode_image_target(path: &str) -> Option<String> {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    let encoded = path.trim_start_matches('/');
    let bytes = URL_SAFE_NO_PAD.decode(encoded).ok()?;
    let url = String::from_utf8(bytes).ok()?;
    let allowed = url.starts_with("https://")
        && (url.contains(".cdninstagram.com")
            || url.contains(".fbcdn.net")
            || url.contains(".instagram.com"));
    allowed.then_some(url)
}

fn image_cookie_header(state: &AppState) -> String {
    state
        .vault
        .as_ref()
        .and_then(|vault| vault.load_web_session().ok().flatten())
        .and_then(|session| session.get("cookies").cloned())
        .and_then(|cookies| cookies.as_object().cloned())
        .map(|jar| {
            jar.iter()
                .filter_map(|(name, value)| value.as_str().map(|v| format!("{name}={v}")))
                .collect::<Vec<_>>()
                .join("; ")
        })
        .unwrap_or_default()
}

/// Proxy an Instagram image server-side with the browser Referer + session cookies
/// so hotlink/geo-restricted CDN URLs (profile pics) load in the webview.
async fn fetch_ig_image(app: AppHandle, path: String) -> tauri::http::Response<Vec<u8>> {
    let empty = |status: u16| {
        tauri::http::Response::builder()
            .status(status)
            .body(Vec::new())
            .unwrap()
    };
    let Some(target) = decode_image_target(&path) else {
        return empty(400);
    };
    let (client, cookie_header) = {
        let state = app.state::<AppState>();
        (state.http_client.clone(), image_cookie_header(&state))
    };
    let mut request = client
        .get(&target)
        .header("Referer", "https://www.instagram.com/")
        .header("User-Agent", WEB_USER_AGENT);
    if !cookie_header.is_empty() {
        request = request.header("Cookie", cookie_header);
    }
    match request.send().await {
        Ok(response) if response.status().is_success() => {
            let content_type = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("image/jpeg")
                .to_owned();
            match response.bytes().await {
                Ok(bytes) => tauri::http::Response::builder()
                    .status(200)
                    .header("Content-Type", content_type)
                    .header("Cache-Control", "max-age=86400")
                    .body(bytes.to_vec())
                    .unwrap(),
                Err(_) => empty(502),
            }
        }
        Ok(response) => empty(response.status().as_u16()),
        Err(_) => empty(502),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .register_asynchronous_uri_scheme_protocol(IMAGE_SCHEME, |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let path = request.uri().path().to_owned();
            tauri::async_runtime::spawn(async move {
                responder.respond(fetch_ig_image(app, path).await);
            });
        })
        .setup(|app| {
            let vault_result = SecretVault::open(app.handle());
            let (vault, vault_error) = match vault_result {
                Ok(vault) => (Some(vault), None),
                Err(error) => (None, Some(error)),
            };
            app.manage(AppState {
                sidecar: SidecarManager::new(app.handle().clone()),
                vault,
                vault_error,
                telemetry_consent: AtomicBool::new(false),
                http_client: reqwest::Client::new(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_status,
            auth_get_state,
            auth_begin_login,
            auth_submit_code,
            auth_continue_manual,
            auth_cancel,
            auth_logout,
            feed_timeline,
            feed_stories,
            feed_reels,
            feed_explore,
            media_comments,
            user_profile,
            user_medias,
            activity_inbox,
            direct_threads,
            direct_thread,
            direct_send,
            direct_notes,
            direct_presence,
            media_like,
            media_unlike,
            media_save,
            media_unsave,
            direct_mark_read,
            direct_react,
            direct_share_media,
            direct_forward,
            direct_translate,
            save_web_credentials,
            begin_web_login,
            save_web_session_manual,
            web_session_status,
            clear_web_session,
            telemetry_set_consent,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SpeedGram");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_errors_are_redacted_and_structured() {
        let error = CommandError::from(RpcError {
            code: "rate_limited".into(),
            message: "Instagram asked this device to slow down.".into(),
        });
        let serialized = serde_json::to_string(&error).unwrap();
        assert_eq!(
            serialized,
            r#"{"code":"rate_limited","message":"Instagram asked this device to slow down."}"#
        );
        assert!(!serialized.contains("password"));
        assert!(!serialized.contains("sessionid"));
    }

    #[test]
    fn parse_cookie_header_requires_a_sessionid() {
        assert!(parse_cookie_header("csrftoken=abc; mid=xyz").is_none());
        assert!(parse_cookie_header("sessionid=; ds_user_id=42").is_none());

        let session =
            parse_cookie_header("sessionid=42%3Aabc; ds_user_id=42; csrftoken=tok").unwrap();
        assert_eq!(session["userId"], json!("42"));
        assert_eq!(session["cookies"]["sessionid"], json!("42%3Aabc"));
        assert_eq!(session["cookies"]["csrftoken"], json!("tok"));
    }

    #[test]
    fn parse_web_session_accepts_cookie_editor_json() {
        let export = r#"[
            {"name": "csrftoken", "value": "tok", "domain": ".instagram.com"},
            {"name": "ds_user_id", "value": "50849711309", "httpOnly": false},
            {"name": "sessionid", "value": "50849711309%3Aabc%3A0%3Adef", "httpOnly": true}
        ]"#;
        let session = parse_web_session(export).unwrap();
        assert_eq!(session["userId"], json!("50849711309"));
        assert_eq!(
            session["cookies"]["sessionid"],
            json!("50849711309%3Aabc%3A0%3Adef")
        );
        assert_eq!(session["cookies"]["csrftoken"], json!("tok"));

        // A JSON array with no sessionid is rejected like any other.
        assert!(parse_web_session(r#"[{"name": "mid", "value": "x"}]"#).is_none());
    }
}
