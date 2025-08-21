/**
 * Unified Euclidean Algorithm Implementation
 * 
 * This module provides the canonical implementation of the Euclidean rhythm algorithm
 * and related pattern manipulation utilities used throughout the application.
 */

/**
 * Greatest Common Divisor using Euclidean algorithm
 * @param {number} a - First number
 * @param {number} b - Second number
 * @returns {number} The GCD of a and b
 */
export function gcd(a, b) {
    while (b !== 0) {
        const temp = b;
        b = a % b;
        a = temp;
    }
    return a;
}

/**
 * Generate a Euclidean rhythm pattern using Björklund's algorithm
 * 
 * This is the canonical implementation that distributes `pulses` as evenly as possible
 * across `steps` using the Euclidean algorithm. This creates mathematically optimal
 * rhythm patterns that appear in many musical traditions worldwide.
 * 
 * @param {number} pulses - Number of beats/pulses to distribute
 * @param {number} steps - Total number of steps in the pattern
 * @returns {boolean[]} Array where true represents a pulse, false represents silence
 * 
 * @example
 * euclideanRhythm(3, 8) // Returns [true, false, false, true, false, false, true, false]
 * euclideanRhythm(5, 8) // Returns [true, false, true, true, false, true, true, false]
 */
export function euclideanRhythm(pulses, steps) {
    if (pulses > steps) return [];
    if (pulses === 0) return new Array(steps).fill(false);
    if (pulses === steps) return new Array(steps).fill(true);
    
    // Initialize pattern as array of arrays (Björklund's algorithm structure)
    const pattern = [];
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

/**
 * Convert a boolean pattern to an array of intervals between true values
 * 
 * This represents the "shape" of a rhythm pattern in terms of distances between
 * active steps, which is useful for pattern rotation and analysis.
 * 
 * @param {boolean[]} pattern - Boolean array where true represents active steps
 * @returns {number[]} Array of intervals between consecutive true values, including wrap-around
 * 
 * @example
 * patternToIntervals([true, false, true, true, false]) 
 * // Returns [2, 1, 2] meaning:
 * // - Distance from index 0 to 2: 2 steps
 * // - Distance from index 2 to 3: 1 step  
 * // - Distance from index 3 back to 0 (wrap): 2 steps
 */
export function patternToIntervals(pattern) {
    // Find all indices where the pattern is true
    const trueIndices = pattern.map((val, idx) => val ? idx : -1)
                             .filter(idx => idx !== -1);
    
    // Need at least 2 true values to calculate intervals
    if (trueIndices.length < 2) return [];
    
    const intervals = [];
    
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
 * Convert an array of intervals back to a boolean pattern
 * 
 * Reconstructs a rhythm pattern by placing true values at cumulative interval distances.
 * This is the inverse operation of patternToIntervals.
 * 
 * @param {number[]} intervals - Array of intervals between active steps
 * @param {number} steps - Total length of the pattern to generate
 * @returns {boolean[]} Boolean pattern reconstructed from the intervals
 * 
 * @example
 * intervalsToPattern([2, 1, 2], 5)
 * // Returns [true, false, true, true, false] meaning:
 * // - Start at 0: true
 * // - Add 2: position 2, true  
 * // - Add 1: position 3, true
 * // - (Last interval is for wrap-around, not used in reconstruction)
 */
export function intervalsToPattern(intervals, steps) {
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

/**
 * Continued fraction representation of a rational number
 * 
 * @param {number} num - Numerator
 * @param {number} den - Denominator  
 * @param {number} maxDepth - Maximum depth of continued fraction
 * @returns {number[]} Continued fraction coefficients
 */
export function continuedFraction(num, den, maxDepth = 10) {
    const result = [];
    for (let i = 0; i < maxDepth && den !== 0; i++) {
        const floor = Math.floor(num / den);
        result.push(floor);
        const temp = den;
        den = num - floor * den;
        num = temp;
    }
    return result;
}

/**
 * Calculate convergents of a continued fraction
 * 
 * @param {number[]} cf - Continued fraction coefficients
 * @returns {Array<[number, number]>} Array of [numerator, denominator] pairs
 */
export function convergents(cf) {
    if (cf.length === 0) return [];
    
    const convs = [];
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