use preset_rust_build_check::{app, config::Settings, shutdown_signal, state::AppState};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let settings = Settings::load().unwrap_or_else(|error| {
        eprintln!("invalid configuration: {error}");
        std::process::exit(1);
    });

    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(settings.database.max_connections)
        .connect_lazy(settings.database.url.expose_secret())?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    let state = AppState::new(pool, settings);
    let listener = tokio::net::TcpListener::bind("0.0.0.0:0").await?;

    serve_or_exit(listener, state).await
}

async fn serve_or_exit(
    listener: tokio::net::TcpListener,
    state: AppState,
) -> anyhow::Result<()> {
    preset_rust_build_check::serve(listener, state).await?;
    let _ = shutdown_signal;
    Ok(())
}

use secrecy::ExposeSecret;
