use serde_json::{json, Value};
use crate::mcp::types::{CallToolResult, Tool};
use super::CapabilityProvider;

pub struct AudioProvider;

impl AudioProvider {
    pub fn new() -> Self {
        Self
    }
}

impl CapabilityProvider for AudioProvider {
    fn id(&self) -> &str {
        "audio"
    }

    fn name(&self) -> &str {
        "Audio"
    }

    fn tools(&self) -> Vec<Tool> {
        vec![
            Tool {
                name: "audio_get_volume".into(),
                description: "Get current audio volume settings (output volume, input volume, alert volume, muted state).".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {},
                }),
            },
            Tool {
                name: "audio_set_volume".into(),
                description: "Set the output audio volume level.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "level": {
                            "type": "number",
                            "description": "Volume level from 0 to 100",
                            "minimum": 0,
                            "maximum": 100
                        }
                    },
                    "required": ["level"]
                }),
            },
            Tool {
                name: "audio_mute".into(),
                description: "Mute or unmute the audio output.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "muted": {
                            "type": "boolean",
                            "description": "true to mute, false to unmute"
                        }
                    },
                    "required": ["muted"]
                }),
            },
            Tool {
                name: "audio_devices".into(),
                description: "List all audio input and output devices on this Mac.".into(),
                input_schema: json!({
                    "type": "object",
                    "properties": {},
                }),
            },
        ]
    }

    fn call(&self, tool_name: &str, arguments: &Value) -> Option<CallToolResult> {
        match tool_name {
            "audio_get_volume" => Some(audio_get_volume()),
            "audio_set_volume" => {
                let level = arguments["level"].as_u64().unwrap_or(50) as u8;
                Some(audio_set_volume(level))
            }
            "audio_mute" => {
                let muted = arguments["muted"].as_bool().unwrap_or(true);
                Some(audio_mute(muted))
            }
            "audio_devices" => Some(audio_devices()),
            _ => None,
        }
    }
}

#[cfg(target_os = "macos")]
fn audio_get_volume() -> CallToolResult {
    crate::platform::macos::audio::get_volume()
}

#[cfg(target_os = "macos")]
fn audio_set_volume(level: u8) -> CallToolResult {
    crate::platform::macos::audio::set_volume(level)
}

#[cfg(target_os = "macos")]
fn audio_mute(muted: bool) -> CallToolResult {
    crate::platform::macos::audio::mute(muted)
}

#[cfg(target_os = "macos")]
fn audio_devices() -> CallToolResult {
    crate::platform::macos::audio::devices()
}

#[cfg(not(target_os = "macos"))]
fn audio_get_volume() -> CallToolResult {
    CallToolResult::error("Audio not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn audio_set_volume(_level: u8) -> CallToolResult {
    CallToolResult::error("Audio not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn audio_mute(_muted: bool) -> CallToolResult {
    CallToolResult::error("Audio not implemented on this platform")
}

#[cfg(not(target_os = "macos"))]
fn audio_devices() -> CallToolResult {
    CallToolResult::error("Audio not implemented on this platform")
}

pub fn provider() -> Box<dyn CapabilityProvider> {
    Box::new(AudioProvider::new())
}
