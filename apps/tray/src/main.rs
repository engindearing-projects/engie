mod config;
mod gateway;
mod state;
mod tray;

#[cfg(feature = "popover")]
mod popover;
#[cfg(feature = "popover")]
mod popover_ui;

#[cfg(feature = "character")]
mod animation;
#[cfg(feature = "character")]
mod character;
#[cfg(feature = "character")]
mod physics;

use crossbeam_channel::{unbounded, TryRecvError};
use tao::{
    event::Event,
    event_loop::{ControlFlow, EventLoopBuilder},
};
use tray_icon::{
    menu::MenuEvent,
    TrayIcon, TrayIconEvent,
};
use tracing::{info, warn};

use crate::gateway::GatewayEvent;
use crate::state::TrayState;

/// Build popover tool call entries from the app state's tool history.
#[cfg(feature = "popover")]
fn build_popover_tools(app_state: &TrayState) -> Vec<popover::ToolCall> {
    app_state
        .last_tools
        .iter()
        .map(|record| popover::ToolCall {
            name: record.name.clone(),
            time: crate::state::format_relative(record.timestamp),
        })
        .collect()
}

fn format_uptime(start: std::time::Instant) -> String {
    let secs = start.elapsed().as_secs();
    if secs < 60 {
        return format!("{}s", secs);
    }
    if secs < 3600 {
        return format!("{}m", secs / 60);
    }
    let h = secs / 3600;
    let m = (secs % 3600) / 60;
    format!("{}h {}m", h, m)
}

enum UserEvent {
    TrayIconEvent(TrayIconEvent),
    MenuEvent(MenuEvent),
}

