const PRAISE = new Set([
  'nice',
  'good',
  'best',
  'super',
  'excellent',
  'helpful',
  'very',
  'app',
  'apps',
  'application',
  'experience',
  'great',
  'awesome',
  'love',
  'loved',
  'amazing',
  'perfect',
  'cool',
  'ok',
  'okay',
  'wow',
  'thanks',
  'thank',
  'you',
  'superb',
  'fantastic',
  'outstanding'
]);

const SIP_INVEST = /\b(sips?|invest\w*|mutual|funds?|nav|lumpsum|lump[\s-]?sum|elss|xirr|portfolio|redeem\w*|mandate)\b/i;
const SIP_DEVANAGARI = /सिप|एसआईपी|निवेश|म्यूचुअल|फंड/;

function wordsOf(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function isPrefilteredGeneric(text: string): boolean {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return true;
  const words = wordsOf(trimmed);
  if (!words.length) return true;
  const hasSip = SIP_INVEST.test(trimmed) || SIP_DEVANAGARI.test(trimmed);
  if (words.join('').length < 12 && !hasSip) return true;
  return words.every((word) => PRAISE.has(word));
}

const HINGLISH = /\b(nahi|nahin|paise|paisa|accha|acha|bahut|mujhe|mera|kya|kaise|wapas|rupaye|bhai|yaar|karo|kiya|milega)\b/i;

export function isHindiOrHinglish(text: string): boolean {
  return /\p{Script=Devanagari}/u.test(text) || HINGLISH.test(text);
}
