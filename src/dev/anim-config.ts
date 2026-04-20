/**
 * Mutable animation parameters for GamePlayer. `GamePlayer.animate()` reads
 * these every tick, so edits via the dev overlay or the anim-viewer page
 * take effect immediately on the next frame.
 *
 * Organized into three tiers:
 *   - `durations` — time constants (state durations in seconds; cycle
 *     frequencies that multiply `animTime`)
 *   - `amplitudes` — principal per-animation "how big / how high" knobs
 *     (stride length, bounce height, arm-swing angle, etc.)
 *   - `poses`     — endpoint bone rotations / scales / positions per
 *     animation phase, exhaustively extracted from the hardcoded state
 *     machine
 *
 * Defaults exactly match the values that used to live as inline literals
 * in `src/game/player.ts` — the refactor that replaced those literals is a
 * pure byte-identical swap at default config.
 */

export interface AnimConfig {
  __version: number;
  durations: AnimDurations;
  amplitudes: AnimAmplitudes;
  poses: AnimPoses;
}

export interface AnimDurations {
  // Cycle frequencies (multiplier on animTime; higher = faster cycle)
  idleBob: number;
  walkStride: number;
  walkBounce: number;
  backwardStride: number;
  backwardBounce: number;
  sprintStride: number;
  sprintBounce: number;
  dribbleCycle: number;
  dribbleSprintStride: number;
  dribbleSprintBounce: number;
  guardPulse: number;
  indicatorBob: number;
  possessionRingPulse: number;
  // Fixed state durations in seconds
  stealDuration: number;
  shootDuration: number;
  jumpDuration: number;
  jumpBlockDuration: number;
  fallDuration: number;
  dunkDuration: number;
  passDuration: number;
}

export interface AnimAmplitudes {
  idle: { swayHeight: number; kneeBend: number; elbowBend: number };
  walk: {
    bounceHeight: number;
    strideAmp: number;
    kneeBase: number;
    kneeSwing: number;
    armSwingRatio: number;
    elbowBend: number;
    forwardLean: number;
    hipTwist: number;
    torsoTwist: number;
  };
  walkBackward: {
    bounceHeight: number;
    strideAmp: number;
    kneeBase: number;
    kneeSwing: number;
    shoulderX: number;
    shoulderZ: number;
  };
  dribble: {
    bounceHeight: number;
    strideAmp: number;
    kneeBase: number;
    kneeSwing: number;
    bodyCrouch: number;
    armUpElbow: number;
    armDownElbow: number;
    shoulderUpPump: number;
    shoulderDownPump: number;
    leftArmSpread: number;
  };
  dribbleStationary: { bob: number; bodyCrouch: number };
  sprint: {
    bounceHeight: number;
    strideAmp: number;
    forwardLean: number;
    kneeBase: number;
    kneeDrive: number;
    shoulderSwing: number;
    elbowBend: number;
    hipTwist: number;
    torsoTwist: number;
  };
  dribbleSprint: {
    bounceHeight: number;
    strideAmp: number;
    bodyCrouch: number;
    kneeBase: number;
    kneeSwing: number;
    leftArmOutward: number;
  };
  guard: {
    forwardLean: number;
    hipSpread: number;
    kneeBend: number;
    shoulderRaise: number;
    shoulderSpread: number;
    stanceLower: number;
    blockOpacityMin: number;
    blockOpacitySwing: number;
  };
  steal: {
    windShoulder: number;
    holdShoulderZ: number;
    forearmGrowMax: number;
    bodyTwist: number;
    compressionX: number;
    compressionY: number;
    swipeStretchH: number;
    swipeSquashV: number;
    swipeTwist: number;
    stanceLower: number;
    crouchKnee: number;
  };
  shoot: {
    hopHeight: number;
    snapElbow: number;
    snapShoulderR: number;
    snapShoulderL: number;
    guideInward: number;
    guideElbow: number;
    crouchKnee: number;
    releaseShoulder: number;
    releaseElbow: number;
    leftArmDrop: number;
    rightFootFwd: number;
    leftFootBack: number;
    rightKneeAbsorb: number;
    leftKneeAbsorb: number;
    twistWind: number;
    twistRelease: number;
  };
  jump: {
    apexHeight: number;
    crouchLean: number;
    crouchKnee: number;
    crouchHip: number;
    crouchShoulder: number;
    crouchElbow: number;
    launchShoulder: number;
    launchLeftLateral: number;
    hangKnee: number;
    landKnee: number;
    hangShoulderR: number;
    hangLeftArm: number;
    hangHip: number;
    hipTwist: number;
  };
  jumpBlock: {
    apexHeight: number;
    crouchKnee: number;
    shoulderRaise: number;
    shoulderSpread: number;
    elbowBend: number;
    hangKnee: number;
  };
  fall: {
    backLean: number;
    sideTilt: number;
    shoulderFlailLX: number;
    shoulderFlailRX: number;
    shoulderFlailLZ: number;
    shoulderFlailRZ: number;
    kneeBuckleL: number;
    kneeBuckleR: number;
    groundDrop: number;
    flatBackLean: number;
    groundArmExtend: number;
    groundKneeL: number;
    groundKneeR: number;
  };
  dunk: {
    apexHeight: number;
    riseTime: number;
    hangStart: number;
    dropStart: number;
    landStart: number;
    riseCrouch: number;
    mjKneeL: number;
    mjKneeR: number;
    mjHipL: number;
    mjHipR: number;
    mjHipZ: number;
    armScalePeak: number;
    armThickness: number;
    rimHangArmScaleU: number;
    rimHangArmScaleF: number;
    rimHangKneeL: number;
    rimHangKneeR: number;
    slamLean: number;
    hipTwist: number;
    torsoTwist: number;
    slamTwistThrough: number;
    approachSpeed: number;
    approachDist: number;
  };
  pass: {
    pullLean: number;
    pullShoulderX: number;
    pullShoulderZ: number;
    pullElbow: number;
    throwShoulderExt: number;
    throwElbowExt: number;
    throwLean: number;
    stepFwd: number;
    stepKnee: number;
    ftLean: number;
    ftHip: number;
  };
}

