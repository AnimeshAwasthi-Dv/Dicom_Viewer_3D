/** Immutable source selection stored with the import job. */
export interface SourceObject { key: string; version: string }

export function objectVersion(object: { ETag?: string; VersionId?: string; ContentLength?: number }): string {
  return `${object.ETag ?? ''}:${object.VersionId ?? ''}:${object.ContentLength ?? 0}`;
}
