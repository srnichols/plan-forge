use axum::{Router, routing::get};

#[tokio::main]
async fn main() {
    let app = Router::new().route("/health/live", get(|| async { "ok" }));
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080")
        .await
        .expect("bind 0.0.0.0:8080");
    axum::serve(listener, app).await.expect("serve");
}