/**
 * WebCrypto's randomUUID, present in every browser and in Node 19+.
 *
 * **Declared locally** rather than pulled from the DOM or @types/node libs,
 * so the core keeps typechecking with no platform globals at all.
 */
interface CryptoLike {
  randomUUID(): string
}

export function randomId(): string {
  return (globalThis as unknown as { crypto: CryptoLike }).crypto.randomUUID()
}
