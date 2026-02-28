use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{debug, info, warn};

use crate::protocol::{tool_label, GatewayEvent};

/// Async gateway connection loop. Sends parsed events through `tx`.
/// Receives outgoing messages (JSON strings) from `out_rx`.
pub async fn connect_loop(
    gateway_url: String,
    token: Option<String>,
    tx: mpsc::UnboundedSender<GatewayEvent>,
    mut out_rx: mpsc::UnboundedReceiver<String>,
) {
    let mut backoff = Duration::from_secs(1);
    const MAX_BACKOFF: Duration = Duration::from_secs(30);

    loop {
        info!(url = %gateway_url, "connecting to gateway");

        match connect_async(&gateway_url).await {
            Ok((ws_stream, _)) => {
                info!("websocket connected, waiting for challenge");
                let (mut ws_tx, mut ws_rx) = ws_stream.split();

                let mut authed = false;
                let mut req_id: u64 = 0;

                loop {
                    tokio::select! {
                        // Incoming WebSocket messages
                        msg = ws_rx.next() => {
                            match msg {
                                Some(Ok(Message::Text(text))) => {
                                    let parsed: Value = match serde_json::from_str(&text) {
                                        Ok(v) => v,
                                        Err(_) => continue,
                                    };

                                    // Handle connect.challenge
                                    if parsed.get("type").and_then(|v| v.as_str()) == Some("event")
                                        && parsed.get("event").and_then(|v| v.as_str()) == Some("connect.challenge")
                                    {
                                        req_id += 1;
                                        let auth_msg = json!({
                                            "type": "req",
                                            "id": req_id.to_string(),
                                            "method": "connect",
                                            "params": {
                                                "minProtocol": 3,
                                                "maxProtocol": 3,
                                                "client": {
                                                    "id": "familiar-terminal",
                                                    "version": "0.1.0",
                                                    "platform": "rust",
                                                    "mode": "terminal"
                                                },
                                                "role": "operator",
                                                "scopes": ["operator.read", "chat"],
                                                "auth": {
                                                    "token": token.as_deref().unwrap_or("")
                                                }
                                            }
                                        });

                                        if let Err(e) = ws_tx.send(Message::Text(auth_msg.to_string().into())).await {
                                            warn!(error = %e, "failed to send auth");
                                            break;
                                        }
                                        debug!("sent auth message");
                                        continue;
                                    }

                                    // Handle auth response
                                    if parsed.get("type").and_then(|v| v.as_str()) == Some("res")
                                        && parsed.get("id").and_then(|v| v.as_str()) == Some("1")
                                    {
                                        if parsed.get("ok").and_then(|v| v.as_bool()) == Some(true) {
                                            info!("gateway auth successful");
                                            authed = true;
                                            backoff = Duration::from_secs(1);
                                            let _ = tx.send(GatewayEvent::Connected);
                                        } else {
                                            warn!(msg = %parsed, "gateway auth failed");
                                            break;
                                        }
                                        continue;
                                    }

                                    // Handle chat.send acknowledgements
                                    if parsed.get("type").and_then(|v| v.as_str()) == Some("res") {
                                        // Just an ack for our request, skip
                                        continue;
                                    }

                                    if !authed {
                                        continue;
                                    }

                                    // Handle broadcast events
                                    if parsed.get("type").and_then(|v| v.as_str()) == Some("event") {
                                        let event_name = parsed.get("event").and_then(|v| v.as_str());
                                        let payload = parsed.get("payload");

                                        match event_name {
                                            Some("agent") => {
                                                if let Some(p) = payload {
                                                    // Tool call
                                                    if let Some(tool) = p.get("tool").and_then(|v| v.as_str()) {
                                                        let label = tool_label(tool);
                                                        let _ = tx.send(GatewayEvent::ToolStart {
                                                            name: tool.to_string(),
                                                            label,
                                                        });
                                                    }
                                                    // Stream delta
                                                    if let Some(delta) = p.get("data")
                                                        .and_then(|d| d.get("delta"))
                                                        .and_then(|d| d.as_str())
                                                    {
                                                        let _ = tx.send(GatewayEvent::StreamDelta {
                                                            text: delta.to_string(),
                                                        });
                                                    }
                                                    // Status
                                                    if let Some(status) = p.get("status").and_then(|v| v.as_str()) {
                                                        let _ = tx.send(GatewayEvent::Status {
                                                            text: status.to_string(),
                                                        });
                                                    }
                                                }
                                            }
                                            Some("chat") => {
                                                if let Some(p) = payload {
                                                    let state = p.get("state").and_then(|v| v.as_str());
                                                    match state {
                                                        Some("final") => {
                                                            let content = p.get("message")
                                                                .and_then(|m| m.get("content"))
                                                                .and_then(|c| c.as_str())
                                                                .unwrap_or("")
                                                                .to_string();
                                                            let _ = tx.send(GatewayEvent::ChatFinal { content });
                                                        }
                                                        Some("error") => {
                                                            let message = p.get("errorMessage")
                                                                .or_else(|| p.get("error"))
                                                                .and_then(|e| e.as_str())
                                                                .unwrap_or("unknown error")
                                                                .to_string();
                                                            let _ = tx.send(GatewayEvent::ChatError { message });
                                                        }
                                                        _ => {}
                                                    }
                                                }
                                            }
                                            Some("tick" | "health" | "presence") => {}
                                            _ => {
                                                debug!(event = ?event_name, "unhandled gateway event");
                                            }
                                        }
                                    }
                                }
                                Some(Ok(Message::Ping(data))) => {
                                    let _ = ws_tx.send(Message::Pong(data)).await;
                                }
                                Some(Ok(Message::Close(_))) => {
                                    info!("gateway sent close frame");
                                    break;
                                }
                                Some(Ok(_)) => {}
                                Some(Err(e)) => {
                                    warn!(error = %e, "websocket read error");
                                    break;
                                }
                                None => {
                                    info!("websocket stream ended");
                                    break;
                                }
                            }
                        }
                        // Outgoing messages from the app
                        Some(out_msg) = out_rx.recv() => {
                            if let Err(e) = ws_tx.send(Message::Text(out_msg.into())).await {
                                warn!(error = %e, "failed to send outgoing message");
                                break;
                            }
                        }
                    }
                }

                let _ = tx.send(GatewayEvent::Disconnected);
                info!("disconnected from gateway");
            }
            Err(e) => {
                debug!(error = %e, "could not connect to gateway");
                let _ = tx.send(GatewayEvent::Disconnected);
            }
        }

        info!(backoff_secs = backoff.as_secs(), "waiting before reconnect");
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(MAX_BACKOFF);
    }
}

/// Build a chat.send request JSON string.
pub fn build_chat_send(req_id: u64, session_key: &str, message: &str) -> String {
    let req = json!({
        "type": "req",
        "id": req_id.to_string(),
        "method": "chat.send",
        "params": {
            "sessionKey": session_key,
            "message": message,
        }
    });
    req.to_string()
}
