use std::time::{Duration, Instant};

use crossterm::event::{Event as CEvent, EventStream};
use futures_util::StreamExt;
use tokio::sync::mpsc;
use tracing::{info, warn};

use crate::config::FamiliarConfig;
use crate::gateway;
use crate::input::{self, InputAction};
use crate::protocol::GatewayEvent;
use crate::state::{AppState, ConnectionState};
use crate::theme::ThemeColors;
use crate::ui;

const TICK_RATE: Duration = Duration::from_millis(250);
const SESSION_KEY: &str = "agent:familiar:terminal";
const IDLE_PHRASE_INTERVAL: Duration = Duration::from_secs(2);

pub async fn run(config: FamiliarConfig) -> anyhow::Result<()> {
    let token = config.gateway_token();
    let gateway_url = config.gateway.url.clone();

    // Resolve theme
    let (_theme_name, theme) = ThemeColors::resolve();

    // App state
    let mut state = AppState::new();
    state.connection = ConnectionState::Connecting;

    // Gateway channels
    let (gw_tx, mut gw_rx) = mpsc::unbounded_channel::<GatewayEvent>();
    let (out_tx, out_rx) = mpsc::unbounded_channel::<String>();

    // Spawn gateway connection loop
    tokio::spawn(async move {
        gateway::connect_loop(gateway_url, token, gw_tx, out_rx).await;
    });

    // Setup terminal
    let mut terminal = ratatui::init();
    terminal.clear()?;

    // Crossterm event stream
    let mut reader = EventStream::new();

    let mut req_id: u64 = 100; // start above auth IDs
    let mut last_tick = Instant::now();
    let mut last_phrase_change = Instant::now();
    let mut spinner_tick: u64 = 0;

    // Main event loop
    loop {
        // Draw
        terminal.draw(|f| {
            ui::render(f, &state, &theme);
        })?;

        if state.should_quit {
            break;
        }

        let tick_timeout = TICK_RATE.checked_sub(last_tick.elapsed()).unwrap_or(Duration::ZERO);

        tokio::select! {
            // Terminal events
            maybe_event = reader.next() => {
                if let Some(Ok(event)) = maybe_event {
                    match event {
                        CEvent::Key(key) => {
                            let action = input::handle_key(key, &mut state);
                            match action {
                                InputAction::Submit(text) => {
                                    handle_submit(&text, &mut state, &mut req_id, &out_tx);
                                }
                                InputAction::Quit => {
                                    state.should_quit = true;
                                }
                                InputAction::ScrollUp => {
                                    state.auto_scroll = false;
                                    state.scroll_offset = state.scroll_offset.saturating_add(5);
                                }
                                InputAction::ScrollDown => {
                                    if state.scroll_offset > 0 {
                                        state.scroll_offset = state.scroll_offset.saturating_sub(5);
                                    } else {
                                        state.auto_scroll = true;
                                    }
                                }
                                InputAction::ScrollToBottom => {
                                    state.auto_scroll = true;
                                    state.scroll_offset = 0;
                                }
                                InputAction::Clear => {
                                    state.messages.clear();
                                    state.scroll_offset = 0;
                                    state.auto_scroll = true;
                                }
                                InputAction::None => {}
                            }
                        }
                        CEvent::Resize(_, _) => {
                            // Terminal will re-draw on next loop
                        }
                        _ => {}
                    }
                }
            }

            // Gateway events
            Some(gw_event) = gw_rx.recv() => {
                handle_gateway_event(gw_event, &mut state, &mut req_id, &out_tx);
            }

            // Tick
            _ = tokio::time::sleep(tick_timeout) => {
                last_tick = Instant::now();
                spinner_tick += 1;

                // Cycle idle phrase every 2s while busy with no text
                if state.busy && state.stream_text.is_empty() && state.current_tool.is_none() {
                    if last_phrase_change.elapsed() >= IDLE_PHRASE_INTERVAL {
                        state.next_idle_phrase();
                        last_phrase_change = Instant::now();
                    }
                }

                // Advance spinner frame independently
                if state.busy {
                    state.spinner_tick = spinner_tick as usize;
                }
            }
        }
    }

    // Restore terminal
    ratatui::restore();
    Ok(())
}

