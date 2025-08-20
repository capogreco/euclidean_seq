import { euclideanRhythm, gcd, patternToIntervals, intervalsToPattern } from "./euclidean.ts";

export interface ScaleParams {
  edo: number;
  noteCount: number;
  rotation: number;
  rootFreq: number;
}

export interface Scale {
  name: string;
  edo: number;
  steps: number[];
  frequencies: number[];
  intervals: number[];
  pattern: boolean[];
}

export class ScaleGenerator {
  constructor(private params: ScaleParams) {}
  
  generateScale(): Scale {
    const { edo, noteCount, rotation, rootFreq } = this.params;
    
    // Use Euclidean algorithm to distribute notes evenly in EDO
    const pattern = euclideanRhythm(noteCount, edo);
    
    if (noteCount === 0) {
      return this.createEmptyScale();
    }
    
    // Convert pattern to canonical interval representation
    const canonicalIntervals = patternToIntervals(pattern);
    
    if (canonicalIntervals.length === 0) {
      return this.createEmptyScale();
    }
    
    // Apply rotation to the interval array (handles rotation = 0 gracefully)
    let rotatedIntervals = canonicalIntervals;
    if (rotation > 0 && canonicalIntervals.length > 0) {
      const rot = rotation % canonicalIntervals.length;
      rotatedIntervals = [
        ...canonicalIntervals.slice(rot),
        ...canonicalIntervals.slice(0, rot)
      ];
    }
    
    // Build scale steps from rotated intervals
    const steps = [0];
    let currentStep = 0;
    for (let i = 0; i < rotatedIntervals.length - 1; i++) {
      currentStep += rotatedIntervals[i];
      steps.push(currentStep);
    }
    
    const stepsWithOctave = [...steps, edo];
    
    // Calculate frequencies in one pass
    const frequencies = stepsWithOctave.map(step => 
      rootFreq * Math.pow(2, step / edo)
    );
    
    // Final intervals including octave completion
    const intervalsWithOctave = [
      ...rotatedIntervals.slice(0, -1),
      edo - steps[steps.length - 1]
    ];
    
    return {
      name: this.getScaleName(),
      edo,
      steps: stepsWithOctave,
      frequencies,
      intervals: intervalsWithOctave,
      pattern // Keep original canonical pattern for reference
    };
  }

  private createEmptyScale(): Scale {
    const { edo, rootFreq } = this.params;
    return {
      name: "Empty Scale",
      edo,
      steps: [0, edo],
      frequencies: [rootFreq, rootFreq * 2],
      intervals: [edo],
      pattern: new Array(edo).fill(false)
    };
  }

  // Helper methods no longer needed with interval-based approach
  // The new approach directly uses patternToIntervals and intervalsToPattern
  
  getScaleName(): string {
    const { edo, noteCount } = this.params;
    
    if (edo === 12) {
      const scaleNames: Record<number, string> = {
        7: "Diatonic (Major Scale)",
        5: "Pentatonic",
        3: "Triad",
        4: "Tetrachord",
        6: "Hexatonic",
        8: "Octatonic",
        12: "Chromatic"
      };
      return scaleNames[noteCount] || `${noteCount}-note scale in 12-EDO`;
    }
    
    return `${noteCount} notes in ${edo}-EDO`;
  }
  
  getMode(scale: Scale, degree: number): Scale {
    const rotated = [
      ...scale.steps.slice(degree),
      ...scale.steps.slice(0, degree).map(s => s + scale.edo)
    ];
    
    const normalized = rotated.map(s => s - rotated[0]);
    
    const intervals = normalized.map((step, i) => {
      const next = normalized[(i + 1) % normalized.length];
      return next > step ? next - step : scale.edo - step + next;
    });
    
    return {
      ...scale,
      steps: normalized.slice(0, -1),
      intervals: intervals.slice(0, -1),
      name: `Mode ${degree + 1} of ${scale.name}`
    };
  }
}

export class TuningLattice {
  constructor(private baseFreq: number = 440) {}
  
  justIntonation(limit: number = 5): Map<string, number> {
    const ratios = new Map<string, number>();
    
    ratios.set("1/1", 1);
    ratios.set("9/8", 9/8);
    ratios.set("5/4", 5/4);
    ratios.set("4/3", 4/3);
    ratios.set("3/2", 3/2);
    ratios.set("5/3", 5/3);
    ratios.set("15/8", 15/8);
    
    if (limit >= 7) {
      ratios.set("7/4", 7/4);
      ratios.set("7/6", 7/6);
    }
    
    const frequencies = new Map<string, number>();
    for (const [name, ratio] of ratios) {
      frequencies.set(name, this.baseFreq * ratio);
    }
    
    return frequencies;
  }
  
  cents(freq1: number, freq2: number): number {
    return 1200 * Math.log2(freq2 / freq1);
  }
}