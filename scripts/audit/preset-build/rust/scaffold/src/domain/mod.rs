pub mod ids;
pub use ids::*;

/// Status columns are stored as free-form text in migrations/0001_init.sql;
/// no preset block defines a dedicated status enum, so a plain String alias
/// is used to keep sqlx::FromRow decoding trivial.
pub type OrderStatus = String;
pub type ProducerStatus = String;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProducerId(pub uuid::Uuid);

#[derive(Debug, Clone)]
pub struct Order {
    pub id: OrderId,
    pub tenant_id: TenantId,
    pub reference: String,
    pub status: OrderStatus,
    pub currency: String,
    pub total_cents: i64,
    pub created_at: time::OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct Producer {
    pub id: ProducerId,
    pub tenant_id: TenantId,
    pub reference: String,
    pub status: ProducerStatus,
    pub currency: String,
    pub total_cents: i64,
    pub created_at: time::OffsetDateTime,
}
