interface PasserInfo {
  x: number;
  z: number;
  facingAngle: number;
}

interface PassCandidate {
  id: string;
  x: number;
  z: number;
}

export function findBestPassTarget(
  passer: PasserInfo,
  teammates: PassCandidate[]
): PassCandidate | null {
  if (teammates.length === 0) return null;

  const facingX = Math.sin(passer.facingAngle);
  const facingZ = Math.cos(passer.facingAngle);

  let best: PassCandidate | null = null;
  let bestScore = -Infinity;

  for (const tm of teammates) {
    const dx = tm.x - passer.x;
    const dz = tm.z - passer.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.01) continue;

    const dirX = dx / dist;
    const dirZ = dz / dist;
    const dot = facingX * dirX + facingZ * dirZ;
    const alignment = Math.max(0, dot);

    const distanceFactor = 1 / dist;
    const score = alignment * 0.7 + distanceFactor * 0.3;

    if (score > bestScore) {
      bestScore = score;
      best = tm;
    }
  }

  return best;
}
