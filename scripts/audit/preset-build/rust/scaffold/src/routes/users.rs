use axum::http::StatusCode;

use crate::{auth::AuthUser, error::AppError, extractors::ValidatedJson};

/// Hand-authored: referenced as `routes::users::create` by
/// `security.instructions.md`, which never defines this module itself.
pub async fn create(
    auth: AuthUser,
    ValidatedJson(request): ValidatedJson<crate::samples::security_users::CreateUserRequest>,
) -> Result<StatusCode, AppError> {
    crate::services::users::create(&auth, auth.tenant_id, request).await?;
    Ok(StatusCode::CREATED)
}
