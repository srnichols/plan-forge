---
description: Rust authentication & authorization — Axum extractors, JWT/OIDC, JWKS caching, tenant isolation, passwords, rate limiting, tests
applyTo: '**/src/auth.rs,**/src/auth/**,**/src/services/**,**/src/routes/**,**/tests/**/*auth*.rs'
---

# Rust Authentication & Authorization

## Middleware and Extractor Order

Axum authentication should be explicit at the handler boundary. Apply platform middleware first, then require `AuthUser` in handlers that need identity.

```rust
use std::net::SocketAddr;

use crate::{app, shutdown_signal, state::AppState};

pub async fn serve(listener: tokio::net::TcpListener, state: AppState) -> std::io::Result<()> {
    axum::serve(
        listener,
        app(state).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
}
```

The single `app(state)` composition lives in `src/lib.rs` and includes request IDs, tracing, rate limiting, `/api/v1`, and health routes. The IP-keyed limiter requires `ConnectInfo<SocketAddr>`, which is why the server uses `into_make_service_with_connect_info`. Use `SmartIpKeyExtractor` only behind a trusted proxy that normalizes forwarding headers.

## JWT / OIDC Validation

`AuthUser` is the only source of user identity and tenant identity. It implements `FromRequestParts<AppState>`, verifies the bearer token against a cached JWKS, and lets `jsonwebtoken::Validation` enforce registered claims. Configure `jsonwebtoken = { version = "11.1.0", features = ["rust_crypto"] }`; version 11 needs an explicit crypto backend.

```rust
use axum::{
    extract::FromRequestParts,
    http::{header::AUTHORIZATION, request::Parts},
};
use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use std::{sync::Arc, time::{Duration, Instant}};
use tokio::sync::{Mutex, RwLock};
use uuid::Uuid;

use crate::{domain::TenantId, error::AppError, state::AppState};

fn auth_infrastructure_error(error: reqwest::Error) -> AppError {
    AppError::Internal(error.into())
}

#[derive(Clone, Debug)]
pub struct AuthUser {
    pub user_id: Uuid,
    pub tenant_id: TenantId,
    pub roles: Vec<Role>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Admin,
    Member,
    ReadOnly,
}

#[derive(Clone)]
pub struct JwksCache {
    issuer: String,
    audience: String,
    jwks_url: String,
    client: reqwest::Client,
    cached: Arc<RwLock<Option<CachedJwks>>>,
    refresh_gate: Arc<Mutex<()>>,
    last_unknown_kid_refresh: Arc<RwLock<Option<Instant>>>,
}

#[derive(Clone)]
struct CachedJwks {
    keys: JwkSet,
    expires_at: Instant,
}

#[derive(Debug, Deserialize)]
struct Claims {
    sub: Uuid,
    tenant_id: Uuid,
    roles: Vec<Role>,
}

impl JwksCache {
    pub async fn decoding_key(&self, token: &str) -> Result<DecodingKey, AppError> {
        let kid = decode_header(token)
            .map_err(|_| AppError::Unauthorized)?
            .kid
            .ok_or(AppError::Unauthorized)?;
        let mut jwks = self.current_keys().await?;
        let jwk = match jwks.find(&kid) {
            Some(jwk) => jwk,
            None => {
                jwks = self.refresh_keys_for_unknown_kid().await?;
                jwks.find(&kid).ok_or(AppError::Unauthorized)?
            }
        };
        DecodingKey::from_jwk(jwk).map_err(|_| AppError::Unauthorized)
    }

    async fn current_keys(&self) -> Result<JwkSet, AppError> {
        if let Some(hit) = self.cached.read().await.as_ref() {
            if hit.expires_at > Instant::now() {
                return Ok(hit.keys.clone());
            }
        }

        self.refresh_keys().await
    }

    async fn refresh_keys_for_unknown_kid(&self) -> Result<JwkSet, AppError> {
        let _guard = self.refresh_gate.lock().await;
        if let Some(last_refresh) = *self.last_unknown_kid_refresh.read().await {
            if last_refresh.elapsed() < Duration::from_secs(5) {
                return self.current_cached_keys().await.ok_or(AppError::Unauthorized);
            }
        }

        *self.last_unknown_kid_refresh.write().await = Some(Instant::now());
        self.refresh_keys().await
    }

    async fn current_cached_keys(&self) -> Option<JwkSet> {
        self.cached.read().await.as_ref().map(|hit| hit.keys.clone())
    }

    async fn refresh_keys(&self) -> Result<JwkSet, AppError> {
        let keys = self.client
            .get(&self.jwks_url)
            .send()
            .await
            .map_err(auth_infrastructure_error)?
            .error_for_status()
            .map_err(auth_infrastructure_error)?
            .json::<JwkSet>()
            .await
            .map_err(auth_infrastructure_error)?;

        *self.cached.write().await = Some(CachedJwks {
            keys: keys.clone(),
            expires_at: Instant::now() + Duration::from_secs(300),
        });
        Ok(keys)
    }

    pub fn validation(&self) -> Validation {
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&[self.issuer.as_str()]);
        validation.set_audience(&[self.audience.as_str()]);
        validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
        validation.validate_exp = true;
        validation.validate_nbf = true;
        validation
    }
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let token = parts.headers
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .ok_or(AppError::Unauthorized)?;

        let key = state.jwks.decoding_key(token).await?;
        let data = decode::<Claims>(token, &key, &state.jwks.validation())
            .map_err(|_| AppError::Unauthorized)?;

        Ok(AuthUser {
            user_id: data.claims.sub,
            tenant_id: TenantId(data.claims.tenant_id),
            roles: data.claims.roles,
        })
    }
}
```

