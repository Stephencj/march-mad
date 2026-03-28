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

export function isInPassLane(
  ballPos: { x: number; z: number },
  targetPos: { x: number; z: number },
  defenderPos: { x: number; z: number },
  laneWidth: number
): boolean {
  const dx = targetPos.x - ballPos.x;
  const dz = targetPos.z - ballPos.z;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 0.01) return false;

  const t = ((defenderPos.x - ballPos.x) * dx + (defenderPos.z - ballPos.z) * dz) / lenSq;
  if (t < 0 || t > 1) return false;

  const closestX = ballPos.x + t * dx;
  const closestZ = ballPos.z + t * dz;
  const perpDx = defenderPos.x - closestX;
  const perpDz = defenderPos.z - closestZ;
  const perpDist = Math.sqrt(perpDx * perpDx + perpDz * perpDz);

  return perpDist < laneWidth;
}
