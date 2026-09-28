import { imageLoader } from '@cornerstonejs/core';
import { wadouri } from '@cornerstonejs/dicom-image-loader';
import type { DicomTag } from '../../types/dicom';
import { extractRawTags } from './DicomParser';

/** Tags of an image read through the wadouri pipeline, from the file Cornerstone has already parsed. */
export async function wadouriTags(imageId: string): Promise<DicomTag[]> {
  const { url } = wadouri.parseImageId(imageId);
  if (!wadouri.dataSetCacheManager.isLoaded(url)) await imageLoader.loadAndCacheImage(imageId);
  const dataSet = wadouri.dataSetCacheManager.get(url);
  return dataSet ? extractRawTags(dataSet) : [];
}
