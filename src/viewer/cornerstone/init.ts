import {
  cache,
  cornerstoneStreamingImageVolumeLoader,
  Enums,
  imageLoadPoolManager,
  imageRetrievalPoolManager,
  init as initCore,
  metaData,
  volumeLoader
} from '@cornerstonejs/core';
import { init as initDicomImageLoader } from '@cornerstonejs/dicom-image-loader';
import { init as initTools } from '@cornerstonejs/tools';
import { deviceProfile } from '../core/DeviceProfile';
import { indexMetadataProvider } from './metadata';
import { registerTools } from './tools';

export interface RequestLimits {
  /** Downloads for the image on screen. */
  interaction: number;
  /** Speculative downloads (stack prefetch, volume streaming); always fewer, so the image on screen has room. */
  prefetch: number;
}

let ready: Promise<void> | undefined;

/** Starts Cornerstone once: rendering, the DICOM image loader and its decode workers, tools and metadata. */
export function initCornerstone(): Promise<void> {
  ready ??= (async () => {
    const profile = deviceProfile();
    await initCore({
      isMobile: profile.constrained,
      rendering: {
        // Phones keep volumes in 16-bit textures: half the GPU memory of float textures.
        preferSizeOverAccuracy: profile.constrained,
        // Real CT series often have small spacing irregularities; a black volume viewport helps nobody.
        strictZSpacingForVolumeViewport: false
      },
      debug: {}
    });
    initDicomImageLoader({ maxWebWorkers: profile.decodeWorkers });
    initTools();
    registerTools();
    // Above the loaders' own providers, which only know an image once its file has been fetched.
    metaData.addProvider(indexMetadataProvider, 10000);
    volumeLoader.registerUnknownVolumeLoader(cornerstoneStreamingImageVolumeLoader as unknown as Parameters<typeof volumeLoader.registerUnknownVolumeLoader>[0]);
    cache.setMaxCacheSize(profile.frameCacheBytes);
    setRequestLimits({ interaction: profile.remoteRequests.max, prefetch: Math.max(1, profile.remoteRequests.max - 2) });
  })();
  return ready;
}

/**
 * Cornerstone's defaults allow hundreds of simultaneous requests, which floods a small image server and makes the
 * image on screen wait behind speculative work. Thumbnails get one slot.
 */
export function setRequestLimits({ interaction, prefetch }: RequestLimits): void {
  for (const pool of [imageLoadPoolManager, imageRetrievalPoolManager]) {
    pool.setMaxSimultaneousRequests(Enums.RequestType.Interaction, interaction);
    pool.setMaxSimultaneousRequests(Enums.RequestType.Prefetch, prefetch);
    pool.setMaxSimultaneousRequests(Enums.RequestType.Thumbnail, 1);
  }
}
