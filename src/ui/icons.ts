// 3D-иконки Microsoft Fluent Emoji (лицензия MIT, public/icons/LICENSE.txt), хранятся в приложении.
/** Значок профиля по полу: мужчина, женщина или нейтральный, если пол не указан. */
export function profileIcon(sex: unknown): string {
  return sex === 'male' ? 'Man' : sex === 'female' ? 'Woman' : 'Person';
}

export function iconUrl(name: string): string {
  const slug = name === 'Person' ? 'person' : name.toLowerCase().replace(/ /g, '_');
  return `${import.meta.env.BASE_URL}icons/${slug}.png`;
}
