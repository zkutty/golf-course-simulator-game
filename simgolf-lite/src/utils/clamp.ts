export function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}

export function clamp01(x: number) {
  return clamp(x, 0, 1);
}





