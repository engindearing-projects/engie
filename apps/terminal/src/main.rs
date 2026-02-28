mod app;
mod config;
mod event;
mod gateway;
mod input;
mod protocol;
mod state;
mod theme;
mod ui;

use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Init tracing (logs to file to avoid corrupting TUI)
    let log_dir = dirs::home_dir()
        .map(|h| h.join(".familiar/logs"))
        .unwrap_or_else(|| "/tmp".into());
    std::fs::create_dir_all(&log_dir).ok();

    let log_file = std::fs::File::create(log_dir.join("terminal.log"))?;
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_writer(log_file)
        .with_ansi(false)
        .init();

    let config = config::load();
    app::run(config).await
}
