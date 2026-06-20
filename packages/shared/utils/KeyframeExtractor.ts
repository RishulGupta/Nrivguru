import type { PoseFrame } from '../types/pose';

/**
 * Calculates Euclidean distance between two 3D points
 */
function getDistance(a: {x: number, y: number, z: number}, b: {x: number, y: number, z: number}): number {
  return Math.sqrt(
    Math.pow(a.x - b.x, 2) + 
    Math.pow(a.y - b.y, 2) + 
    Math.pow(a.z - b.z, 2)
  );
}

/**
 * Extracts structurally significant keyframes from a sequence of pose frames.
 * Uses local maxima of the overall kinetic energy (sum of Euclidean displacements of all landmarks).
 */
export function extractKeyframes(poseFrames: PoseFrame[], count: number = 4): PoseFrame[] {
  if (poseFrames.length <= count) {
    return poseFrames;
  }

  // 1. Compute kinetic energy (velocity proxy) per frame
  const energies: number[] = [0]; // First frame has 0 previous displacement

  for (let i = 1; i < poseFrames.length; i++) {
    const current = poseFrames[i].landmarks;
    const previous = poseFrames[i - 1].landmarks;
    let frameEnergy = 0;

    // Sum displacements for all 33 landmarks
    for (let j = 0; j < 33; j++) {
      frameEnergy += getDistance(current[j], previous[j]);
    }
    energies.push(frameEnergy);
  }

  // 2. Find local maxima
  const localMaximaIndices: number[] = [];
  for (let i = 1; i < energies.length - 1; i++) {
    if (energies[i] > energies[i - 1] && energies[i] > energies[i + 1]) {
      localMaximaIndices.push(i);
    }
  }

  // Sort maxima by energy (highest first) to get the most significant peaks
  const sortedMaxima = [...localMaximaIndices].sort((a, b) => energies[b] - energies[a]);
  let selectedIndices = sortedMaxima.slice(0, count);

  // 3. Fallback: If not enough peaks found, sample at regular intervals
  if (selectedIndices.length < count) {
    const missing = count - selectedIndices.length;
    for (let i = 1; i <= missing; i++) {
      const fallbackIndex = Math.floor((poseFrames.length / (missing + 1)) * i);
      if (!selectedIndices.includes(fallbackIndex)) {
        selectedIndices.push(fallbackIndex);
      }
    }
  }

  // 4. Sort indices chronologically
  selectedIndices.sort((a, b) => a - b);

  return selectedIndices.map(index => poseFrames[index]);
}