fn handle_submit(
    text: &str,
    state: &mut AppState,
    req_id: &mut u64,
    out_tx: &mpsc::UnboundedSender<String>,
) {
    // Handle slash commands locally
    if text.starts_with('/') {
        handle_slash_command(text, state);
        return;
    }

    if state.connection != ConnectionState::Connected {
        state.add_system_message("not connected to gateway".into());
        return;
    }

    // If busy, queue the message
    if state.busy {
        state.queue.push(text.to_string());
        state.add_system_message(format!("queued ({})", state.queue.len()));
        return;
    }

    // Send to gateway
    state.add_user_message(text.to_string());
    state.busy = true;
    state.stream_text.clear();
    state.current_tool = None;
    state.auto_scroll = true;

    *req_id += 1;
    let msg = gateway::build_chat_send(*req_id, SESSION_KEY, text);
    if let Err(e) = out_tx.send(msg) {
        warn!(error = %e, "failed to send to gateway");
        state.busy = false;
        state.add_system_message("failed to send message".into());
    }
}

fn handle_slash_command(text: &str, state: &mut AppState) {
    let parts: Vec<&str> = text.splitn(2, ' ').collect();
    let cmd = parts[0];
    let _args = parts.get(1).copied().unwrap_or("");

    match cmd {
        "/help" => {
            state.add_system_message(
                "commands: /help /clear /status /quit /morning".into(),
            );
        }
        "/clear" => {
            state.messages.clear();
            state.scroll_offset = 0;
            state.auto_scroll = true;
        }
        "/status" => {
            let conn = match state.connection {
                ConnectionState::Connected => "connected",
                ConnectionState::Connecting => "connecting",
                ConnectionState::Disconnected => "disconnected",
            };
            state.add_system_message(format!(
                "connection: {} | uptime: {} | messages: {}",
                conn,
                state.uptime(),
                state.messages.len()
            ));
        }
        "/quit" => {
            state.should_quit = true;
        }
        "/morning" => {
            // Expand to a morning check message — will be submitted as regular text
            state.input = "Check my Jira board, PRs, and Slack for today's priorities".into();
            state.cursor_pos = state.input.len();
        }
        _ => {
            state.add_system_message(format!("unknown command: {}", cmd));
        }
    }
}

fn handle_gateway_event(
    event: GatewayEvent,
    state: &mut AppState,
    req_id: &mut u64,
    out_tx: &mpsc::UnboundedSender<String>,
) {
    match event {
        GatewayEvent::Connected => {
            info!("gateway connected");
            state.connection = ConnectionState::Connected;
            state.add_system_message("connected to gateway".into());
        }
        GatewayEvent::Disconnected => {
            info!("gateway disconnected");
            state.connection = ConnectionState::Disconnected;
            if state.busy {
                state.busy = false;
                state.add_system_message("disconnected while processing".into());
            }
        }
        GatewayEvent::StreamDelta { text } => {
            state.stream_text.push_str(&text);
            state.current_tool = None; // streaming text clears tool indicator
        }
        GatewayEvent::ToolStart { name: _, label } => {
            state.current_tool = Some(label);
        }
        GatewayEvent::ToolEnd => {
            state.current_tool = None;
        }
        GatewayEvent::ChatFinal { content } => {
            // Prefer the accumulated stream text (more complete), fall back to final content
            let final_text = if state.stream_text.is_empty() {
                content
            } else {
                state.stream_text.clone()
            };

            if !final_text.is_empty() {
                state.add_assistant_message(final_text);
            }
            state.busy = false;
            state.stream_text.clear();
            state.current_tool = None;

            // Drain queue
            if !state.queue.is_empty() {
                let next = state.queue.remove(0);
                handle_submit(&next, state, req_id, out_tx);
            }
        }
        GatewayEvent::ChatError { message } => {
            state.add_system_message(format!("error: {}", message));
            state.busy = false;
            state.stream_text.clear();
            state.current_tool = None;
        }
        GatewayEvent::Status { text } => {
            // Could update model name or other status
            if text.contains(':') {
                state.model_name = text;
            }
        }
    }
}
