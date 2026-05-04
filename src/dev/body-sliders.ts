/**
 * Shared body-sliders helpers. Used by anim-viewer to build the PLAYER BODY
 * tuning panel with the exact same section/range grouping as player-editor
 * and the dev-overlay PLAYER subsection.
 *
 * Not used by dev-overlay.ts itself (which has its own inline copy that is
 * tightly coupled to its private buildSlider / buildColorRow methods); this
 * module exists so the anim-viewer page doesn't re-derive ranges from
 * playerConfig. Ranges live in player-editor and MUST match.
 */
import { playerConfig, getDefaults } from './player-config';

export interface BodyNumericSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  get: () => number;
  set: (v: number) => void;
  defaultValue: number;
}

export interface BodyColorSpec {
  label: string;
  get: () => number;
  set: (v: number) => void;
  defaultValue: number;
}

export interface BodySectionSpec {
  title: string;
  numerics?: BodyNumericSpec[];
  colors?: BodyColorSpec[];
}

export function numToHex(n: number): string {
  return '#' + (n >>> 0).toString(16).padStart(6, '0');
}

export function hexToNum(s: string): number {
  return parseInt(s.replace('#', ''), 16);
}

/**
 * Build the canonical 5-section / 38-field body spec list. Mirrors the order
 * and ranges used by `player-editor.ts` — ranges live there, don't re-derive
 * or widen them.
 */
