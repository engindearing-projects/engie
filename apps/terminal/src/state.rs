use chrono::Local;
use rand::seq::SliceRandom;

/// A single message in the chat history.
#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub role: MessageRole,
    pub content: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum MessageRole {
    User,
    Assistant,
    System,
}

/// Connection status.
#[derive(Debug, Clone, PartialEq)]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
}

/// Full application state.
pub struct AppState {
    pub messages: Vec<ChatMessage>,
    pub input: String,
    pub cursor_pos: usize,
    pub connection: ConnectionState,
    pub model_name: String,
    pub started_at: chrono::DateTime<Local>,
    pub scroll_offset: usize,
    pub auto_scroll: bool,
    pub busy: bool,
    pub stream_text: String,
    pub current_tool: Option<String>,
    pub idle_phrases: Vec<String>,
    pub idle_phrase_idx: usize,
    pub spinner_tick: usize,
    pub should_quit: bool,
    pub input_history: Vec<String>,
    pub history_idx: Option<usize>,
    pub history_draft: String,
    pub queue: Vec<String>,
}

const PHRASE_POOL: &[&str] = &[
    "thinking",
    "doing stuff",
    "brewing thoughts",
    "on it",
    "cooking",
    "noodling",
    "figuring it out",
    "crunching",
    "working on it",
    "spinning up",
    "pondering",
    "wiring things up",
    "one sec",
    "loading brain",
    "assembling bytes",
    "revving up",
    "hmm",
    "lemme think",
    "hold on",
    "chewing on it",
    "brb",
    "processing",
    "context loading",
    "deep in thought",
    "reading the room",
    "warming up",
    "parsing reality",
    "connecting dots",
    "almost ready",
    "hang tight",
    "tuning in",
    "calibrating",
    "digging in",
    "scanning",
    "compiling thoughts",
    "engaging brain",
    "let me cook",
    "running the numbers",
    "checking notes",
    "mapping it out",
];

impl AppState {
    pub fn new() -> Self {
        let mut phrases: Vec<String> = PHRASE_POOL.iter().map(|s| s.to_string()).collect();
        let mut rng = rand::thread_rng();
        phrases.shuffle(&mut rng);

        Self {
            messages: Vec::new(),
            input: String::new(),
            cursor_pos: 0,
            connection: ConnectionState::Disconnected,
            model_name: String::new(),
            started_at: Local::now(),
            scroll_offset: 0,
            auto_scroll: true,
            busy: false,
            stream_text: String::new(),
            current_tool: None,
            idle_phrases: phrases,
            idle_phrase_idx: 0,
            spinner_tick: 0,
            should_quit: false,
            input_history: Vec::new(),
            history_idx: None,
            history_draft: String::new(),
            queue: Vec::new(),
        }
    }

    pub fn add_user_message(&mut self, content: String) {
        self.messages.push(ChatMessage {
            role: MessageRole::User,
            content,
            timestamp: Local::now().format("%H:%M").to_string(),
        });
    }

    pub fn add_assistant_message(&mut self, content: String) {
        self.messages.push(ChatMessage {
            role: MessageRole::Assistant,
            content,
            timestamp: Local::now().format("%H:%M").to_string(),
        });
    }

    pub fn add_system_message(&mut self, content: String) {
        self.messages.push(ChatMessage {
            role: MessageRole::System,
            content,
            timestamp: Local::now().format("%H:%M").to_string(),
        });
    }

    pub fn next_idle_phrase(&mut self) -> &str {
        let phrase = &self.idle_phrases[self.idle_phrase_idx];
        self.idle_phrase_idx = (self.idle_phrase_idx + 1) % self.idle_phrases.len();
        phrase
    }

    pub fn push_history(&mut self, input: String) {
        if !input.is_empty() {
            // Avoid consecutive duplicates
            if self.input_history.last() != Some(&input) {
                self.input_history.push(input);
                if self.input_history.len() > 50 {
                    self.input_history.remove(0);
                }
            }
        }
        self.history_idx = None;
        self.history_draft.clear();
    }

    pub fn history_up(&mut self) {
        if self.input_history.is_empty() {
            return;
        }
        match self.history_idx {
            None => {
                self.history_draft = self.input.clone();
                self.history_idx = Some(self.input_history.len() - 1);
            }
            Some(0) => return,
            Some(idx) => {
                self.history_idx = Some(idx - 1);
            }
        }
        if let Some(idx) = self.history_idx {
            self.input = self.input_history[idx].clone();
            self.cursor_pos = self.input.len();
        }
    }

    pub fn history_down(&mut self) {
        match self.history_idx {
            None => return,
            Some(idx) => {
                if idx + 1 >= self.input_history.len() {
                    self.history_idx = None;
                    self.input = self.history_draft.clone();
                    self.cursor_pos = self.input.len();
                    return;
                }
                self.history_idx = Some(idx + 1);
                self.input = self.input_history[idx + 1].clone();
                self.cursor_pos = self.input.len();
            }
        }
    }

    pub fn uptime(&self) -> String {
        let dur = Local::now() - self.started_at;
        let secs = dur.num_seconds();
        if secs < 60 {
            format!("{}s", secs)
        } else if secs < 3600 {
            format!("{}m", secs / 60)
        } else {
            format!("{}h {}m", secs / 3600, (secs % 3600) / 60)
        }
    }
}
