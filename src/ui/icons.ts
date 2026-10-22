// 3D-иконки Microsoft Fluent Emoji (лицензия MIT, public/icons/LICENSE.txt), хранятся в приложении.
export function iconUrl(name: string): string {
  const slug = name === 'Person' ? 'person' : name.toLowerCase().replace(/ /g, '_');
  return `${import.meta.env.BASE_URL}icons/${slug}.png`;
}
