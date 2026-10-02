use crate::{auth::AuthUser, domain::TenantId, error::AppError, samples::security_users::CreateUserRequest};

/// Hand-authored: referenced as `crate::services::users::create(&auth,
/// auth.tenant_id, request)` by `security.instructions.md`, which never
/// defines this module itself.
pub async fn create(
    _auth: &AuthUser,
    _tenant_id: TenantId,
    _request: CreateUserRequest,
) -> Result<(), AppError> {
    Ok(())
}
