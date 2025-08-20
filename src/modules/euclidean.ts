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

/**
 * Converts a boolean pattern to an array of intervals between true values.
 * This represents the "shape" of the pattern in terms of distances between active steps.
 * 
 * @param pattern - Boolean array where true represents active steps
 * @returns Array of intervals between consecutive true values, including wrap-around
 * 
 * @example
 * patternToIntervals([true, false, true, true, false]) returns [2, 1, 2]
 * - Distance from index 0 to 2: 2 steps
 * - Distance from index 2 to 3: 1 step  
 * - Distance from index 3 back to 0 (wrap): 2 steps
 */
export function patternToIntervals(pattern: boolean[]): number[] {
  // Find all indices where the pattern is true
  const trueIndices = pattern.map((val, idx) => val ? idx : -1)
                           .filter(idx => idx !== -1);
  
  // Need at least 2 true values to calculate intervals
  if (trueIndices.length < 2) return [];
  
  const intervals: number[] = [];
  
  // Calculate intervals between consecutive true values
  for (let i = 0; i < trueIndices.length - 1; i++) {
    intervals.push(trueIndices[i + 1] - trueIndices[i]);
  }
  
  // Calculate wrap-around interval (from last true index back to first)
  const lastIndex = trueIndices[trueIndices.length - 1];
  const firstIndex = trueIndices[0];
  const wrapInterval = (pattern.length - lastIndex) + firstIndex;
  intervals.push(wrapInterval);
  
  return intervals;
}

/**
 * Converts an array of intervals back to a boolean pattern.
 * Reconstructs the pattern by placing true values at cumulative interval distances.
 * 
 * @param intervals - Array of intervals between active steps
 * @param steps - Total length of the pattern to generate
 * @returns Boolean pattern reconstructed from the intervals
 * 
 * @example
 * intervalsToPattern([2, 1, 2], 5) returns [true, false, true, true, false]
 * - Start at 0: true
 * - Add 2: position 2, true
 * - Add 1: position 3, true
 * - (Last interval is for wrap-around, not used in reconstruction)
 */
export function intervalsToPattern(intervals: number[], steps: number): boolean[] {
  const pattern = new Array(steps).fill(false);
  
  // Return empty pattern if no intervals provided
  if (intervals.length === 0) return pattern;
  
  // Always start with first position true
  pattern[0] = true;
  let currentPos = 0;
  
  // Place subsequent true values using intervals (excluding wrap-around interval)
  for (let i = 0; i < intervals.length - 1; i++) {
    currentPos = (currentPos + intervals[i]) % steps;
    pattern[currentPos] = true;
  }
  
  return pattern;
}