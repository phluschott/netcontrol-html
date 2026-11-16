/**
 * Call sign rules.
 * A station identity is 3–8 letters and digits with at least one of each
 * (covers 1x1 special event calls such as K9A). Portable suffixes such as
 * /M, /P, /MM, /AE, or a region prefix like VE3/ are not part of the identity.
 */

const IDENTITY = /^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{3,8}$/;

/** Uppercase and strip spaces and anything that is not a letter, digit, or slash. */
export function cleanCallInput(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9/]/g, '');
}

/**
 * Reduce a call as heard or typed to the station identity.
 * "k9twx/m" -> "K9TWX", "VE3/K9TWX" -> "K9TWX" (longest valid segment wins).
 */
export function baseCall(raw: string): string {
  const parts = cleanCallInput(raw).split('/').filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? '';
  const valid = parts.filter((p) => IDENTITY.test(p));
  if (!valid.length) return parts.join('');
  return valid.sort((a, b) => b.length - a.length)[0];
}

export function isValidCall(call: string): boolean {
  return IDENTITY.test(call);
}

export function callError(call: string): string | null {
  if (!call) return 'Enter a call sign.';
  if (!/^[A-Z0-9]+$/.test(call)) return 'Use letters and digits only.';
  if (call.length < 3 || call.length > 8) return 'A call sign is 3 to 8 characters.';
  if (!/[A-Z]/.test(call) || !/\d/.test(call)) return 'A call sign has at least one letter and one digit.';
  return null;
}

/**
 * Rank how well a query matches a call sign for type-ahead.
 * Lower is better; -1 means no match. Suffix matches rank right after
 * prefix matches because operators often copy only the suffix.
 */
export function callMatchRank(call: string, query: string): number {
  if (!query) return 0;
  if (call === query) return 0;
  if (call.startsWith(query)) return 1;
  if (call.endsWith(query)) return 2;
  if (call.includes(query)) return 3;
  return -1;
}