/**
 * Poses: per-animation endpoint bone transforms. For multi-phase animations
 * (jump, shoot, dunk, fall, steal, pass, jumpBlock), phases nest within.
 * Field names follow `<bone><Property>` (e.g. `kneeLRotX`) or `<phase>.<bone><Property>`.
 * Squash/stretch scale offsets are represented as a single factor (e.g. `bounceSquashAmount`).
 */
export interface AnimPoses {
  idle: PoseIdle;
  walk: PoseWalk;
  walkBackward: PoseWalkBackward;
  dribble: PoseDribble;
  dribbleStationary: PoseDribbleStationary;
  sprint: PoseSprint;
  dribbleSprint: PoseDribbleSprint;
  guard: PoseGuard;
  steal: PoseSteal;
  shoot: PoseShoot;
  jump: PoseJump;
  jumpBlock: PoseJumpBlock;
  fall: PoseFall;
  dunk: PoseDunk;
  pass: PosePass;
}

export interface PoseIdle {
  bodyPivotRotX: number;
  hipLRotX: number;
  hipRRotX: number;
  kneeLRotX: number;
  kneeRRotX: number;
  shoulderLRotX: number;
  shoulderRRotX: number;
  elbowLRotX: number;
  elbowRRotX: number;
}

export interface PoseWalk {
  bodyPivotRotX: number;
  squashStretchAmount: number; // 0.03 default
  shoulderSwingFactor: number; // 0.5 — how strongly arms mirror legs
  elbowBaseBend: number; // -0.3
  elbowStrideBend: number; // 0.3 — extra bend when stride forward
  hipTwistFactor: number; // 0.15
  torsoTwistFactor: number; // 0.1
}

export interface PoseWalkBackward {
  bodyPivotRotX: number;
  shoulderLRotX: number;
  shoulderLRotZ: number;
  shoulderRRotX: number;
  shoulderRRotZ: number;
  elbowLRotX: number;
  elbowRRotX: number;
  kneeBase: number;
}

export interface PoseDribble {
  bodyPivotRotX: number;
  squashStretchAmount: number;
  kneeBase: number;
  leftArmShoulderX: number;
  leftArmShoulderZ: number;
  leftArmElbow: number;
  hipTwistFactor: number;
  torsoTwistFactor: number;
}

export interface PoseDribbleStationary {
  bodyPivotRotX: number;
  kneeBase: number;
  leftArmShoulderX: number;
  leftArmShoulderZ: number;
  leftArmElbow: number;
}

export interface PoseSprint {
  bodyPivotRotX: number;
  squashStretchAmount: number;
  kneeBase: number;
  elbowLRotX: number;
  elbowRRotX: number;
  hipTwistFactor: number;
  torsoTwistFactor: number;
}

export interface PoseDribbleSprint {
  bodyPivotRotX: number;
  squashStretchAmount: number;
  kneeBase: number;
  leftArmShoulderZ: number;
  leftArmElbow: number;
  hipTwistFactor: number;
  torsoTwistFactor: number;
}

export interface PoseGuard {
  bodyPivotRotX: number;
  hipLRotX: number;
  hipRRotX: number;
  kneeLRotX: number;
  kneeRRotX: number;
  shoulderLRotX: number;
  shoulderLRotZ: number;
  shoulderRRotX: number;
  shoulderRRotZ: number;
  elbowLRotX: number;
  elbowRRotX: number;
  stanceDropY: number;
}

