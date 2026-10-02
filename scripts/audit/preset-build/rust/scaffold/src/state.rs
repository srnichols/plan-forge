use crate::{auth::JwksCache, config::Settings, services::{OrderService, ProducerService}};

/// Hand-authored application state. No single preset block defines the full
/// shape of `AppState`; its fields are inferred from every block that reads
/// `state.settings`, `state.orders`, `state.producers`, or constructs an
/// `AuthUser` via the JWKS cache.
#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::PgPool,
    pub jwks: JwksCache,
    pub settings: Settings,
    pub orders: OrderService,
    pub producers: ProducerService,
}

impl AppState {
    pub fn new(db: sqlx::PgPool, settings: Settings) -> Self {
        let orders = OrderService::new(std::sync::Arc::new(
            crate::repositories::order::PgOrderRepository::new(db.clone()),
        ));
        let producers = ProducerService::new(std::sync::Arc::new(
            crate::repositories::producer::PgProducerRepository::new(db.clone()),
        ));
        let jwks = JwksCache::new(
            settings.auth.issuer.clone(),
            settings.auth.audience.clone(),
            settings.auth.jwks_url.clone(),
        );

        Self { db, jwks, settings, orders, producers }
    }
}
