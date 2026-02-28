use crate::protocol::GatewayEvent;

/// All events the app loop handles.
#[derive(Debug)]
pub enum AppEvent {
    /// Terminal key/mouse/resize event
    Terminal(crossterm::event::Event),
    /// Gateway event (connection, messages, etc.)
    Gateway(GatewayEvent),
    /// Animation/UI tick
    Tick,
}
