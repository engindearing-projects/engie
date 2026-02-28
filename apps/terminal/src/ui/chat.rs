use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};
use ratatui::Frame;

use crate::state::{AppState, ConnectionState, MessageRole};
use crate::theme::ThemeColors;

/// Braille spinner frames for tool indicators.
const SPINNER_FRAMES: &[&str] = &["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/// Render the chat zone.
pub fn render(f: &mut Frame, area: Rect, state: &AppState, theme: &ThemeColors) {
    let block = Block::default()
        .borders(Borders::NONE);

    let mut lines: Vec<Line> = Vec::new();

    // Welcome message if no messages
    if state.messages.is_empty() && !state.busy {
        lines.push(Line::from(""));
        lines.push(Line::from(vec![
            Span::styled("  familiar", Style::default().fg(theme.primary).add_modifier(Modifier::BOLD)),
            Span::styled(" terminal", Style::default().fg(theme.text_muted)),
        ]));
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            "  type a message to get started",
            Style::default().fg(theme.text_dim),
        )));

        if state.connection == ConnectionState::Disconnected {
            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                "  waiting for gateway connection...",
                Style::default().fg(theme.warning),
            )));
        }
    }

    // Render each message
    for msg in &state.messages {
        lines.push(Line::from("")); // spacing

        match msg.role {
            MessageRole::User => {
                lines.push(Line::from(vec![
                    Span::styled("  you", Style::default().fg(theme.text_muted).add_modifier(Modifier::BOLD)),
                    Span::styled(" > ", Style::default().fg(theme.text_dim)),
                    Span::styled(&msg.content, Style::default().fg(theme.text)),
                ]));
            }
            MessageRole::Assistant => {
                lines.push(Line::from(vec![
                    Span::styled("  familiar", Style::default().fg(theme.primary).add_modifier(Modifier::BOLD)),
                    Span::styled(" > ", Style::default().fg(theme.text_dim)),
                ]));
                // Render content lines indented
                for content_line in msg.content.lines() {
                    lines.push(Line::from(Span::styled(
                        format!("    {}", content_line),
                        Style::default().fg(theme.text),
                    )));
                }
            }
            MessageRole::System => {
                lines.push(Line::from(Span::styled(
                    format!("  {}", msg.content),
                    Style::default().fg(theme.text_dim).add_modifier(Modifier::ITALIC),
                )));
            }
        }
    }

    // Render active streaming state
    if state.busy {
        lines.push(Line::from("")); // spacing

        if state.stream_text.is_empty() {
            // No text yet — show tool or idle phrase
            lines.push(Line::from(vec![
                Span::styled("  familiar", Style::default().fg(theme.primary).add_modifier(Modifier::BOLD)),
                Span::styled(" ", Style::default()),
                spinner_span(state, theme),
            ]));

            if let Some(ref tool) = state.current_tool {
                lines.push(Line::from(Span::styled(
                    format!("    {}...", tool),
                    Style::default().fg(theme.accent),
                )));
            } else {
                // Show idle phrase
                let phrase = &state.idle_phrases[state.idle_phrase_idx % state.idle_phrases.len()];
                lines.push(Line::from(Span::styled(
                    format!("    {}", phrase),
                    Style::default().fg(theme.text_muted).add_modifier(Modifier::ITALIC),
                )));
            }
        } else {
            // Streaming text
            lines.push(Line::from(vec![
                Span::styled("  familiar", Style::default().fg(theme.primary).add_modifier(Modifier::BOLD)),
                Span::styled(" ", Style::default()),
                spinner_span(state, theme),
            ]));

            for content_line in state.stream_text.lines() {
                lines.push(Line::from(Span::styled(
                    format!("    {}", content_line),
                    Style::default().fg(theme.text),
                )));
            }
            // Handle trailing newline
            if state.stream_text.ends_with('\n') {
                lines.push(Line::from(""));
            }
        }
    }

    // Calculate scroll
    let visible_height = area.height as usize;
    let total_lines = lines.len();

    let scroll = if state.auto_scroll {
        total_lines.saturating_sub(visible_height)
    } else {
        state.scroll_offset.min(total_lines.saturating_sub(visible_height))
    };

    let paragraph = Paragraph::new(lines)
        .block(block)
        .wrap(Wrap { trim: false })
        .scroll((scroll as u16, 0));

    f.render_widget(paragraph, area);

    // New messages indicator when scrolled up
    if !state.auto_scroll && state.busy {
        let indicator = Span::styled(
            " [new] ",
            Style::default().fg(Color::Black).bg(theme.warning),
        );
        let indicator_area = Rect {
            x: area.x + area.width.saturating_sub(8),
            y: area.y + area.height.saturating_sub(1),
            width: 7,
            height: 1,
        };
        f.render_widget(Paragraph::new(Line::from(indicator)), indicator_area);
    }
}

fn spinner_span(state: &AppState, theme: &ThemeColors) -> Span<'static> {
    let frame_idx = state.spinner_tick % SPINNER_FRAMES.len();
    Span::styled(
        SPINNER_FRAMES[frame_idx].to_string(),
        Style::default().fg(theme.primary),
    )
}
