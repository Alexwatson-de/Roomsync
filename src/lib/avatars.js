// Built-in avatars: no image files, URLs, external API, Storage or billing.
// Store only these small enum values on users/{uid} and membership snapshots.
export const AVATAR_STYLES = [
  { id: 'circle', label: 'Circle' },
  { id: 'rounded', label: 'Rounded' },
  { id: 'ring', label: 'Ring' },
];
export const AVATAR_COLORS = [
  { id: 'emerald', label: 'Emerald', background: '#176b47' },
  { id: 'teal', label: 'Teal', background: '#0f6670' },
  { id: 'blue', label: 'Blue', background: '#285ca0' },
  { id: 'violet', label: 'Violet', background: '#6845a0' },
  { id: 'rose', label: 'Rose', background: '#a13760' },
  { id: 'amber', label: 'Amber', background: '#92400e' },
];
export function avatarInitials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  return words.length ? words.slice(0, 2).map((word) => Array.from(word)[0]).join('').toLocaleUpperCase() : '?';
}
export function defaultAvatar(seed = '') {
  let hash = 2166136261;
  for (const character of String(seed)) hash = Math.imul(hash ^ character.codePointAt(0), 16777619) >>> 0;
  return { avatarStyle: 'circle', avatarColor: AVATAR_COLORS[hash % AVATAR_COLORS.length].id };
}
export function resolveAvatar({ uid, name, displayName, avatarStyle, avatarColor } = {}) {
  const defaults = defaultAvatar(uid || name || displayName || 'RoomSync');
  const color = AVATAR_COLORS.find((option) => option.id === avatarColor) || AVATAR_COLORS.find((option) => option.id === defaults.avatarColor);
  return {
    initials: avatarInitials(name || displayName),
    avatarStyle: AVATAR_STYLES.some((option) => option.id === avatarStyle) ? avatarStyle : defaults.avatarStyle,
    avatarColor: color.id,
    background: color.background,
  };
}
export function validateAvatar({ avatarStyle, avatarColor }) {
  if (!AVATAR_STYLES.some((option) => option.id === avatarStyle) || !AVATAR_COLORS.some((option) => option.id === avatarColor)) throw new Error('Choose a built-in avatar style and color.');
  return { avatarStyle, avatarColor };
}
