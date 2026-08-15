export const SECURE_AUTH_CHUNK_SIZE = 1800;
export const SECURE_AUTH_MAX_CHUNKS = 64;

export interface SecureAuthManifest {
  version: 1;
  generation: string;
  chunks: number;
}

export function splitSecureAuthValue(value: string, chunkSize = SECURE_AUTH_CHUNK_SIZE): string[] {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) throw new Error("Invalid secure storage chunk size");
  const chunks: string[] = [];
  for (let offset = 0; offset < value.length; offset += chunkSize) chunks.push(value.slice(offset, offset + chunkSize));
  if (!chunks.length) chunks.push("");
  if (chunks.length > SECURE_AUTH_MAX_CHUNKS) throw new Error("Secure session is too large to store safely");
  return chunks;
}

export function parseSecureAuthManifest(value: string | null): SecureAuthManifest | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<SecureAuthManifest>;
    if (
      parsed.version !== 1
      || typeof parsed.generation !== "string"
      || !/^[a-zA-Z0-9-]+$/.test(parsed.generation)
      || !Number.isInteger(parsed.chunks)
      || Number(parsed.chunks) < 1
      || Number(parsed.chunks) > SECURE_AUTH_MAX_CHUNKS
    ) return null;
    return parsed as SecureAuthManifest;
  } catch {
    return null;
  }
}