export function buildBodySections(): BodySectionSpec[] {
  const d = getDefaults();
  return [
    {
      title: 'HEAD',
      numerics: [
        { label: 'Head Radius', min: 0.18, max: 0.45, step: 0.01,
          get: () => playerConfig.head.radius, set: (v) => { playerConfig.head.radius = v; }, defaultValue: d.head.radius },
        { label: 'Head Y', min: 0.15, max: 0.55, step: 0.005,
          get: () => playerConfig.head.positionY, set: (v) => { playerConfig.head.positionY = v; }, defaultValue: d.head.positionY },
        { label: 'Eye Radius', min: 0.01, max: 0.1, step: 0.005,
          get: () => playerConfig.head.eyeRadius, set: (v) => { playerConfig.head.eyeRadius = v; }, defaultValue: d.head.eyeRadius },
        { label: 'Eye Spacing (X)', min: 0.02, max: 0.2, step: 0.005,
          get: () => playerConfig.head.eyeOffsetX, set: (v) => { playerConfig.head.eyeOffsetX = v; }, defaultValue: d.head.eyeOffsetX },
        { label: 'Eye Height (Y)', min: 0.15, max: 0.55, step: 0.005,
          get: () => playerConfig.head.eyeOffsetY, set: (v) => { playerConfig.head.eyeOffsetY = v; }, defaultValue: d.head.eyeOffsetY },
        { label: 'Eye Forward (Z)', min: 0.08, max: 0.35, step: 0.005,
          get: () => playerConfig.head.eyeOffsetZ, set: (v) => { playerConfig.head.eyeOffsetZ = v; }, defaultValue: d.head.eyeOffsetZ },
        { label: 'Face Plane Size', min: 0.2, max: 0.9, step: 0.01,
          get: () => playerConfig.head.facePlaneSize, set: (v) => { playerConfig.head.facePlaneSize = v; }, defaultValue: d.head.facePlaneSize },
        { label: 'Face Plane Z', min: 0.1, max: 0.4, step: 0.005,
          get: () => playerConfig.head.facePlaneZ, set: (v) => { playerConfig.head.facePlaneZ = v; }, defaultValue: d.head.facePlaneZ },
        { label: 'Head Depth Scale', min: 0.5, max: 1.0, step: 0.01,
          get: () => playerConfig.head.headDepthScale, set: (v) => { playerConfig.head.headDepthScale = v; }, defaultValue: d.head.headDepthScale },
      ],
    },
    {
      title: 'BODY',
      numerics: [
        { label: 'Torso Width', min: 0.18, max: 0.45, step: 0.01, get: () => playerConfig.body.torsoWidth, set: (v) => { playerConfig.body.torsoWidth = v; }, defaultValue: d.body.torsoWidth },
        { label: 'Torso Height', min: 0.25, max: 0.6, step: 0.01, get: () => playerConfig.body.torsoHeight, set: (v) => { playerConfig.body.torsoHeight = v; }, defaultValue: d.body.torsoHeight },
        { label: 'Torso Depth', min: 0.08, max: 0.3, step: 0.01, get: () => playerConfig.body.torsoDepth, set: (v) => { playerConfig.body.torsoDepth = v; }, defaultValue: d.body.torsoDepth },
        { label: 'Shoulder Bar Width', min: 0.3, max: 0.6, step: 0.01, get: () => playerConfig.body.shoulderBarWidth, set: (v) => { playerConfig.body.shoulderBarWidth = v; }, defaultValue: d.body.shoulderBarWidth },
        { label: 'Shoulder Bar Height', min: 0.02, max: 0.15, step: 0.01, get: () => playerConfig.body.shoulderBarHeight, set: (v) => { playerConfig.body.shoulderBarHeight = v; }, defaultValue: d.body.shoulderBarHeight },
        { label: 'Shoulder Bar Depth', min: 0.05, max: 0.25, step: 0.01, get: () => playerConfig.body.shoulderBarDepth, set: (v) => { playerConfig.body.shoulderBarDepth = v; }, defaultValue: d.body.shoulderBarDepth },
        { label: 'Shoulder Bar Y', min: 0.2, max: 0.55, step: 0.005, get: () => playerConfig.body.shoulderBarY, set: (v) => { playerConfig.body.shoulderBarY = v; }, defaultValue: d.body.shoulderBarY },
        { label: 'Shoulder Cap Radius', min: 0.04, max: 0.16, step: 0.01, get: () => playerConfig.body.shoulderCapRadius, set: (v) => { playerConfig.body.shoulderCapRadius = v; }, defaultValue: d.body.shoulderCapRadius },
        { label: 'Shoulder Cap Y', min: 0.2, max: 0.55, step: 0.005, get: () => playerConfig.body.shoulderCapY, set: (v) => { playerConfig.body.shoulderCapY = v; }, defaultValue: d.body.shoulderCapY },
        { label: 'Hip Width', min: 0.18, max: 0.4, step: 0.01, get: () => playerConfig.body.hipWidth, set: (v) => { playerConfig.body.hipWidth = v; }, defaultValue: d.body.hipWidth },
        { label: 'Hip Height', min: 0.05, max: 0.2, step: 0.01, get: () => playerConfig.body.hipHeight, set: (v) => { playerConfig.body.hipHeight = v; }, defaultValue: d.body.hipHeight },
        { label: 'Hip Depth', min: 0.08, max: 0.25, step: 0.01, get: () => playerConfig.body.hipDepth, set: (v) => { playerConfig.body.hipDepth = v; }, defaultValue: d.body.hipDepth },
        { label: 'Hip Mesh Y', min: -0.2, max: 0.1, step: 0.005, get: () => playerConfig.body.hipMeshY, set: (v) => { playerConfig.body.hipMeshY = v; }, defaultValue: d.body.hipMeshY },
        { label: 'Belly Radius', min: 0, max: 0.3, step: 0.005, get: () => playerConfig.body.bellyRadius, set: (v) => { playerConfig.body.bellyRadius = v; }, defaultValue: d.body.bellyRadius },
        { label: 'Belly Scale Y', min: 0.4, max: 1.4, step: 0.01, get: () => playerConfig.body.bellyScaleY, set: (v) => { playerConfig.body.bellyScaleY = v; }, defaultValue: d.body.bellyScaleY },
        { label: 'Belly Scale Z', min: 0.5, max: 2.5, step: 0.05, get: () => playerConfig.body.bellyScaleZ, set: (v) => { playerConfig.body.bellyScaleZ = v; }, defaultValue: d.body.bellyScaleZ },
        { label: 'Belly Y', min: -0.2, max: 0.3, step: 0.005, get: () => playerConfig.body.bellyY, set: (v) => { playerConfig.body.bellyY = v; }, defaultValue: d.body.bellyY },
        { label: 'Belly Z', min: 0, max: 0.25, step: 0.005, get: () => playerConfig.body.bellyZ, set: (v) => { playerConfig.body.bellyZ = v; }, defaultValue: d.body.bellyZ },
        // G2: lower belly lobe
        { label: 'Belly Lower Radius', min: 0, max: 0.3, step: 0.005, get: () => playerConfig.body.bellyLowerRadius, set: (v) => { playerConfig.body.bellyLowerRadius = v; }, defaultValue: d.body.bellyLowerRadius },
        { label: 'Belly Lower Scale X', min: 0.5, max: 2.0, step: 0.05, get: () => playerConfig.body.bellyLowerScaleX, set: (v) => { playerConfig.body.bellyLowerScaleX = v; }, defaultValue: d.body.bellyLowerScaleX },
        { label: 'Belly Lower Scale Y', min: 0.3, max: 1.4, step: 0.01, get: () => playerConfig.body.bellyLowerScaleY, set: (v) => { playerConfig.body.bellyLowerScaleY = v; }, defaultValue: d.body.bellyLowerScaleY },
        { label: 'Belly Lower Scale Z', min: 0.5, max: 2.5, step: 0.05, get: () => playerConfig.body.bellyLowerScaleZ, set: (v) => { playerConfig.body.bellyLowerScaleZ = v; }, defaultValue: d.body.bellyLowerScaleZ },
        { label: 'Belly Lower Y', min: -0.3, max: 0.2, step: 0.005, get: () => playerConfig.body.bellyLowerY, set: (v) => { playerConfig.body.bellyLowerY = v; }, defaultValue: d.body.bellyLowerY },
        { label: 'Belly Lower Z', min: -0.1, max: 0.25, step: 0.005, get: () => playerConfig.body.bellyLowerZ, set: (v) => { playerConfig.body.bellyLowerZ = v; }, defaultValue: d.body.bellyLowerZ },
        // G2: pecs
        { label: 'Pec Radius', min: 0, max: 0.15, step: 0.005, get: () => playerConfig.body.pecRadius, set: (v) => { playerConfig.body.pecRadius = v; }, defaultValue: d.body.pecRadius },
        { label: 'Pec Offset X', min: 0.04, max: 0.2, step: 0.005, get: () => playerConfig.body.pecOffsetX, set: (v) => { playerConfig.body.pecOffsetX = v; }, defaultValue: d.body.pecOffsetX },
        { label: 'Pec Y', min: 0.1, max: 0.5, step: 0.005, get: () => playerConfig.body.pecY, set: (v) => { playerConfig.body.pecY = v; }, defaultValue: d.body.pecY },
        { label: 'Pec Z', min: 0, max: 0.2, step: 0.005, get: () => playerConfig.body.pecZ, set: (v) => { playerConfig.body.pecZ = v; }, defaultValue: d.body.pecZ },
        { label: 'Pec Scale Y', min: 0.2, max: 1.5, step: 0.01, get: () => playerConfig.body.pecScaleY, set: (v) => { playerConfig.body.pecScaleY = v; }, defaultValue: d.body.pecScaleY },
        { label: 'Pec Scale Z', min: 0.5, max: 2.5, step: 0.05, get: () => playerConfig.body.pecScaleZ, set: (v) => { playerConfig.body.pecScaleZ = v; }, defaultValue: d.body.pecScaleZ },
        // G2: sloped shoulders
        { label: 'Shoulder Slope Radius', min: 0.04, max: 0.18, step: 0.005, get: () => playerConfig.body.shoulderSlopeRadius, set: (v) => { playerConfig.body.shoulderSlopeRadius = v; }, defaultValue: d.body.shoulderSlopeRadius },
        { label: 'Shoulder Slope Offset X', min: 0.02, max: 0.2, step: 0.005, get: () => playerConfig.body.shoulderSlopeOffsetX, set: (v) => { playerConfig.body.shoulderSlopeOffsetX = v; }, defaultValue: d.body.shoulderSlopeOffsetX },
        { label: 'Shoulder Slope Y', min: 0.2, max: 0.55, step: 0.005, get: () => playerConfig.body.shoulderSlopeY, set: (v) => { playerConfig.body.shoulderSlopeY = v; }, defaultValue: d.body.shoulderSlopeY },
        { label: 'Shoulder Slope Scale X', min: 0.5, max: 2.5, step: 0.05, get: () => playerConfig.body.shoulderSlopeScaleX, set: (v) => { playerConfig.body.shoulderSlopeScaleX = v; }, defaultValue: d.body.shoulderSlopeScaleX },
        { label: 'Shoulder Slope Scale Y', min: 0.2, max: 1.5, step: 0.01, get: () => playerConfig.body.shoulderSlopeScaleY, set: (v) => { playerConfig.body.shoulderSlopeScaleY = v; }, defaultValue: d.body.shoulderSlopeScaleY },
        { label: 'Shoulder Slope Scale Z', min: 0.3, max: 1.6, step: 0.05, get: () => playerConfig.body.shoulderSlopeScaleZ, set: (v) => { playerConfig.body.shoulderSlopeScaleZ = v; }, defaultValue: d.body.shoulderSlopeScaleZ },
        // G2: love handles
        { label: 'Love Handle Radius', min: 0, max: 0.16, step: 0.005, get: () => playerConfig.body.loveHandleRadius, set: (v) => { playerConfig.body.loveHandleRadius = v; }, defaultValue: d.body.loveHandleRadius },
        { label: 'Love Handle Offset X', min: 0.08, max: 0.3, step: 0.005, get: () => playerConfig.body.loveHandleOffsetX, set: (v) => { playerConfig.body.loveHandleOffsetX = v; }, defaultValue: d.body.loveHandleOffsetX },
        { label: 'Love Handle Y', min: -0.2, max: 0.2, step: 0.005, get: () => playerConfig.body.loveHandleY, set: (v) => { playerConfig.body.loveHandleY = v; }, defaultValue: d.body.loveHandleY },
        { label: 'Love Handle Scale X', min: 0.4, max: 1.6, step: 0.05, get: () => playerConfig.body.loveHandleScaleX, set: (v) => { playerConfig.body.loveHandleScaleX = v; }, defaultValue: d.body.loveHandleScaleX },
        { label: 'Love Handle Scale Y', min: 0.3, max: 1.4, step: 0.01, get: () => playerConfig.body.loveHandleScaleY, set: (v) => { playerConfig.body.loveHandleScaleY = v; }, defaultValue: d.body.loveHandleScaleY },
        { label: 'Love Handle Scale Z', min: 0.4, max: 1.8, step: 0.05, get: () => playerConfig.body.loveHandleScaleZ, set: (v) => { playerConfig.body.loveHandleScaleZ = v; }, defaultValue: d.body.loveHandleScaleZ },
        // G2: big ass
        { label: 'Butt Radius', min: 0, max: 0.3, step: 0.005, get: () => playerConfig.body.buttRadius, set: (v) => { playerConfig.body.buttRadius = v; }, defaultValue: d.body.buttRadius },
        { label: 'Butt Y', min: -0.2, max: 0.1, step: 0.005, get: () => playerConfig.body.buttY, set: (v) => { playerConfig.body.buttY = v; }, defaultValue: d.body.buttY },
        { label: 'Butt Z', min: -0.25, max: 0, step: 0.005, get: () => playerConfig.body.buttZ, set: (v) => { playerConfig.body.buttZ = v; }, defaultValue: d.body.buttZ },
        { label: 'Butt Scale X', min: 0.5, max: 2.0, step: 0.05, get: () => playerConfig.body.buttScaleX, set: (v) => { playerConfig.body.buttScaleX = v; }, defaultValue: d.body.buttScaleX },
        { label: 'Butt Scale Y', min: 0.3, max: 1.4, step: 0.01, get: () => playerConfig.body.buttScaleY, set: (v) => { playerConfig.body.buttScaleY = v; }, defaultValue: d.body.buttScaleY },
        { label: 'Butt Scale Z', min: 0.5, max: 2.0, step: 0.05, get: () => playerConfig.body.buttScaleZ, set: (v) => { playerConfig.body.buttScaleZ = v; }, defaultValue: d.body.buttScaleZ },
      ],
    },
    {
      title: 'LIMBS',
      numerics: [
        { label: 'Upper Arm: Top R', min: 0.02, max: 0.06, step: 0.005, get: () => playerConfig.limbs.upperArmRadiusTop, set: (v) => { playerConfig.limbs.upperArmRadiusTop = v; }, defaultValue: d.limbs.upperArmRadiusTop },
        { label: 'Upper Arm: Bot R', min: 0.02, max: 0.06, step: 0.005, get: () => playerConfig.limbs.upperArmRadiusBottom, set: (v) => { playerConfig.limbs.upperArmRadiusBottom = v; }, defaultValue: d.limbs.upperArmRadiusBottom },
        { label: 'Upper Arm: Length', min: 0.18, max: 0.42, step: 0.01, get: () => playerConfig.limbs.upperArmLength, set: (v) => { playerConfig.limbs.upperArmLength = v; }, defaultValue: d.limbs.upperArmLength },
        { label: 'Forearm: Top R', min: 0.015, max: 0.05, step: 0.005, get: () => playerConfig.limbs.forearmRadiusTop, set: (v) => { playerConfig.limbs.forearmRadiusTop = v; }, defaultValue: d.limbs.forearmRadiusTop },
        { label: 'Forearm: Bot R', min: 0.015, max: 0.05, step: 0.005, get: () => playerConfig.limbs.forearmRadiusBottom, set: (v) => { playerConfig.limbs.forearmRadiusBottom = v; }, defaultValue: d.limbs.forearmRadiusBottom },
        { label: 'Forearm: Length', min: 0.14, max: 0.36, step: 0.01, get: () => playerConfig.limbs.forearmLength, set: (v) => { playerConfig.limbs.forearmLength = v; }, defaultValue: d.limbs.forearmLength },
        { label: 'Upper Leg: Top R', min: 0.04, max: 0.1, step: 0.005, get: () => playerConfig.limbs.upperLegRadiusTop, set: (v) => { playerConfig.limbs.upperLegRadiusTop = v; }, defaultValue: d.limbs.upperLegRadiusTop },
        { label: 'Upper Leg: Bot R', min: 0.03, max: 0.09, step: 0.005, get: () => playerConfig.limbs.upperLegRadiusBottom, set: (v) => { playerConfig.limbs.upperLegRadiusBottom = v; }, defaultValue: d.limbs.upperLegRadiusBottom },
        { label: 'Upper Leg: Length', min: 0.22, max: 0.5, step: 0.01, get: () => playerConfig.limbs.upperLegLength, set: (v) => { playerConfig.limbs.upperLegLength = v; }, defaultValue: d.limbs.upperLegLength },
        { label: 'Lower Leg: Top R', min: 0.03, max: 0.09, step: 0.005, get: () => playerConfig.limbs.lowerLegRadiusTop, set: (v) => { playerConfig.limbs.lowerLegRadiusTop = v; }, defaultValue: d.limbs.lowerLegRadiusTop },
        { label: 'Lower Leg: Bot R', min: 0.04, max: 0.1, step: 0.005, get: () => playerConfig.limbs.lowerLegRadiusBottom, set: (v) => { playerConfig.limbs.lowerLegRadiusBottom = v; }, defaultValue: d.limbs.lowerLegRadiusBottom },
        { label: 'Lower Leg: Length', min: 0.22, max: 0.5, step: 0.01, get: () => playerConfig.limbs.lowerLegLength, set: (v) => { playerConfig.limbs.lowerLegLength = v; }, defaultValue: d.limbs.lowerLegLength },
      ],
    },
    {
      title: 'SHOES',
      numerics: [
        { label: 'Width', min: 0.08, max: 0.22, step: 0.01, get: () => playerConfig.shoes.width, set: (v) => { playerConfig.shoes.width = v; }, defaultValue: d.shoes.width },
        { label: 'Height', min: 0.04, max: 0.16, step: 0.01, get: () => playerConfig.shoes.height, set: (v) => { playerConfig.shoes.height = v; }, defaultValue: d.shoes.height },
        { label: 'Depth', min: 0.12, max: 0.3, step: 0.01, get: () => playerConfig.shoes.depth, set: (v) => { playerConfig.shoes.depth = v; }, defaultValue: d.shoes.depth },
        { label: 'Offset Y', min: -0.2, max: 0.05, step: 0.005, get: () => playerConfig.shoes.offsetY, set: (v) => { playerConfig.shoes.offsetY = v; }, defaultValue: d.shoes.offsetY },
        { label: 'Offset Z', min: -0.1, max: 0.15, step: 0.005, get: () => playerConfig.shoes.offsetZ, set: (v) => { playerConfig.shoes.offsetZ = v; }, defaultValue: d.shoes.offsetZ },
      ],
      colors: [
        { label: 'Color', get: () => playerConfig.shoes.color, set: (v) => { playerConfig.shoes.color = v; }, defaultValue: d.shoes.color },
      ],
    },
    {
      title: 'HAIR',
      numerics: [
        { label: 'Flat-Top: Width', min: 0.2, max: 0.5, step: 0.01, get: () => playerConfig.hair.flatTopWidth, set: (v) => { playerConfig.hair.flatTopWidth = v; }, defaultValue: d.hair.flatTopWidth },
        { label: 'Flat-Top: Height', min: 0.04, max: 0.25, step: 0.01, get: () => playerConfig.hair.flatTopHeight, set: (v) => { playerConfig.hair.flatTopHeight = v; }, defaultValue: d.hair.flatTopHeight },
        { label: 'Flat-Top: Depth', min: 0.18, max: 0.4, step: 0.01, get: () => playerConfig.hair.flatTopDepth, set: (v) => { playerConfig.hair.flatTopDepth = v; }, defaultValue: d.hair.flatTopDepth },
        { label: 'Flat-Top: Y', min: 0.35, max: 0.85, step: 0.005, get: () => playerConfig.hair.flatTopY, set: (v) => { playerConfig.hair.flatTopY = v; }, defaultValue: d.hair.flatTopY },
        { label: 'Flat-Top: Z', min: -0.2, max: 0.15, step: 0.005, get: () => playerConfig.hair.flatTopZ, set: (v) => { playerConfig.hair.flatTopZ = v; }, defaultValue: d.hair.flatTopZ },
        { label: 'Afro Radius', min: 0.2, max: 0.5, step: 0.01, get: () => playerConfig.hair.afroRadius, set: (v) => { playerConfig.hair.afroRadius = v; }, defaultValue: d.hair.afroRadius },
        { label: 'Afro Y', min: 0.25, max: 0.75, step: 0.005, get: () => playerConfig.hair.afroY, set: (v) => { playerConfig.hair.afroY = v; }, defaultValue: d.hair.afroY },
        { label: 'Afro Z', min: -0.25, max: 0.1, step: 0.005, get: () => playerConfig.hair.afroZ, set: (v) => { playerConfig.hair.afroZ = v; }, defaultValue: d.hair.afroZ },
        { label: 'Mohawk: Width', min: 0.02, max: 0.16, step: 0.01, get: () => playerConfig.hair.mohawkWidth, set: (v) => { playerConfig.hair.mohawkWidth = v; }, defaultValue: d.hair.mohawkWidth },
        { label: 'Mohawk: Height', min: 0.08, max: 0.4, step: 0.01, get: () => playerConfig.hair.mohawkHeight, set: (v) => { playerConfig.hair.mohawkHeight = v; }, defaultValue: d.hair.mohawkHeight },
        { label: 'Mohawk: Depth', min: 0.14, max: 0.36, step: 0.01, get: () => playerConfig.hair.mohawkDepth, set: (v) => { playerConfig.hair.mohawkDepth = v; }, defaultValue: d.hair.mohawkDepth },
        { label: 'Mohawk: Y', min: 0.35, max: 0.85, step: 0.005, get: () => playerConfig.hair.mohawkY, set: (v) => { playerConfig.hair.mohawkY = v; }, defaultValue: d.hair.mohawkY },
        { label: 'Mohawk: Z', min: -0.2, max: 0.15, step: 0.005, get: () => playerConfig.hair.mohawkZ, set: (v) => { playerConfig.hair.mohawkZ = v; }, defaultValue: d.hair.mohawkZ },
        { label: 'Headband Radius', min: 0.2, max: 0.4, step: 0.005, get: () => playerConfig.hair.headbandRadius, set: (v) => { playerConfig.hair.headbandRadius = v; }, defaultValue: d.hair.headbandRadius },
        { label: 'Headband Thickness', min: 0.02, max: 0.15, step: 0.005, get: () => playerConfig.hair.headbandThickness, set: (v) => { playerConfig.hair.headbandThickness = v; }, defaultValue: d.hair.headbandThickness },
        { label: 'Headband Y', min: 0.25, max: 0.7, step: 0.005, get: () => playerConfig.hair.headbandY, set: (v) => { playerConfig.hair.headbandY = v; }, defaultValue: d.hair.headbandY },
      ],
      colors: [
        { label: 'Headband Color', get: () => playerConfig.hair.headbandColor, set: (v) => { playerConfig.hair.headbandColor = v; }, defaultValue: d.hair.headbandColor },
      ],
    },
  ];
}
