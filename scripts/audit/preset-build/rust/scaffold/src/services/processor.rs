use crate::error::AppError;

/// Hand-authored: `messaging.instructions.md` references `OrderProcessor`
/// as the consumer-side handler but never defines it.
#[derive(Clone, Default)]
pub struct OrderProcessor;

impl OrderProcessor {
    pub async fn process_message(&self, _payload: &[u8]) -> Result<(), AppError> {
        Ok(())
    }
}
