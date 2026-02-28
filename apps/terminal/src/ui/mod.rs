pub mod chat;
pub mod input;
pub mod status_bar;

use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::Frame;

use crate::state::AppState;
use crate::theme::ThemeColors;

/// Render the full UI layout.
pub fn render(f: &mut Frame, state: &AppState, theme: &ThemeColors) {
    let size = f.area();

    // Layout: chat fills space, input is 3 rows, status bar is 1 row
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(3),    // chat
            Constraint::Length(3), // input
            Constraint::Length(1), // status bar
        ])
        .split(size);

    chat::render(f, chunks[0], state, theme);
    input::render(f, chunks[1], state, theme);
    status_bar::render(f, chunks[2], state, theme);
}
