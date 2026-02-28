use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};
use ratatui::Frame;

use crate::state::AppState;
use crate::theme::ThemeColors;

/// Render the input bar with horizontal scrolling for long input.
pub fn render(f: &mut Frame, area: Rect, state: &AppState, theme: &ThemeColors) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme.text_dim));

    // Inner width available for text (subtract borders + 1 char left padding)
    let inner_width = area.width.saturating_sub(3) as usize; // 2 borders + 1 space prefix

    if state.input.is_empty() {
        let placeholder = if state.busy {
            " type to queue..."
        } else {
            " type a message..."
        };
        let display_text = Line::from(Span::styled(
            placeholder,
            Style::default().fg(theme.text_dim).add_modifier(Modifier::ITALIC),
        ));
        let paragraph = Paragraph::new(display_text).block(block);
        f.render_widget(paragraph, area);
        return;
    }

    // Horizontal scroll: keep cursor visible within inner_width
    let cursor = state.cursor_pos;
    let chars: Vec<char> = state.input.chars().collect();
    let total_chars = chars.len();

    // Calculate scroll offset so cursor stays visible
    let scroll_offset = if cursor < inner_width {
        0
    } else {
        cursor - inner_width + 1
    };

    // Visible slice of characters
    let visible_end = (scroll_offset + inner_width).min(total_chars);
    let visible: String = chars[scroll_offset..visible_end].iter().collect();

    // Split visible text around cursor position
    let cursor_in_view = cursor - scroll_offset;
    let before: String = visible.chars().take(cursor_in_view).collect();
    let cursor_char = visible.chars().nth(cursor_in_view).unwrap_or(' ');
    let after: String = visible.chars().skip(cursor_in_view + 1).collect();

    // Show scroll indicator if text extends beyond view
    let left_indicator = if scroll_offset > 0 { "…" } else { " " };

    let display_text = Line::from(vec![
        Span::styled(left_indicator, Style::default().fg(theme.text_dim)),
        Span::styled(before, Style::default().fg(theme.text)),
        Span::styled(
            cursor_char.to_string(),
            Style::default().fg(theme.surface).bg(theme.text),
        ),
        Span::styled(after, Style::default().fg(theme.text)),
    ]);

    let paragraph = Paragraph::new(display_text).block(block);
    f.render_widget(paragraph, area);
}
