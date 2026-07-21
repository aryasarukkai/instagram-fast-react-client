use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::AppHandle;
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};
use tokio::sync::{mpsc::Receiver, Mutex};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(45);

struct Process {
    child: CommandChild,
    receiver: Receiver<CommandEvent>,
}

#[derive(Debug, Clone)]
pub struct RpcError {
    pub code: String,
    pub message: String,
}

impl RpcError {
    fn unavailable() -> Self {
        Self {
            code: "protocol_unavailable".into(),
            message: "The local Instagram engine is unavailable.".into(),
        }
    }
}

pub struct SidecarManager {
    app: AppHandle,
    process: Arc<Mutex<Option<Process>>>,
    next_id: AtomicU64,
}

impl SidecarManager {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            process: Arc::new(Mutex::new(None)),
            next_id: AtomicU64::new(1),
        }
    }

    fn spawn(&self) -> Result<Process, RpcError> {
        let command = self
            .app
            .shell()
            .sidecar("speedgram-protocol")
            .map_err(|_| RpcError::unavailable())?;
        let (receiver, child) = command.spawn().map_err(|_| RpcError::unavailable())?;
        Ok(Process { child, receiver })
    }

    async fn call_once(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        let request_id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let request = serde_json::to_vec(&json!({
            "id": request_id,
            "method": method,
            "params": params,
        }))
        .map_err(|_| RpcError::unavailable())?;

        let mut guard = self.process.lock().await;
        if guard.is_none() {
            *guard = Some(self.spawn()?);
        }
        let process = guard.as_mut().ok_or_else(RpcError::unavailable)?;
        let mut line = request;
        line.push(b'\n');
        if process.child.write(&line).is_err() {
            *guard = None;
            return Err(RpcError::unavailable());
        }

        let response = tokio::time::timeout(REQUEST_TIMEOUT, async {
            loop {
                match process.receiver.recv().await {
                    Some(CommandEvent::Stdout(bytes)) => {
                        let payload: Value = match serde_json::from_slice(&bytes) {
                            Ok(payload) => payload,
                            Err(_) => continue,
                        };
                        if payload.get("id").and_then(Value::as_u64) == Some(request_id) {
                            return Ok(payload);
                        }
                    }
                    Some(CommandEvent::Stderr(_)) => {
                        // Deliberately do not forward Python diagnostics; they may contain API data.
                    }
                    Some(CommandEvent::Error(_)) | Some(CommandEvent::Terminated(_)) | None => {
                        return Err(RpcError::unavailable());
                    }
                    _ => {}
                }
            }
        })
        .await;

        match response {
            Ok(Ok(payload)) => {
                if let Some(error) = payload.get("error") {
                    return Err(RpcError {
                        code: error
                            .get("code")
                            .and_then(Value::as_str)
                            .unwrap_or("protocol_error")
                            .to_owned(),
                        message: error
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or("The local Instagram engine could not complete the request.")
                            .to_owned(),
                    });
                }
                Ok(payload.get("result").cloned().unwrap_or(Value::Null))
            }
            _ => {
                if let Some(process) = guard.take() {
                    let _ = process.child.kill();
                }
                Err(RpcError::unavailable())
            }
        }
    }

    pub async fn call(
        &self,
        method: &str,
        params: Value,
        retryable: bool,
    ) -> Result<Value, RpcError> {
        let first = self.call_once(method, params.clone()).await;
        if retryable
            && first
                .as_ref()
                .is_err_and(|error| error.code == "protocol_unavailable")
        {
            let mut guard = self.process.lock().await;
            if let Some(process) = guard.take() {
                let _ = process.child.kill();
            }
            drop(guard);
            return self.call_once(method, params).await;
        }
        first
    }
}
