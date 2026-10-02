//! Standalone, self-contained illustrations extracted from `presets/rust`.
//!
//! Each module here corresponds to a single preset documentation sample that
//! does not need to participate in the canonical app wiring (it is either a
//! duplicate/alternate illustration of a canonical concept defined elsewhere,
//! or a narrowly-scoped snippet). Isolating them in their own files means
//! they can reuse common type names (e.g. `Settings`) without colliding with
//! the canonical modules.
pub mod agent_architecture_reviewer;
pub mod agent_database_reviewer;
pub mod agent_performance_analyzer;
pub mod agent_security_reviewer;
pub mod agents_order_requested_message;
pub mod agents_outbox_worker;
pub mod api_doc_gen;
pub mod api_patterns_producer_openapi;
pub mod api_patterns_sunset;
pub mod api_patterns_versions;
pub mod auth_password_hashing;
pub mod auth_serve_example;
pub mod caching;
pub mod copilot_instructions_health;
pub mod dapr_subscriptions;
pub mod database_archive_order;
pub mod database_connect;
pub mod database_error_mapping;
pub mod database_page_after;
pub mod database_query_order_summary;
pub mod database_search_orders;
pub mod deploy_graceful_shutdown;
pub mod deploy_ready;
pub mod graphql_producer_resolver;
pub mod multi_env_ready;
pub mod new_config;
pub mod new_dto_category;
pub mod new_entity_controller;
pub mod new_middleware_http_layers;
pub mod new_middleware_require_admin;
pub mod new_middleware_timing;
pub mod new_service_transfer;
pub mod new_service_wiring;
pub mod new_worker;
pub mod new_worker_health;
pub mod observability;
pub mod observability_layers;
pub mod performance;
pub mod security_cors;
pub mod security_secured_router;
pub mod security_settings;
pub mod security_unsafe_policy;
pub mod security_users;
pub mod testing_repository_mock;
pub mod version;
