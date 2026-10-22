// Свои фото блюд: уменьшаются на устройстве и кладутся в приватное хранилище photos/<owner>/...
import { supabase } from './client';

const MAX_SIDE = 1200;

/** Уменьшить фото до 1200 px по большей стороне (экономит место: 1 ГБ на всё). */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * k);
  canvas.height = Math.round(bitmap.height * k);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Не удалось обработать фото'))), 'image/jpeg', 0.82),
  );
}

export async function uploadRecipePhoto(owner: string, recipeId: string, file: File): Promise<string> {
  const blob = await shrink(file);
  const path = `${owner}/recipes/${recipeId}-${Date.now()}.jpg`;
  const { error } = await supabase.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) throw new Error(error.message);
  return path;
}

const cache = new Map<string, { url: string; until: number }>();

/** Временная ссылка на приватное фото (на 1 час). */
export async function photoUrl(path: string): Promise<string | null> {
  const hit = cache.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from('photos').createSignedUrl(path, 3600);
  if (error || !data) return null;
  cache.set(path, { url: data.signedUrl, until: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}
