import { describe, it, expect } from 'vitest';
import { avatarInitials, defaultAvatar, resolveAvatar, validateAvatar, AVATAR_COLORS, AVATAR_STYLES } from '../avatars.js';
describe('generated avatars', () => {
  it('uses initials with whitespace, single names and Unicode', () => {
    expect(avatarInitials('  Alice   Watson ')).toBe('AW');
    expect(avatarInitials('Priya')).toBe('P');
    expect(avatarInitials('')).toBe('?');
    expect(avatarInitials('Émilie Durand')).toBe('ÉD');
    expect(avatarInitials('李 明')).toBe('李明');
  });
  it('chooses a deterministic default color from user identity', () => {
    expect(defaultAvatar('alice')).toEqual(defaultAvatar('alice'));
    expect(AVATAR_COLORS.map((c) => c.id)).toContain(defaultAvatar('alice').avatarColor);
    expect(defaultAvatar('alice').avatarStyle).toBe('circle');
  });
  it('honors each built-in style/color without URLs or custom CSS', () => {
    for (const style of AVATAR_STYLES) for (const color of AVATAR_COLORS) {
      expect(resolveAvatar({ uid: 'a', name: 'Alice Watson', avatarStyle: style.id, avatarColor: color.id })).toEqual({ initials: 'AW', avatarStyle: style.id, avatarColor: color.id, background: color.background });
    }
  });
  it('gives legacy profiles a sensible default without mutating them', () => {
    const legacy = { uid: 'old-user', displayName: 'Old User', photoURL: 'https://firebasestorage.googleapis.com/legacy' };
    const before = JSON.stringify(legacy);
    const avatar = resolveAvatar(legacy);
    expect(avatar.initials).toBe('OU');
    expect(avatar.avatarStyle).toBe('circle');
    expect(JSON.stringify(legacy)).toBe(before);
    expect(avatar).not.toHaveProperty('photoURL');
  });
  it('falls back safely for invalid stored values', () => {
    expect(resolveAvatar({ uid: 'a', avatarStyle: 'bad', avatarColor: 'url(https://remote)' })).toMatchObject(defaultAvatar('a'));
  });
  it('rejects unsupported profile selections', () => {
    expect(() => validateAvatar({ avatarStyle: 'bad', avatarColor: 'blue' })).toThrow();
    expect(() => validateAvatar({ avatarStyle: 'circle', avatarColor: '#abcdef' })).toThrow();
    expect(validateAvatar({ avatarStyle: 'rounded', avatarColor: 'violet' })).toEqual({ avatarStyle: 'rounded', avatarColor: 'violet' });
  });
  it('uses backgrounds with readable white initials (WCAG normal-text contrast)', () => {
    const luminance = (hex) => {
      const values = hex.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
      return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
    };
    for (const color of AVATAR_COLORS) expect(1.05 / (luminance(color.background) + .05)).toBeGreaterThanOrEqual(4.5);
  });
});
