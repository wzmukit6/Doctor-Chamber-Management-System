/** Reads an image file, scales it down to fit the box and returns a PNG/JPEG data URL (keeps logos/signatures small). */
export async function imageToDataUrl(file: File, maxW: number, maxH: number, type: 'image/png' | 'image/jpeg' = 'image/png'): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('validation.image_type');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('validation.image_type'));
      i.src = url;
    });
    const scale = Math.min(1, maxW / img.width, maxH / img.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL(type, 0.9);
    if (data.length > 400_000) throw new Error('validation.image_too_large');
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}