fn main() {
    // Init tracing to stderr
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    info!("familiar-tray starting");

    // Load config
    let cfg = config::load();
    let name = cfg.identity.name.clone();
    let gateway_url = cfg.gateway.url.clone();
    let gateway_token = cfg.gateway_token();

    info!(name = %name, gateway = %gateway_url, "config loaded");

    // Ensure logs directory exists
    let _ = std::fs::create_dir_all(
        dirs::home_dir()
            .map(|h| h.join(".familiar/logs"))
            .unwrap_or_default(),
    );

    // Create shared state
    let mut app_state = TrayState::new(name);
    let start_time = std::time::Instant::now();
    let mut total_calls: u64 = 0;

    // Set up crossbeam channel for gateway events
    let (gw_tx, gw_rx) = unbounded::<GatewayEvent>();

    // Spawn gateway connection thread
    let token_clone = gateway_token.clone();
    std::thread::spawn(move || {
        gateway::connect_loop(
            &gateway_url,
            token_clone.as_deref(),
            gw_tx,
        );
    });

    // Build the event loop
    let mut event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();

    // Suppress dock icon on macOS — must be set before run()
    #[cfg(target_os = "macos")]
    {
        use tao::platform::macos::{ActivationPolicy, EventLoopExtMacOS};
        event_loop.set_activation_policy(ActivationPolicy::Accessory);
    }

    // Set up event handlers that forward to the event loop
    let proxy = event_loop.create_proxy();
    TrayIconEvent::set_event_handler(Some(move |event| {
        let _ = proxy.send_event(UserEvent::TrayIconEvent(event));
    }));

    let proxy = event_loop.create_proxy();
    MenuEvent::set_event_handler(Some(move |event| {
        let _ = proxy.send_event(UserEvent::MenuEvent(event));
    }));

    // Build menu and tray icon components
    let (menu, menu_items) = tray::build_menu(
        &app_state.status_text(),
        &app_state.last_tool_text(),
    );
    let icon = tray::load_icon();

    // The tray icon must be created inside the event loop (after Init)
    let mut tray_icon: Option<TrayIcon> = None;

    // Popover panel (Phase 2) — created lazily on first Settings click
    #[cfg(feature = "popover")]
    let mut popover_window: Option<popover::PopoverWindow> = None;

    // Phase 3: floating desktop character
    #[cfg(feature = "character")]
    let mut character_window: Option<character::CharacterWindow> = None;

    event_loop.run(move |event, event_loop_target, control_flow| {
        #[cfg(feature = "character")]
        {
            *control_flow = ControlFlow::WaitUntil(
                std::time::Instant::now() + std::time::Duration::from_millis(16),
            );
        }
        #[cfg(not(feature = "character"))]
        {
            *control_flow = ControlFlow::Wait;
        }

        match event {
            Event::NewEvents(tao::event::StartCause::Init) => {
                // Create the tray icon once the event loop is running
                let ti = tray::build_tray(menu.clone(), icon.clone(), &app_state.name);
                tray::update_title(&ti, &app_state.name, false);
                tray::update_tooltip(
                    &ti,
                    &app_state.name,
                    false,
                    total_calls,
                    &format_uptime(start_time),
                );
                tray_icon = Some(ti);
                info!("tray icon created");

                // Phase 3: create the floating character window
                #[cfg(feature = "character")]
                {
                    character_window = Some(character::CharacterWindow::new(event_loop_target));
                    info!("character window created");
                }

                // Wake up the run loop on macOS so the icon appears
                #[cfg(target_os = "macos")]
                {
                    use objc2_core_foundation::CFRunLoop;
                    let rl = CFRunLoop::main().unwrap();
                    rl.wake_up();
                }
            }

            // Phase 3: animation / physics tick at ~60fps
            Event::NewEvents(tao::event::StartCause::ResumeTimeReached { .. }) => {
                #[cfg(feature = "character")]
                if let Some(ref mut ch) = character_window {
                    ch.tick();
                    ch.render();
                }
            }

            Event::NewEvents(_) => {
                // Poll gateway events from the crossbeam channel
                loop {
                    match gw_rx.try_recv() {
                        Ok(gw_event) => {
                            match gw_event {
                                GatewayEvent::Connected => {
                                    app_state.connected = true;
                                    tray::update_status(
                                        &menu_items.status_item,
                                        &app_state.status_text(),
                                    );
                                    if let Some(ref ti) = tray_icon {
                                        tray::update_title(ti, &app_state.name, true);
                                        tray::update_tooltip(
                                            ti,
                                            &app_state.name,
                                            true,
                                            total_calls,
                                            &format_uptime(start_time),
                                        );
                                    }
                                    info!("gateway connected");
                                }
                                GatewayEvent::Disconnected => {
                                    app_state.connected = false;
                                    tray::update_status(
                                        &menu_items.status_item,
                                        &app_state.status_text(),
                                    );
                                    if let Some(ref ti) = tray_icon {
                                        tray::update_title(ti, &app_state.name, false);
                                        tray::update_tooltip(
                                            ti,
                                            &app_state.name,
                                            false,
                                            total_calls,
                                            &format_uptime(start_time),
                                        );
                                    }
                                }
                                GatewayEvent::ToolCall { name } => {
                                    total_calls += 1;
                                    app_state.add_tool_call(name.clone());
                                    tray::update_last_tool(
                                        &menu_items.last_tool_item,
                                        &app_state.last_tool_text(),
                                    );
                                    if let Some(ref ti) = tray_icon {
                                        tray::update_tooltip(
                                            ti,
                                            &app_state.name,
                                            app_state.connected,
                                            total_calls,
                                            &format_uptime(start_time),
                                        );
                                    }
                                    #[cfg(feature = "popover")]
                                    if let Some(ref pop) = popover_window {
                                        pop.add_tool_call(&name, "just now");
                                    }
                                    #[cfg(feature = "character")]
                                    if let Some(ref mut ch) = character_window {
                                        ch.react(&name);
                                    }
                                }
                                GatewayEvent::Status { text } => {
                                    app_state.gateway_status = Some(text.clone());
                                    let display = format!(
                                        "{} \u{2014} {}",
                                        app_state.name, text
                                    );
                                    tray::update_status(
                                        &menu_items.status_item,
                                        &display,
                                    );
                                    info!(status = %text, "status update");
                                }
                            }
                        }
                        Err(TryRecvError::Empty) => break,
                        Err(TryRecvError::Disconnected) => {
                            warn!("gateway channel disconnected");
                            break;
                        }
                    }
                }

                // Sync live state to popover if visible
                #[cfg(feature = "popover")]
                if let Some(ref mut pop) = popover_window {
                    if pop.is_visible() {
                        let state = popover::PopoverState {
                            name: app_state.name.clone(),
                            connected: app_state.connected,
                            last_tools: build_popover_tools(&app_state),
                            tool_count: app_state.unique_tools.len() as u64,
                            uptime: format_uptime(start_time),
                            total_calls,
                        };
                        pop.update_state(&state);
                    }
                }
            }

            Event::UserEvent(UserEvent::MenuEvent(event)) => {
                if event.id == menu_items.quit_item.id() {
                    info!("quit requested");
                    tray_icon.take();
                    *control_flow = ControlFlow::Exit;
                } else if event.id == menu_items.settings_item.id() {
                    info!("settings clicked");
                    // Fallback: open config file directly when popover not compiled
                    #[cfg(not(feature = "popover"))]
                    {
                        let config = dirs::home_dir()
                            .map(|h| h.join(".familiar/config.toml"))
                            .unwrap_or_default();
                        let _ = std::process::Command::new("open")
                            .arg(&config)
                            .spawn();
                    }
                    #[cfg(feature = "popover")]
                    {
                        match popover_window {
                            Some(ref mut pop) => {
                                pop.toggle();
                            }
                            None => {
                                // Create popover on first click
                                let state = popover::PopoverState {
                                    name: app_state.name.clone(),
                                    connected: app_state.connected,
                                    last_tools: build_popover_tools(&app_state),
                                    tool_count: app_state.unique_tools.len() as u64,
                                    uptime: format_uptime(start_time),
                                    total_calls,
                                };
                                let on_action: popover::ActionCallback = Box::new(|action| {
                                    match action {
                                        popover::PopoverAction::Restart => {
                                            info!("restart requested — re-execing");
                                            let exe = std::env::current_exe()
                                                .expect("failed to get current exe");
                                            let args: Vec<String> =
                                                std::env::args().skip(1).collect();
                                            let _ = std::process::Command::new(&exe)
                                                .args(&args)
                                                .spawn();
                                            std::process::exit(0);
                                        }
                                        popover::PopoverAction::OpenLogs => {
                                            let logs_dir = dirs::home_dir()
                                                .map(|h| h.join(".familiar/logs"))
                                                .unwrap_or_default();
                                            let _ = std::process::Command::new("open")
                                                .arg(&logs_dir)
                                                .spawn();
                                        }
                                        popover::PopoverAction::Settings => {
                                            let config = dirs::home_dir()
                                                .map(|h| h.join(".familiar/config.toml"))
                                                .unwrap_or_default();
                                            let _ = std::process::Command::new("open")
                                                .arg(&config)
                                                .spawn();
                                        }
                                        _ => {}
                                    }
                                });
                                match popover::PopoverWindow::new(
                                    event_loop_target,
                                    &state,
                                    Some(on_action),
                                ) {
                                    Ok(mut pop) => {
                                        pop.show();
                                        popover_window = Some(pop);
                                        info!("popover created");
                                    }
                                    Err(e) => {
                                        warn!(error = %e, "failed to create popover");
                                    }
                                }
                            }
                        }
                    }
                }
            }

            Event::UserEvent(UserEvent::TrayIconEvent(_event)) => {
                // Could handle click events here in the future
            }

            Event::WindowEvent { window_id, ref event, .. } => {
                // Phase 3: character window mouse events for drag
                #[cfg(feature = "character")]
                if let Some(ref mut ch) = character_window {
                    if window_id == ch.window_id() {
                        match event {
                            tao::event::WindowEvent::CursorMoved { position, .. } => {
                                ch.update_cursor(*position);
                            }
                            tao::event::WindowEvent::MouseInput {
                                state: tao::event::ElementState::Pressed,
                                button: tao::event::MouseButton::Left,
                                ..
                            } => {
                                if let Some(pos) = ch.last_cursor_position() {
                                    ch.start_drag(pos);
                                }
                            }
                            tao::event::WindowEvent::MouseInput {
                                state: tao::event::ElementState::Released,
                                button: tao::event::MouseButton::Left,
                                ..
                            } => {
                                ch.end_drag();
                            }
                            _ => {}
                        }
                    }
                }

                // Popover focus loss — hide when clicking outside
                #[cfg(feature = "popover")]
                if let tao::event::WindowEvent::Focused(false) = event {
                    if let Some(ref mut pop) = popover_window {
                        if pop.window().id() == window_id {
                            pop.hide();
                        }
                    }
                }
            }

            _ => {}
        }
    });
}
