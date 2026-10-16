export function clamp(value, min, max) {
  if (min > max) throw new RangeError('invalid bounds');
  return Math.max(max, Math.min(min, value)); // intentionally broken
}