export interface PoseSteal {
  windBodyPivotRotX: number;
  windShoulderRRotX: number;
  windShoulderRRotZ: number;
  windElbowRRotX: number;
  windBodyRotY: number;
  windSquashX: number;
  windSquashY: number;
  holdBodyPivotRotX: number;
  holdShoulderRRotX: number;
  holdShoulderRRotZ: number;
  holdElbowRRotX: number;
  holdBodyRotY: number;
  holdSquashX: number;
  holdSquashY: number;
  swipeBodyPivotRotX: number;
  swipeShoulderRXBase: number;
  swipeShoulderRXSwing: number;
  swipeShoulderRZBase: number;
  swipeShoulderRZSwing: number;
  swipeElbowRXBase: number;
  swipeElbowRXSwing: number;
  swipeBodyRotYBase: number;
  swipeBodyRotYSwing: number;
  shoulderLRotX: number;
  elbowLRotX: number;
  hipLRotX: number;
  hipRRotX: number;
  kneeLRotX: number;
  kneeRRotX: number;
  stanceDropY: number;
}

export interface PoseShoot {
  snapShoulderR: number;
  snapShoulderRZ: number;
  snapElbowR: number;
  snapShoulderL: number;
  snapShoulderLZ: number;
  snapElbowL: number;
  snapBodyPivotRotX: number;
  snapKneeBend: number;
  releaseShoulderR: number;
  releaseElbowR: number;
  releaseShoulderL: number;
  releaseShoulderLZ: number;
  releaseElbowL: number;
  releaseBodyPivotRotX: number;
  hangKnee: number;
  landHipR: number;
  landHipL: number;
  landKneeR: number;
  landKneeL: number;
  recoverHipR: number;
  recoverHipL: number;
  recoverKneeR: number;
  recoverKneeL: number;
  hipTwistSnap: number;
  torsoTwistSnap: number;
  hipTwistRelease: number;
  torsoTwistRelease: number;
}

export interface PoseJump {
  crouchBodyPivotRotX: number;
  crouchKnee: number;
  crouchHip: number;
  crouchShoulder: number;
  crouchElbow: number;
  launchShoulderR: number;
  launchElbowRDelta: number;
  launchShoulderL: number;
  launchShoulderLZ: number;
  launchElbowLDelta: number;
  hangBodyPivotRotX: number;
  hangKneeL: number;
  hangKneeR: number;
  hangHipL: number;
  hangHipR: number;
  hangShoulderR: number;
  hangElbowR: number;
  hangShoulderL: number;
  hangShoulderLZ: number;
  hangElbowL: number;
  descentBodyLeanDelta: number;
  descentShoulderRDelta: number;
  descentKneeDelta: number;
  landBodyPivotRotX: number;
  landKneeLBase: number;
  landKneeRBase: number;
  landHipL: number;
  landHipR: number;
  landShoulderR: number;
  landShoulderL: number;
  landElbowR: number;
  landElbowL: number;
  hipTwistLaunch: number;
  torsoTwistLaunch: number;
}

export interface PoseJumpBlock {
  crouchBodyPivotRotX: number;
  crouchKnee: number;
  crouchHip: number;
  crouchShoulder: number;
  crouchElbow: number;
  launchShoulder: number;
  launchShoulderSpread: number;
  launchElbowDelta: number;
  hangBodyPivotRotX: number;
  hangKneeL: number;
  hangKneeR: number;
  hangShoulderL: number;
  hangShoulderR: number;
  hangShoulderLZ: number;
  hangShoulderRZ: number;
  hangElbowL: number;
  hangElbowR: number;
  hipTwistLaunch: number;
  torsoTwistLaunch: number;
}

export interface PoseFall {
  staggerBodyPivotRotX: number;
  staggerBodyPivotRotZ: number;
  staggerShoulderLRotX: number;
  staggerShoulderLRotZ: number;
  staggerShoulderRRotX: number;
  staggerShoulderRRotZ: number;
  staggerElbowL: number;
  staggerElbowR: number;
  staggerKneeL: number;
  staggerKneeR: number;
  staggerHipL: number;
  staggerHipR: number;
  groundBodyPivotRotX: number;
  groundPosY: number;
  groundShoulderLRotX: number;
  groundShoulderLRotZ: number;
  groundShoulderRRotX: number;
  groundShoulderRRotZ: number;
  groundElbowL: number;
  groundElbowR: number;
  groundKneeL: number;
  groundKneeR: number;
  lyingBodyPivotRotX: number;
  lyingBodyPivotRotZ: number;
  lyingPosY: number;
  lyingShoulderL: number;
  lyingShoulderLZ: number;
  lyingShoulderR: number;
  lyingShoulderRZ: number;
  lyingElbowL: number;
  lyingElbowR: number;
  lyingKneeL: number;
  lyingKneeR: number;
}

