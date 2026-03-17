export interface FormationPosition5v5 {
  x: number;
  z: number;
}

// Offensive formations (5 players, relative to attacking hoop)
// Index order: PG(0), SG(1), SF(2), PF(3), C(4)
export const FORMATIONS_5V5: Record<string, FormationPosition5v5[]> = {
  spread: [
    { x: 0, z: 8 },      // PG: top of key
    { x: -5.5, z: 5 },   // SG: left wing
    { x: 5.5, z: 5 },    // SF: right wing
    { x: -3, z: 1.5 },   // PF: left block
    { x: 3, z: 1.5 },    // C: right block
  ],
  tight: [
    { x: 0, z: 6 },      // PG: high post
    { x: -3, z: 3 },     // SG: left elbow
    { x: 3, z: 3 },      // SF: right elbow
    { x: -1.5, z: 1 },   // PF: left low post
    { x: 1.5, z: 1 },    // C: right low post
  ],
  balanced: [
    { x: 0, z: 7 },      // PG: top
    { x: -4.5, z: 4 },   // SG: left wing
    { x: 4.5, z: 4 },    // SF: right wing
    { x: -2, z: 1.5 },   // PF: left block
    { x: 2, z: 1.5 },    // C: right block
  ],
  triangle: [
    { x: 0, z: 8 },      // PG: point
    { x: -5, z: 3 },     // SG: left corner
    { x: 5, z: 3 },      // SF: right corner
    { x: 0, z: 2 },      // PF: high post
    { x: 0, z: 0 },      // C: low post
  ],
};

// Defensive formations mirror offense but shifted toward the hoop
const DEFENSE_OFFSET_Z = -3; // shift all positions toward hoop

export function getFormation5v5(formation: string, isDefense = false): FormationPosition5v5[] {
  const base = FORMATIONS_5V5[formation] ?? FORMATIONS_5V5['balanced'];
  if (!isDefense) return base;
  return base.map(p => ({ x: p.x * 0.7, z: p.z + DEFENSE_OFFSET_Z }));
}
