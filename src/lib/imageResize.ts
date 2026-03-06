const AVATAR_SIZE = 128;

/**
 * Resize an image file to a square of AVATAR_SIZE x AVATAR_SIZE, preserving aspect ratio and cropping to center.
 * Returns a PNG Blob.
 */
export function resizeImageToAvatar(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = AVATAR_SIZE;
      canvas.height = AVATAR_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2d not available'));
        return;
      }
      const scale = Math.max(AVATAR_SIZE / img.width, AVATAR_SIZE / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = (AVATAR_SIZE - w) / 2;
      const y = (AVATAR_SIZE - h) / 2;
      ctx.drawImage(img, x, y, w, h);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
        'image/png',
        0.9
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}