export interface PoseDunk {
  riseBodyPivotRotX: number;
  riseKneeLStart: number;
  riseKneeLEnd: number;
  riseKneeRStart: number;
  riseKneeREnd: number;
  riseHipL: number;
  riseHipR: number;
  riseHipLZ: number;
  riseHipRZ: number;
  riseShoulderR: number;
  riseShoulderL: number;
  riseElbowR: number;
  riseElbowL: number;
  hangBodyPivotRotX: number;
  hangShoulderRBase: number;
  hangShoulderROffset: number;
  hangElbowR: number;
  hangShoulderL: number;
  hangShoulderLZ: number;
  hangElbowL: number;
  hangKneeL: number;
  hangKneeR: number;
  hangHipL: number;
  hangHipR: number;
  hangHipLZ: number;
  hangHipRZ: number;
  slamBodyPivotRotXBase: number;
  slamBodyPivotRotXSwing: number;
  slamShoulderRBase: number;
  slamShoulderRSwing: number;
  slamShoulderLBase: number;
  slamShoulderLSwing: number;
  slamElbowRBase: number;
  slamElbowRSwing: number;
  slamElbowLBase: number;
  slamElbowLSwing: number;
  slamKneeLBase: number;
  slamKneeLSwing: number;
  slamKneeRBase: number;
  slamKneeRSwing: number;
  slamHipLBase: number;
  slamHipLSwing: number;
  slamHipRBase: number;
  slamHipRSwing: number;
  rimHangShoulderR: number;
  rimHangElbowR: number;
  rimHangShoulderL: number;
  rimHangElbowL: number;
  rimHangKneeL: number;
  rimHangKneeR: number;
  rimHangHipL: number;
  rimHangHipR: number;
  rimHangSwayAmp: number;
  dropBodyPivotRotXFactor: number;
  dropShoulderRFrom: number;
  dropShoulderRDelta: number;
  dropShoulderLFrom: number;
  dropShoulderLDelta: number;
  dropElbowRFrom: number;
  dropElbowRDelta: number;
  dropElbowLFrom: number;
  dropElbowLDelta: number;
  dropKneeLFrom: number;
  dropKneeLDelta: number;
  dropKneeRFrom: number;
  dropKneeRDelta: number;
  landBodyPivotRotX: number;
  landHipR: number;
  landHipL: number;
  landKneeR: number;
  landKneeL: number;
  landShoulderR: number;
  landShoulderL: number;
  landElbowR: number;
  landElbowL: number;
}

export interface PosePass {
  pullShoulderR: number;
  pullShoulderL: number;
  pullShoulderRZ: number;
  pullShoulderLZ: number;
  pullElbowR: number;
  pullElbowL: number;
  pullBodyPivotRotX: number;
  throwShoulderR: number;
  throwShoulderL: number;
  throwShoulderRZ: number;
  throwShoulderLZ: number;
  throwElbowR: number;
  throwElbowL: number;
  throwBodyPivotRotX: number;
  throwHipR: number;
  throwKneeR: number;
  ftShoulderRBase: number;
  ftShoulderRSwing: number;
  ftShoulderLBase: number;
  ftShoulderLSwing: number;
  ftBodyPivotRotX: number;
  ftHipR: number;
  ftKneeR: number;
  hipL: number;
  kneeL: number;
}

// ============================================================================
// Defaults — these MUST mirror the hardcoded values in GamePlayer.animate()
// that existed before the config-driven refactor.
// ============================================================================

