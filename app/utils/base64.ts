/**
 * Base64, for the two places that carry bytes over JSON: a skill folder being
 * imported and an image attached to a chat message.
 *
 * Shared for the chunking, which is the part that is not obvious and the part
 * that broke: encoding in one go blows the stack, and measuring the decoded size
 * by decoding it means holding a second copy of a 5MB screenshot to answer a
 * question about its length.
 */

/**
 * Chunked because `String.fromCharCode(...bytes)` spreads every byte into an
 * argument list and blows the stack somewhere north of a hundred kilobytes.
 */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 8192
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** Decoded size of base64, without decoding it. */
export function base64Bytes(data: string): number {
  const clean = data.replace(/\s+/g, '')
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding)
}