## Authorization in Services

Routes pass `AuthUser` to services; services enforce roles and object ownership before touching repositories. Repositories still take `tenant_id` on every method as a second boundary.

```rust
use crate::{auth::{AuthUser, Role}, domain::OrderId, error::AppError};

impl OrderService {
    pub async fn delete(&self, user: &AuthUser, order_id: OrderId) -> Result<(), AppError> {
        if !user.roles.contains(&Role::Admin) {
            return Err(AppError::Forbidden);
        }
        if self.orders.delete(user.tenant_id, order_id).await? {
            Ok(())
        } else {
            Err(AppError::not_found("order", order_id.0))
        }
    }
}
```

## Multi-Tenant Isolation

- Derive `tenant_id` from the verified token only; never accept it from `X-Tenant-ID`, URL segments, GraphQL input, or message headers without a verified envelope.
- Persist tenant IDs on every tenant-owned row and bind `WHERE tenant_id = $1` on reads and writes.
- Return `404 Not Found` for cross-tenant object lookups to avoid revealing existence.
- Consider PostgreSQL row-level security as defense in depth, but do not use it as a substitute for repository scoping.

## Password Hashing

Use Argon2id for passwords with `argon2 = "0.5.3"`. Store the PHC string; never store salts, hashes, or password reset tokens in plaintext columns.

```rust
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use secrecy::{ExposeSecret, SecretString};

pub fn hash_password(password: &SecretString) -> Result<String, argon2::password_hash::Error> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.expose_secret().as_bytes(), &salt)
        .map(|hash| hash.to_string())
}

pub fn verify_password(password: &SecretString, stored_hash: &str) -> bool {
    let parsed = match PasswordHash::new(stored_hash) {
        Ok(hash) => hash,
        Err(_) => return false,
    };
    Argon2::default()
        .verify_password(password.expose_secret().as_bytes(), &parsed)
        .is_ok()
}
```

## Auth Tests

Cover authentication and authorization at the router and service levels:

- no bearer token returns `401` with `WWW-Authenticate: Bearer`
- malformed, expired, wrong issuer, and wrong audience tokens return `401`
- unknown `kid` triggers one JWKS refresh and then returns `401`
- missing role or permission returns `403`
- cross-tenant IDs return `404` and do not call an unscoped repository method
- password hashing verifies the right password and rejects a different one
- rate limiting returns `429` after the configured burst

## Rules

- ALWAYS validate `iss`, `aud`, `exp`, algorithm, `kid`, `sub`, and `tenant_id`.
- ALWAYS cache JWKS with an expiry and refresh on unknown `kid`; do not fetch signing keys on every request.
- ALWAYS pass `AuthUser.tenant_id` into services and repositories.
- NEVER read tenant identity from client headers or request bodies.
- NEVER put role checks only in routes; services protect business actions too.
- Use `secrecy::SecretString` for passwords, API keys, and token material.
- Use Argon2id through the `argon2` crate for password hashes.
- Use `into_make_service_with_connect_info::<SocketAddr>()` for IP-keyed rate limiting.

## See Also

- `security.instructions.md` — CORS, body limits, unsafe-code policy, secrets, cargo audit/deny
- `api-patterns.instructions.md` — handler shape and `ValidatedJson`
- `database.instructions.md` — tenant-scoped SQLx repositories
