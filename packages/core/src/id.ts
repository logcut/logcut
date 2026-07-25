/**
 * WebCrypto's randomUUID, present in every browser and in Node 19+. It is
 * declared locally rather than pulled in from the DOM or @types/node libs so
 * the core keeps typechecking with no platform globals at all.
 *
 * This is also the single place to swap in a deterministic generator once
 * edits are expressed as a replayable command list.
 */
interface CryptoLike {
  randomUUID(): string
}

export function randomId(): string {
  return (globalThis as unknown as { crypto: CryptoLike }).crypto.randomUUID()
}
