use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

use crate::state::AppState;

/// Actions that can result from key input.
#[derive(Debug)]
pub enum InputAction {
    None,
    Submit(String),
    Quit,
    ScrollUp,
    ScrollDown,
    ScrollToBottom,
    Clear,
}

/// Process a key event and return the resulting action.
pub fn handle_key(key: KeyEvent, state: &mut AppState) -> InputAction {
    match (key.modifiers, key.code) {
        // Ctrl+C → quit
        (KeyModifiers::CONTROL, KeyCode::Char('c')) => InputAction::Quit,
        // Ctrl+L → clear
        (KeyModifiers::CONTROL, KeyCode::Char('l')) => InputAction::Clear,

        // Enter → submit
        (_, KeyCode::Enter) => {
            if state.input.is_empty() {
                return InputAction::None;
            }
            let text = state.input.clone();
            state.push_history(text.clone());
            state.input.clear();
            state.cursor_pos = 0;
            InputAction::Submit(text)
        }

        // Backspace
        (_, KeyCode::Backspace) => {
            if state.cursor_pos > 0 {
                let idx = state.input.char_indices()
                    .nth(state.cursor_pos - 1)
                    .map(|(i, _)| i)
                    .unwrap_or(0);
                let end_idx = state.input.char_indices()
                    .nth(state.cursor_pos)
                    .map(|(i, _)| i)
                    .unwrap_or(state.input.len());
                state.input.replace_range(idx..end_idx, "");
                state.cursor_pos -= 1;
            }
            InputAction::None
        }

        // Delete
        (_, KeyCode::Delete) => {
            let char_count = state.input.chars().count();
            if state.cursor_pos < char_count {
                let idx = state.input.char_indices()
                    .nth(state.cursor_pos)
                    .map(|(i, _)| i)
                    .unwrap_or(state.input.len());
                let end_idx = state.input.char_indices()
                    .nth(state.cursor_pos + 1)
                    .map(|(i, _)| i)
                    .unwrap_or(state.input.len());
                state.input.replace_range(idx..end_idx, "");
            }
            InputAction::None
        }

        // Left arrow
        (_, KeyCode::Left) => {
            if state.cursor_pos > 0 {
                state.cursor_pos -= 1;
            }
            InputAction::None
        }

        // Right arrow
        (_, KeyCode::Right) => {
            let char_count = state.input.chars().count();
            if state.cursor_pos < char_count {
                state.cursor_pos += 1;
            }
            InputAction::None
        }

        // Home / Ctrl+A
        (_, KeyCode::Home) | (KeyModifiers::CONTROL, KeyCode::Char('a')) => {
            state.cursor_pos = 0;
            InputAction::None
        }

        // End / Ctrl+E
        (_, KeyCode::End) | (KeyModifiers::CONTROL, KeyCode::Char('e')) => {
            state.cursor_pos = state.input.chars().count();
            InputAction::None
        }

        // Up arrow → history
        (_, KeyCode::Up) => {
            state.history_up();
            InputAction::None
        }

        // Down arrow → history
        (_, KeyCode::Down) => {
            state.history_down();
            InputAction::None
        }

        // PageUp → scroll
        (_, KeyCode::PageUp) => InputAction::ScrollUp,

        // PageDown → scroll
        (_, KeyCode::PageDown) => InputAction::ScrollDown,

        // Ctrl+U → clear input line
        (KeyModifiers::CONTROL, KeyCode::Char('u')) => {
            state.input.clear();
            state.cursor_pos = 0;
            InputAction::None
        }

        // Ctrl+W → delete word backwards
        (KeyModifiers::CONTROL, KeyCode::Char('w')) => {
            if state.cursor_pos > 0 {
                let before: String = state.input.chars().take(state.cursor_pos).collect();
                let trimmed = before.trim_end();
                let new_end = trimmed.rfind(' ').map(|i| i + 1).unwrap_or(0);
                let after: String = state.input.chars().skip(state.cursor_pos).collect();
                let new_before: String = state.input.chars().take(new_end).collect();
                state.input = format!("{}{}", new_before, after);
                state.cursor_pos = new_end;
            }
            InputAction::None
        }

        // Regular character
        (_, KeyCode::Char(c)) => {
            let byte_idx = state.input.char_indices()
                .nth(state.cursor_pos)
                .map(|(i, _)| i)
                .unwrap_or(state.input.len());
            state.input.insert(byte_idx, c);
            state.cursor_pos += 1;
            // Typing jumps to bottom
            state.auto_scroll = true;
            InputAction::None
        }

        _ => InputAction::None,
    }
}
