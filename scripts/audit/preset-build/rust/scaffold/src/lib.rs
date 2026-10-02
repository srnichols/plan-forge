pub mod auth;
pub mod config;
pub mod dapr;
pub mod domain;
pub mod dto;
pub mod error;
pub mod extractors;
pub mod graphql;
pub mod health;
pub mod messaging;
pub mod pagination;
pub mod repositories;
pub mod routes;
pub mod samples;
pub mod services;
pub mod state;

/// Waits for a Ctrl+C signal so [`serve`] can shut down gracefully.
///
/// Hand-authored: no preset block defines this helper, but several blocks
/// (e.g. `api-patterns.instructions.md`) call `crate::shutdown_signal()`.
pub async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}
