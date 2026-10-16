/** Immutable source selection stored with the import job. */
export interface SourceObject { key: string; version: string }

export function objectVersion(object: { ETag?: string; VersionId?: string; ContentLength?: number }): string {
  return `${object.ETag ?? ''}:${object.VersionId ?? ''}:${object.ContentLength ?? 0}`;
}

/** ListObjects supplies an ETag and size but no VersionId; verify the same fields on GET. */
export function listedObjectVersion(object: { ETag?: string; Size?: number }): string {
  if (!object.ETag) throw new Error('Source listing is missing an object ETag');
  return `listing:${object.ETag}:${object.Size ?? 0}`;
}
