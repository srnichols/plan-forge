/**
 * Transformers-based embedding provider using Xenova/all-MiniLM-L6-v2.
 *
 * Requires the optional `@xenova/transformers` package. The pipeline is
 * lazily initialized on first call and memoized (Promise-level) so
 * concurrent first calls share a single load.
 *
 * Uses **mean pooling** with L2 normalization — this matches the model's
 * training objective. CLS-token extraction (`[0][0]`) would produce
 * incorrect embeddings for this architecture.
 *
 * Consumers MUST read `provider.dim` rather than hard-coding 384.
 *
 * @module embedding/transformers-mini
 */

export const DIM = 384;
export const name = 'transformers-mini';

let pipelinePromise = null;

/**
 * Embed text using MiniLM-L6-v2.
 * @param {string} text
 * @returns {Promise<Float32Array>}
 */
export async function embed(text) {
  if (!pipelinePromise) {
    const { pipeline } = await import('@xenova/transformers');
    pipelinePromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
  }
  const pipe = await pipelinePromise;
  const output = await pipe(String(text ?? ''), { pooling: 'mean', normalize: true });
  return new Float32Array(output.data);
}

/**
 * Create a provider object conforming to the embedding provider interface.
 * @returns {{ name: string, dim: number, embed: (text: string) => Promise<Float32Array> }}
 */
export function createTransformersMiniProvider() {
  return { name, dim: DIM, embed };
}

/** @internal Reset pipeline for test isolation. */
export function __resetPipelineForTests() { pipelinePromise = null; }
