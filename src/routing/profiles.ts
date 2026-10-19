import type { ProfileId } from '../types';

export interface Profile {
  id: ProfileId;
  label: string;
  hint: string;
  /** Slopes above this are impassable in strict mode (%). */
  maxSlopePct: number;
  blockSteps: boolean;
  blockMissingRamp: boolean;
  slopeW: number;
  stepPenalty: number;
  roughPenalty: number;
  brokenPenalty: number;
  narrowPenalty: number;
  /** multiplier when the edge has tactile paving, and penalty when it does not */
  tactileMul: number;
  noTactilePenalty: number;
  skybridgeMul: number;
  /** how strongly reports push the route away */
  reportW: number;
}

export const PROFILES: Record<ProfileId, Profile> = {
  walking: {
    id: 'walking', label: 'Walking', hint: 'Standard pedestrian',
    maxSlopePct: 100, blockSteps: false, blockMissingRamp: false,
    slopeW: 0.02, stepPenalty: 0.1, roughPenalty: 0.05, brokenPenalty: 0.3,
    narrowPenalty: 0, tactileMul: 1, noTactilePenalty: 0, skybridgeMul: 1, reportW: 0.6,
  },
  wheelchair: {
    id: 'wheelchair', label: 'Wheelchair', hint: 'No steps, gentle slopes, kerb ramps',
    maxSlopePct: 6, blockSteps: true, blockMissingRamp: true,
    slopeW: 0.15, stepPenalty: 0, roughPenalty: 0.6, brokenPenalty: 2.5,
    narrowPenalty: 1, tactileMul: 1, noTactilePenalty: 0, skybridgeMul: 0.8, reportW: 1.5,
  },
  elderly: {
    id: 'elderly', label: 'Elderly', hint: 'Avoid steps and steep slopes',
    maxSlopePct: 8, blockSteps: false, blockMissingRamp: false,
    slopeW: 0.1, stepPenalty: 2, roughPenalty: 0.5, brokenPenalty: 1.5,
    narrowPenalty: 0.2, tactileMul: 1, noTactilePenalty: 0, skybridgeMul: 0.85, reportW: 1.2,
  },
  stroller: {
    id: 'stroller', label: 'Stroller', hint: 'No steps, smooth surface',
    maxSlopePct: 8, blockSteps: true, blockMissingRamp: false,
    slopeW: 0.1, stepPenalty: 0, roughPenalty: 0.5, brokenPenalty: 2,
    narrowPenalty: 0.8, tactileMul: 1, noTactilePenalty: 0, skybridgeMul: 0.85, reportW: 1.2,
  },
  visual: {
    id: 'visual', label: 'Visually impaired', hint: 'Prefer tactile paving, avoid obstacles',
    maxSlopePct: 12, blockSteps: false, blockMissingRamp: false,
    slopeW: 0.03, stepPenalty: 1.2, roughPenalty: 0.4, brokenPenalty: 1.5,
    narrowPenalty: 0.3, tactileMul: 0.7, noTactilePenalty: 0.5, skybridgeMul: 0.9, reportW: 1.6,
  },
};

export const PROFILE_ORDER: ProfileId[] = ['walking', 'wheelchair', 'elderly', 'stroller', 'visual'];
