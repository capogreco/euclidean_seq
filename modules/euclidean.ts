export function gcd(a: number, b: number): number {
  while (b !== 0) {
    const temp = b;
    b = a % b;
    a = temp;
  }
  return a;
}

export function euclideanRhythm(pulses: number, steps: number): boolean[] {
  if (pulses > steps) return [];
  if (pulses === 0) return new Array(steps).fill(false);
  if (pulses === steps) return new Array(steps).fill(true);
  
  const pattern: boolean[][] = [];
  for (let i = 0; i < steps; i++) {
    pattern.push([i < pulses]);
  }
  
  let level = 0;
  while (pattern.length > 1 && pattern.length - pulses > 0) {
    const count = Math.min(pulses, pattern.length - pulses);
    for (let i = 0; i < count; i++) {
      pattern[i].push(...pattern[pattern.length - 1]);
      pattern.pop();
    }
    level++;
    pulses = pattern.length - count;
  }
  
  return pattern.flat();
}

export function continuedFraction(num: number, den: number, maxDepth: number = 10): number[] {
  const result: number[] = [];
  for (let i = 0; i < maxDepth && den !== 0; i++) {
    const floor = Math.floor(num / den);
    result.push(floor);
    const temp = den;
    den = num - floor * den;
    num = temp;
  }
  return result;
}

export function convergents(cf: number[]): Array<[number, number]> {
  if (cf.length === 0) return [];
  
  const convs: Array<[number, number]> = [];
  let h0 = 0, h1 = 1;
  let k0 = 1, k1 = 0;
  
  for (const a of cf) {
    const h2 = a * h1 + h0;
    const k2 = a * k1 + k0;
    convs.push([h2, k2]);
    h0 = h1; h1 = h2;
    k0 = k1; k1 = k2;
  }
  
  return convs;
}