mod config;
mod error;
mod mcp;
mod capabilities;
mod permissions;
mod platform;

use capabilities::CapabilityRegistry;
use tracing_subscriber::EnvFilter;

fn main() {
    // All logging goes to stderr (stdout is the MCP JSON-RPC channel)
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_writer(std::io::stderr)
        .with_target(false)
        .init();

    let cfg = config::load();
    let perms = permissions::load();
    let mut registry = CapabilityRegistry::new(perms);

    // Register all enabled capabilities
    #[cfg(feature = "system_info")]
    registry.register(capabilities::system_info::provider());

    #[cfg(feature = "clipboard")]
    registry.register(capabilities::clipboard::provider());

    #[cfg(feature = "notifications")]
    registry.register(capabilities::notifications::provider());

    #[cfg(feature = "screenshots")]
    registry.register(capabilities::screenshots::provider());

    #[cfg(feature = "window_mgmt")]
    registry.register(capabilities::window_mgmt::provider());

    #[cfg(feature = "app_control")]
    registry.register(capabilities::app_control::provider());

    #[cfg(feature = "input_sim")]
    registry.register(capabilities::input_sim::provider());

    #[cfg(feature = "audio")]
    registry.register(capabilities::audio::provider());

    #[cfg(feature = "display")]
    registry.register(capabilities::display::provider());

    #[cfg(feature = "file_search")]
    registry.register(capabilities::file_search::provider());

    #[cfg(feature = "accessibility")]
    registry.register(capabilities::accessibility::provider());

    #[cfg(feature = "file_ops")]
    registry.register(capabilities::file_ops::provider());

    #[cfg(feature = "network")]
    registry.register(capabilities::network::provider());

    #[cfg(feature = "browser")]
    registry.register(capabilities::browser::provider());

    #[cfg(feature = "defaults")]
    registry.register(capabilities::defaults::provider());

    #[cfg(feature = "terminal")]
    registry.register(capabilities::terminal::provider());

    #[cfg(feature = "ocr")]
    registry.register(capabilities::ocr::provider());

    // Run the MCP server (blocks on stdin)
    mcp::server::run(registry, &cfg);
}
