use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use crate::state::{AppState, ConnectionState};
use crate::theme::ThemeColors;

/// Render the status bar (bottom row).
pub fn render(f: &mut Frame, area: Rect, state: &AppState, theme: &ThemeColors) {
    let (dot, dot_label) = match state.connection {
        ConnectionState::Connected => ("●", theme.accent),
        ConnectionState::Connecting => ("◌", theme.warning),
        ConnectionState::Disconnected => ("○", theme.error),
    };

    let conn_label = match state.connection {
        ConnectionState::Connected => "connected",
        ConnectionState::Connecting => "connecting",
        ConnectionState::Disconnected => "disconnected",
    };

    let model = if state.model_name.is_empty() {
        "familiar"
    } else {
        &state.model_name
    };

    let uptime = state.uptime();

    let queue_info = if !state.queue.is_empty() {
        format!(" │ {} queued", state.queue.len())
    } else {
        String::new()
    };

    let status_line = Line::from(vec![
        Span::styled(" ", Style::default().fg(theme.text_dim)),
        Span::styled(dot, Style::default().fg(dot_label)),
        Span::styled(format!(" {} ", conn_label), Style::default().fg(theme.text_muted)),
        Span::styled("│ ", Style::default().fg(theme.text_dim)),
        Span::styled(model, Style::default().fg(theme.primary)),
        Span::styled(" │ ", Style::default().fg(theme.text_dim)),
        Span::styled(&uptime, Style::default().fg(theme.text_muted)),
        Span::styled(&queue_info, Style::default().fg(theme.warning)),
    ]);

    let paragraph = Paragraph::new(status_line);
    f.render_widget(paragraph, area);
}
