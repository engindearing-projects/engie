use crossbeam_channel::Sender;
use serde_json::{json, Value};
use std::time::Duration;
use tracing::{debug, info, warn};
use tungstenite::{connect, Message};

/// Events sent from the gateway thread to the main (tray) thread.
#[derive(Debug, Clone)]
pub enum GatewayEvent {
    Connected,
    Disconnected,
    ToolCall { name: String },
    Status { text: String },
}

/// Run the gateway connection loop. This function blocks forever and should
/// be called from a dedicated thread. It connects to the gateway, authenticates,
/// reads messages, and forwards relevant events through the channel.
/// Uses exponential backoff on disconnect: 1s, 2s, 4s, ... up to 30s max.
/// Resets to 1s on successful authentication.
pub fn connect_loop(gateway_url: &str, token: Option<&str>, tx: Sender<GatewayEvent>) {
    let mut backoff = Duration::from_secs(1);
    const MAX_BACKOFF: Duration = Duration::from_secs(30);

    loop {
        info!(url = gateway_url, "connecting to gateway");

        match connect(gateway_url) {
            Ok((mut ws, _response)) => {
                info!("websocket connected, waiting for challenge");

                // Read messages until disconnect
                let mut authed = false;
                let mut req_id: u64 = 0;

                loop {
                    match ws.read() {
                        Ok(Message::Text(text)) => {
                            let msg: Value = match serde_json::from_str(&text) {
                                Ok(v) => v,
                                Err(_) => continue,
                            };

                            // Handle connect.challenge
                            if msg.get("type").and_then(|v| v.as_str()) == Some("event")
                                && msg.get("event").and_then(|v| v.as_str())
                                    == Some("connect.challenge")
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
                                            "id": "familiar-tray",
                                            "version": "0.1.0",
                                            "platform": "rust",
                                            "mode": "tray"
                                        },
                                        "role": "operator",
                                        "scopes": ["operator.read"],
                                        "auth": {
                                            "token": token.unwrap_or("")
                                        }
                                    }
                                });

                                if let Err(e) = ws.send(Message::Text(auth_msg.to_string().into())) {
                                    warn!(error = %e, "failed to send auth message");
                                    break;
                                }
                                debug!("sent auth message");
                                continue;
                            }

                            // Handle auth response
                            if msg.get("type").and_then(|v| v.as_str()) == Some("res")
                                && msg.get("id").and_then(|v| v.as_str()) == Some("1")
                            {
                                if msg.get("ok").and_then(|v| v.as_bool()) == Some(true) {
                                    info!("gateway auth successful");
                                    authed = true;
                                    backoff = Duration::from_secs(1);
                                    let _ = tx.send(GatewayEvent::Connected);
                                } else {
                                    warn!(msg = %msg, "gateway auth failed");
                                    break;
                                }
                                continue;
                            }

                            if !authed {
                                continue;
                            }

                            // Handle agent events (tool calls, status)
                            if msg.get("type").and_then(|v| v.as_str()) == Some("event") {
                                let event = msg.get("event").and_then(|v| v.as_str());
                                let payload = msg.get("payload");

                                match event {
                                    Some("agent") => {
                                        if let Some(p) = payload {
                                            // Look for tool_call events
                                            if let Some(tool) =
                                                p.get("tool").and_then(|v| v.as_str())
                                            {
                                                let _ = tx.send(GatewayEvent::ToolCall {
                                                    name: tool.to_string(),
                                                });
                                            }
                                            // Look for status text
                                            if let Some(status) =
                                                p.get("status").and_then(|v| v.as_str())
                                            {
                                                let _ = tx.send(GatewayEvent::Status {
                                                    text: status.to_string(),
                                                });
                                            }
                                        }
                                    }
                                    // Skip noise events
                                    Some("tick" | "health" | "presence") => {}
                                    _ => {
                                        debug!(event = ?event, "unhandled gateway event");
                                    }
                                }
                            }
                        }
                        Ok(Message::Ping(data)) => {
                            let _ = ws.send(Message::Pong(data));
                        }
                        Ok(Message::Close(_)) => {
                            info!("gateway sent close frame");
                            break;
                        }
                        Ok(_) => {}
                        Err(e) => {
                            warn!(error = %e, "websocket read error");
                            break;
                        }
                    }
                }

                // Disconnected
                let _ = tx.send(GatewayEvent::Disconnected);
                info!("disconnected from gateway");
            }
            Err(e) => {
                debug!(error = %e, "could not connect to gateway");
                let _ = tx.send(GatewayEvent::Disconnected);
            }
        }

        // Exponential backoff before reconnecting
        info!(backoff_secs = backoff.as_secs(), "waiting before reconnect");
        std::thread::sleep(backoff);
        backoff = (backoff * 2).min(MAX_BACKOFF);
    }
}