const DEFAULTS: AnimConfig = Object.freeze({
  __version: 1,
  durations: Object.freeze({
    idleBob: 1.5,
    walkStride: 3.85,
    walkBounce: 7.7,
    backwardStride: 2.3,
    backwardBounce: 4.6,
    sprintStride: 6.95,
    sprintBounce: 13.9,
    dribbleCycle: 2.5,
    dribbleSprintStride: 7,
    dribbleSprintBounce: 14,
    guardPulse: 6,
    indicatorBob: 3,
    possessionRingPulse: 4,
    stealDuration: 0.6,
    shootDuration: 0.4,
    jumpDuration: 0.6,
    jumpBlockDuration: 0.6,
    fallDuration: 0.8,
    dunkDuration: 1.2,
    passDuration: 0.35,
  }),
  amplitudes: Object.freeze({
    idle: Object.freeze({ swayHeight: 0.04, kneeBend: 0.05, elbowBend: 0.1 }),
    walk: Object.freeze({
      bounceHeight: 0.23,
      strideAmp: 0.48,
      kneeBase: 0.15,
      kneeSwing: 0.6,
      armSwingRatio: 0.4,
      elbowBend: 0.3,
      forwardLean: 0.12,
      hipTwist: 0.2,
      torsoTwist: 0.14,
    }),
    walkBackward: Object.freeze({
      bounceHeight: 0.12,
      strideAmp: 0.24,
      kneeBase: 0.15,
      kneeSwing: 0.3,
      shoulderX: 0.3,
      shoulderZ: 0.4,
    }),
    dribble: Object.freeze({
      bounceHeight: 0.12,
      strideAmp: 0.5,
      kneeBase: 0.2,
      kneeSwing: 0.5,
      bodyCrouch: 0.15,
      armUpElbow: 0.5,
      armDownElbow: 1.1,
      shoulderUpPump: 0.2,
      shoulderDownPump: 0.6,
      leftArmSpread: 0.8,
    }),
    dribbleStationary: Object.freeze({ bob: 0.03, bodyCrouch: 0.1 }),
    sprint: Object.freeze({
      bounceHeight: 0.3,
      strideAmp: 0.64,
      forwardLean: 0.2,
      kneeBase: 0.2,
      kneeDrive: 0.7,
      shoulderSwing: 0.6,
      elbowBend: 0.8,
      hipTwist: 0.25,
      torsoTwist: 0.18,
    }),
    dribbleSprint: Object.freeze({
      bounceHeight: 0.18,
      strideAmp: 0.7,
      bodyCrouch: 0.18,
      kneeBase: 0.2,
      kneeSwing: 0.6,
      leftArmOutward: 0.3,
    }),
    guard: Object.freeze({
      forwardLean: 0.15,
      hipSpread: 0.15,
      kneeBend: 0.4,
      shoulderRaise: 2.8,
      shoulderSpread: 0.4,
      stanceLower: 0.08,
      blockOpacityMin: 0.1,
      blockOpacitySwing: 0.08,
    }),
    steal: Object.freeze({
      windShoulder: 0.3,
      holdShoulderZ: 0.8,
      forearmGrowMax: 1.6,
      bodyTwist: 0.3,
      compressionX: 1.06,
      compressionY: 0.94,
      swipeStretchH: 0.1,
      swipeSquashV: 0.08,
      swipeTwist: 0.6,
      stanceLower: 0.05,
      crouchKnee: 0.35,
    }),
    shoot: Object.freeze({
      hopHeight: 0.6,
      snapElbow: 1.2,
      snapShoulderR: 1.8,
      snapShoulderL: 1.6,
      guideInward: 0.3,
      guideElbow: 0.8,
      crouchKnee: 0.3,
      releaseShoulder: 2.6,
      releaseElbow: 0.2,
      leftArmDrop: 0.6,
      rightFootFwd: 0.15,
      leftFootBack: 0.1,
      rightKneeAbsorb: 0.4,
      leftKneeAbsorb: 0.2,
      twistWind: 0.1,
      twistRelease: 0.16,
    }),
    jump: Object.freeze({
      apexHeight: 1.8,
      crouchLean: 0.25,
      crouchKnee: 0.8,
      crouchHip: 0.15,
      crouchShoulder: 0.3,
      crouchElbow: 0.4,
      launchShoulder: 3.0,
      launchLeftLateral: 0.3,
      hangKnee: 0.15,
      landKnee: 0.4,
      hangShoulderR: 2.7,
      hangLeftArm: 0.5,
      hangHip: 0.1,
      hipTwist: 0.15,
    }),
    jumpBlock: Object.freeze({
      apexHeight: 1.5,
      crouchKnee: 0.7,
      shoulderRaise: 2.9,
      shoulderSpread: 0.3,
      elbowBend: 0.1,
      hangKnee: 0.1,
    }),
    fall: Object.freeze({
      backLean: 0.3,
      sideTilt: 0.2,
      shoulderFlailLX: 0.5,
      shoulderFlailRX: 0.8,
      shoulderFlailLZ: 0.6,
      shoulderFlailRZ: 0.4,
      kneeBuckleL: 0.3,
      kneeBuckleR: 0.5,
      groundDrop: 0.3,
      flatBackLean: 1.3,
      groundArmExtend: 1.0,
      groundKneeL: 0.6,
      groundKneeR: 0.5,
    }),
    dunk: Object.freeze({
      apexHeight: 1.2,
      riseTime: 0.15,
      hangStart: 0.45,
      dropStart: 0.65,
      landStart: 0.85,
      riseCrouch: 0.1,
      mjKneeL: 0.7,
      mjKneeR: 0.8,
      mjHipL: 0.3,
      mjHipR: 0.4,
      mjHipZ: 0.2,
      armScalePeak: 0.3,
      armThickness: 1.1,
      rimHangArmScaleU: 1.2,
      rimHangArmScaleF: 1.3,
      rimHangKneeL: 0.3,
      rimHangKneeR: 0.4,
      slamLean: 0.4,
      hipTwist: 0.2,
      torsoTwist: 0.15,
      slamTwistThrough: 0.5,
      approachSpeed: 8,
      approachDist: 0.3,
    }),
    pass: Object.freeze({
      pullLean: 0.05,
      pullShoulderX: 0.5,
      pullShoulderZ: 0.15,
      pullElbow: 0.9,
      throwShoulderExt: 0.7,
      throwElbowExt: 0.8,
      throwLean: 0.12,
      stepFwd: 0.15,
      stepKnee: 0.1,
      ftLean: 0.17,
      ftHip: 0.15,
    }),
  }),
  poses: Object.freeze({
    idle: Object.freeze({
      bodyPivotRotX: 0,
      hipLRotX: 0,
      hipRRotX: 0,
      kneeLRotX: 0.05,
      kneeRRotX: 0.05,
      shoulderLRotX: 0,
      shoulderRRotX: 0,
      elbowLRotX: -0.1,
      elbowRRotX: -0.1,
    }),
    walk: Object.freeze({
      bodyPivotRotX: 0.12,
      squashStretchAmount: 0.05,
      shoulderSwingFactor: 0.4,
      elbowBaseBend: -0.3,
      elbowStrideBend: 0.3,
      hipTwistFactor: 0.2,
      torsoTwistFactor: 0.14,
    }),
    walkBackward: Object.freeze({
      bodyPivotRotX: 0,
      shoulderLRotX: -0.3,
      shoulderLRotZ: -0.4,
      shoulderRRotX: -0.3,
      shoulderRRotZ: 0.4,
      elbowLRotX: -0.3,
      elbowRRotX: -0.3,
      kneeBase: 0.15,
    }),
    dribble: Object.freeze({
      bodyPivotRotX: 0.15,
      squashStretchAmount: 0.03,
      kneeBase: 0.2,
      leftArmShoulderX: -0.1,
      leftArmShoulderZ: -0.8,
      leftArmElbow: -0.3,
      hipTwistFactor: 0.15,
      torsoTwistFactor: 0.1,
    }),
    dribbleStationary: Object.freeze({
      bodyPivotRotX: 0.1,
      kneeBase: 0.15,
      leftArmShoulderX: -0.1,
      leftArmShoulderZ: -0.8,
      leftArmElbow: -0.3,
    }),
    sprint: Object.freeze({
      bodyPivotRotX: 0.2,
      squashStretchAmount: 0.03,
      kneeBase: 0.2,
      elbowLRotX: -0.8,
      elbowRRotX: -0.8,
      hipTwistFactor: 0.2,
      torsoTwistFactor: 0.15,
    }),
    dribbleSprint: Object.freeze({
      bodyPivotRotX: 0.18,
      squashStretchAmount: 0.03,
      kneeBase: 0.2,
      leftArmShoulderZ: -0.3,
      leftArmElbow: -0.6,
      hipTwistFactor: 0.2,
      torsoTwistFactor: 0.15,
    }),
    guard: Object.freeze({
      bodyPivotRotX: 0.15,
      hipLRotX: 0.15,
      hipRRotX: -0.15,
      kneeLRotX: 0.4,
      kneeRRotX: 0.4,
      shoulderLRotX: -2.8,
      shoulderLRotZ: -0.4,
      shoulderRRotX: -2.8,
      shoulderRRotZ: 0.4,
      elbowLRotX: -0.1,
      elbowRRotX: -0.1,
      stanceDropY: -0.08,
    }),
    steal: Object.freeze({
      windBodyPivotRotX: 0.15,
      windShoulderRRotX: -0.3,
      windShoulderRRotZ: 0.8,
      windElbowRRotX: -0.3,
      windBodyRotY: 0.3,
      windSquashX: 1.05,
      windSquashY: 0.95,
      holdBodyPivotRotX: 0.2,
      holdShoulderRRotX: -0.3,
      holdShoulderRRotZ: 0.8,
      holdElbowRRotX: -0.3,
      holdBodyRotY: 0.3,
      holdSquashX: 1.06,
      holdSquashY: 0.94,
      swipeBodyPivotRotX: 0.25,
      swipeShoulderRXBase: -0.3,
      swipeShoulderRXSwing: -0.3,
      swipeShoulderRZBase: 0.8,
      swipeShoulderRZSwing: -1.6,
      swipeElbowRXBase: -0.3,
      swipeElbowRXSwing: 0.1,
      swipeBodyRotYBase: 0.3,
      swipeBodyRotYSwing: -0.6,
      shoulderLRotX: 0,
      elbowLRotX: -0.1,
      hipLRotX: -0.05,
      hipRRotX: 0.05,
      kneeLRotX: 0.35,
      kneeRRotX: 0.35,
      stanceDropY: -0.05,
    }),
    shoot: Object.freeze({
      snapShoulderR: -1.8,
      snapShoulderRZ: 0.1,
      snapElbowR: -1.2,
      snapShoulderL: -1.6,
      snapShoulderLZ: -0.3,
      snapElbowL: -0.8,
      snapBodyPivotRotX: 0.05,
      snapKneeBend: 0.3,
      releaseShoulderR: -2.6,
      releaseElbowR: -0.2,
      releaseShoulderL: -0.6,
      releaseShoulderLZ: -0.6,
      releaseElbowL: -0.3,
      releaseBodyPivotRotX: -0.1,
      hangKnee: 0.05,
      landHipR: -0.15,
      landHipL: 0.1,
      landKneeR: 0.4,
      landKneeL: 0.2,
      recoverHipR: -0.12,
      recoverHipL: 0.08,
      recoverKneeR: 0.3,
      recoverKneeL: 0.15,
      hipTwistSnap: 0.1,
      torsoTwistSnap: -0.08,
      hipTwistRelease: -0.2,
      torsoTwistRelease: 0.16,
    }),
    jump: Object.freeze({
      crouchBodyPivotRotX: 0.25,
      crouchKnee: 0.8,
      crouchHip: 0.15,
      crouchShoulder: 0.3,
      crouchElbow: -0.4,
      launchShoulderR: 3.0,
      launchElbowRDelta: 0.3,
      launchShoulderL: 0.8,
      launchShoulderLZ: -0.3,
      launchElbowLDelta: 0.2,
      hangBodyPivotRotX: -0.1,
      hangKneeL: 0.15,
      hangKneeR: 0.2,
      hangHipL: -0.1,
      hangHipR: 0.1,
      hangShoulderR: -2.7,
      hangElbowR: -0.1,
      hangShoulderL: -0.5,
      hangShoulderLZ: -0.3,
      hangElbowL: -0.2,
      descentBodyLeanDelta: 0.15,
      descentShoulderRDelta: 1.5,
      descentKneeDelta: 0.2,
      landBodyPivotRotX: 0.05,
      landKneeLBase: 0.35,
      landKneeRBase: 0.4,
      landHipL: 0.05,
      landHipR: 0.05,
      landShoulderR: -1.2,
      landShoulderL: -0.2,
      landElbowR: -0.3,
      landElbowL: -0.2,
      hipTwistLaunch: 0.15,
      torsoTwistLaunch: -0.1,
    }),
    jumpBlock: Object.freeze({
      crouchBodyPivotRotX: 0.2,
      crouchKnee: 0.7,
      crouchHip: 0.1,
      crouchShoulder: 0.2,
      crouchElbow: -0.3,
      launchShoulder: 2.9,
      launchShoulderSpread: 0.3,
      launchElbowDelta: 0.2,
      hangBodyPivotRotX: -0.05,
      hangKneeL: 0.1,
      hangKneeR: 0.1,
      hangShoulderL: -2.7,
      hangShoulderR: -2.7,
      hangShoulderLZ: -0.4,
      hangShoulderRZ: 0.4,
      hangElbowL: -0.1,
      hangElbowR: -0.1,
      hipTwistLaunch: 0.15,
      torsoTwistLaunch: -0.1,
    }),
    fall: Object.freeze({
      staggerBodyPivotRotX: -0.3,
      staggerBodyPivotRotZ: 0.2,
      staggerShoulderLRotX: -0.5,
      staggerShoulderLRotZ: -0.6,
      staggerShoulderRRotX: -0.8,
      staggerShoulderRRotZ: 0.4,
      staggerElbowL: -0.3,
      staggerElbowR: -0.5,
      staggerKneeL: 0.3,
      staggerKneeR: 0.5,
      staggerHipL: 0.1,
      staggerHipR: -0.1,
      groundBodyPivotRotX: -1.0,
      groundPosY: -0.3,
      groundShoulderLRotX: -0.5,
      groundShoulderLRotZ: -0.4,
      groundShoulderRRotX: -0.8,
      groundShoulderRRotZ: 0.3,
      groundElbowL: -0.3,
      groundElbowR: -0.5,
      groundKneeL: 0.3,
      groundKneeR: 0.5,
      lyingBodyPivotRotX: -1.3,
      lyingBodyPivotRotZ: 0.2,
      lyingPosY: -0.3,
      lyingShoulderL: -1.0,
      lyingShoulderLZ: -1.0,
      lyingShoulderR: -0.8,
      lyingShoulderRZ: 0.7,
      lyingElbowL: -0.3,
      lyingElbowR: -0.5,
      lyingKneeL: 0.6,
      lyingKneeR: 0.5,
    }),
    dunk: Object.freeze({
      riseBodyPivotRotX: 0.1,
      riseKneeLStart: 0.4,
      riseKneeLEnd: 0.7,
      riseKneeRStart: 0.4,
      riseKneeREnd: 0.8,
      riseHipL: -0.3,
      riseHipR: 0.4,
      riseHipLZ: -0.2,
      riseHipRZ: 0.2,
      riseShoulderR: -2.6,
      riseShoulderL: -2.6,
      riseElbowR: -0.4,
      riseElbowL: -0.4,
      hangBodyPivotRotX: -0.1,
      hangShoulderRBase: -2.6,
      hangShoulderROffset: -0.3,
      hangElbowR: -0.05,
      hangShoulderL: -0.8,
      hangShoulderLZ: -0.3,
      hangElbowL: -0.2,
      hangKneeL: 0.7,
      hangKneeR: 0.8,
      hangHipL: -0.3,
      hangHipR: 0.4,
      hangHipLZ: -0.2,
      hangHipRZ: 0.2,
      slamBodyPivotRotXBase: -0.1,
      slamBodyPivotRotXSwing: 0.4,
      slamShoulderRBase: -2.6,
      slamShoulderRSwing: 2.0,
      slamShoulderLBase: -2.6,
      slamShoulderLSwing: 2.0,
      slamElbowRBase: -0.1,
      slamElbowRSwing: -0.3,
      slamElbowLBase: -0.1,
      slamElbowLSwing: -0.3,
      slamKneeLBase: 0.7,
      slamKneeLSwing: -0.5,
      slamKneeRBase: 0.8,
      slamKneeRSwing: -0.6,
      slamHipLBase: -0.3,
      slamHipLSwing: 0.3,
      slamHipRBase: 0.4,
      slamHipRSwing: -0.4,
      rimHangShoulderR: -2.8,
      rimHangElbowR: -0.2,
      rimHangShoulderL: -0.3,
      rimHangElbowL: -0.2,
      rimHangKneeL: 0.3,
      rimHangKneeR: 0.4,
      rimHangHipL: 0.05,
      rimHangHipR: 0.05,
      rimHangSwayAmp: 0.05,
      dropBodyPivotRotXFactor: 0.1,
      dropShoulderRFrom: -2.8,
      dropShoulderRDelta: 2.2,
      dropShoulderLFrom: -0.3,
      dropShoulderLDelta: 0.2,
      dropElbowRFrom: -0.6,
      dropElbowRDelta: 0.5,
      dropElbowLFrom: -0.2,
      dropElbowLDelta: 0.1,
      dropKneeLFrom: 0.3,
      dropKneeLDelta: 0.3,
      dropKneeRFrom: 0.4,
      dropKneeRDelta: 0.2,
      landBodyPivotRotX: 0.2,
      landHipR: -0.15,
      landHipL: 0.1,
      landKneeR: 0.6,
      landKneeL: 0.4,
      landShoulderR: -0.1,
      landShoulderL: -0.1,
      landElbowR: -0.1,
      landElbowL: -0.1,
    }),
    pass: Object.freeze({
      pullShoulderR: -0.5,
      pullShoulderL: -0.5,
      pullShoulderRZ: -0.15,
      pullShoulderLZ: 0.15,
      pullElbowR: -0.9,
      pullElbowL: -0.9,
      pullBodyPivotRotX: 0.05,
      throwShoulderR: -0.7,
      throwShoulderL: -0.7,
      throwShoulderRZ: 0.15,
      throwShoulderLZ: -0.15,
      throwElbowR: 0.8,
      throwElbowL: 0.8,
      throwBodyPivotRotX: 0.12,
      throwHipR: -0.15,
      throwKneeR: 0.1,
      ftShoulderRBase: -1.2,
      ftShoulderRSwing: 1.1,
      ftShoulderLBase: -1.2,
      ftShoulderLSwing: 1.1,
      ftBodyPivotRotX: 0.17,
      ftHipR: -0.15,
      ftKneeR: 0.1,
      hipL: 0,
      kneeL: 0.05,
    }),
  }),
}) as AnimConfig;

function cloneDefaults(): AnimConfig {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

export const animConfig: AnimConfig = cloneDefaults();

export function getDefaults(): AnimConfig {
  return cloneDefaults();
}

export function serializeAnim(): string {
  return JSON.stringify(animConfig, null, 2);
}

export function applyAnimJSON(json: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Expected an object');
  mergeInto(animConfig as unknown as Record<string, unknown>, parsed as Record<string, unknown>);
}

export function resetAnim(): void {
  const fresh = cloneDefaults();
  mergeInto(animConfig as unknown as Record<string, unknown>, fresh as unknown as Record<string, unknown>);
}

function mergeInto(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(target)) {
    if (!(key in source)) continue;
    const tv = target[key];
    const sv = source[key];
    if (typeof tv === 'number') {
      if (typeof sv === 'number' && Number.isFinite(sv)) target[key] = sv;
    } else if (tv && typeof tv === 'object' && sv && typeof sv === 'object') {
      mergeInto(tv as Record<string, unknown>, sv as Record<string, unknown>);
    }
  }
}
