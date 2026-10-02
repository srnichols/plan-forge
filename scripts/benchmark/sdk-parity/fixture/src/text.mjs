/** Shorten text to at most `max` characters, ending with an ellipsis when cut. */
export function truncate(text, max) {
  return text.length > max ? text.slice(0, max) + "…" : text;
}
