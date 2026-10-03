/**
 * Millisecond time units. A leaf module (no imports) so any module can use
 * it without risking an import cycle. Prefer these over inline
 * `24 * 60 * 60 * 1000` arithmetic.
 */

export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;
