/**
 * Module-level video store — survives SPA navigation (no page reload).
 * Blob URLs would die on full page refresh, but React Router navigations
 * within the app keep the document alive, so blob URLs remain valid.
 */
let _originalVideoBlobUrl: string | null = null;

export function setOriginalVideo(blobUrl: string) {
  // Revoke previous one if any
  if (_originalVideoBlobUrl) URL.revokeObjectURL(_originalVideoBlobUrl);
  _originalVideoBlobUrl = blobUrl;
}

export function getOriginalVideoUrl(): string | null {
  return _originalVideoBlobUrl;
}

export function clearOriginalVideo() {
  if (_originalVideoBlobUrl) URL.revokeObjectURL(_originalVideoBlobUrl);
  _originalVideoBlobUrl = null;
}
