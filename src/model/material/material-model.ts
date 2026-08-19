export type PovRayTargetVersion = "3.7" | "3.8";

export type MaterialPresetId =
  | "matte"
  | "matte-plastic"
  | "glossy-plastic"
  | "metal"
  | "glass"
  | "frosted-glass"
  | "wood-base"
  | "concrete";

export interface PhysicalMaterialPreviewModel {
  baseColor: string;
  diffuse: number;
  metalness: number;
  roughness: number;
  opacity: number;
  transparent: boolean;
  emissiveColor: string;
  emissiveIntensity: number;
  doubleSided: boolean;
  wireframe: boolean;
  reflection: number;
  transmission: number;
  ior: number;
  thickness: number;
  attenuationColor: string;
  /** `null` represents an infinite attenuation distance. */
  attenuationDistance: number | null;
  clearcoat: number;
  clearcoatRoughness: number;
  specularIntensity: number;
  specularColor: string;
  sheen: number;
  sheenRoughness: number;
  sheenColor: string;
  iridescence: number;
  iridescenceIOR: number;
  iridescenceThicknessRange: [minimum: number, maximum: number];
  anisotropy: number;
  anisotropyRotationDegrees: number;
  dispersion: number;
}

export interface PovColorModel {
  red: number;
  green: number;
  blue: number;
  filter?: number;
  transmit?: number;
}

export type PovSerializableValueModel =
  | string
  | number
  | boolean
  | null
  | PovSerializableValueModel[]
  | { [key: string]: PovSerializableValueModel };

export interface PovExtensionNodeModel {
  keyword: string;
  values?: PovSerializableValueModel[];
  children?: PovExtensionNodeModel[];
  raw?: string;
}

export interface PovTransformModel {
  type: "translate" | "rotate" | "scale" | "matrix" | "transform";
  value: PovSerializableValueModel;
}

export interface PovImageMapModel {
  source: string;
  format?: string;
  gamma?: number | string;
  premultiplied?: boolean;
  once?: boolean;
  mapType?: "planar" | "spherical" | "cylindrical" | "toroidal" | number;
  interpolate?:
    | "nearest"
    | "bilinear"
    | "bicubic"
    | "normalized-distance"
    | number;
  useAlpha?: boolean;
  parameters?: Record<string, PovSerializableValueModel>;
  transforms?: PovTransformModel[];
  extensions?: PovExtensionNodeModel[];
}

export interface PovMapEntryModel<Value = PovSerializableValueModel> {
  position: number;
  value: Value;
}

export interface PovPatternModel {
  type: string;
  parameters?: Record<string, PovSerializableValueModel>;
  map?: PovMapEntryModel[];
  frequency?: number;
  phase?: number;
  wave?: "ramp" | "triangle" | "sine" | "scallop" | "cubic" | "poly";
  turbulence?: Record<string, PovSerializableValueModel>;
  warps?: PovExtensionNodeModel[];
  transforms?: PovTransformModel[];
  extensions?: PovExtensionNodeModel[];
}

export interface PovPigmentModel {
  type: "solid" | "pattern" | "image-map" | "uv-map" | "extension";
  color?: PovColorModel;
  quickColor?: PovColorModel;
  pattern?: PovPatternModel;
  imageMap?: PovImageMapModel;
  colorMap?: PovMapEntryModel<PovColorModel>[];
  pigmentMap?: PovMapEntryModel<PovPigmentModel>[];
  parameters?: Record<string, PovSerializableValueModel>;
  transforms?: PovTransformModel[];
  extensions?: PovExtensionNodeModel[];
}

export interface PovNormalModel {
  type:
    | "pattern"
    | "normal-map"
    | "slope-map"
    | "bump-map"
    | "uv-map"
    | "extension";
  amount?: number;
  pattern?: PovPatternModel;
  imageMap?: PovImageMapModel;
  normalMap?: PovMapEntryModel<PovNormalModel>[];
  slopeMap?: PovMapEntryModel[];
  bumpSize?: number;
  accuracy?: number;
  noBumpScale?: boolean;
  parameters?: Record<string, PovSerializableValueModel>;
  transforms?: PovTransformModel[];
  extensions?: PovExtensionNodeModel[];
}

export interface PovFinishModel {
  ambient?: number | PovColorModel;
  emission?: number | PovColorModel;
  diffuse?: number;
  albedo?: boolean;
  brilliance?: number;
  backsideDiffuse?: number;
  crand?: number;
  phong?: number;
  phongSize?: number;
  specular?: number;
  roughness?: number;
  metallic?: number | boolean;
  reflection?: {
    minimum?: PovColorModel;
    maximum?: PovColorModel;
    fresnel?: boolean;
    falloff?: number;
    exponent?: number;
    metallic?: number | boolean;
  };
  conserveEnergy?: boolean;
  iridescence?: { amount?: number; thickness?: number; turbulence?: number };
  subsurface?: {
    translucency: PovColorModel;
    energyConservation?: number;
  };
  fresnel?: boolean;
  useAlpha?: boolean;
  extensions?: PovExtensionNodeModel[];
}

export interface PovDensityModel {
  pattern: PovPatternModel;
  densityMap?: PovMapEntryModel<PovColorModel>[];
  transforms?: PovTransformModel[];
  extensions?: PovExtensionNodeModel[];
}

export interface PovMediaModel {
  method?: 1 | 2 | 3;
  intervals?: number;
  samples?: { minimum: number; maximum?: number };
  confidence?: number;
  variance?: number;
  ratio?: number;
  jitter?: number;
  aaThreshold?: number;
  aaLevel?: number;
  absorption?: PovColorModel;
  emission?: PovColorModel;
  scattering?: {
    type: 1 | 2 | 3 | 4 | 5;
    color: PovColorModel;
    eccentricity?: number;
    extinction?: number;
  };
  density?: PovDensityModel[];
  transforms?: PovTransformModel[];
  extensions?: PovExtensionNodeModel[];
}

export interface PovInteriorModel {
  ior?: number;
  caustics?: number;
  dispersion?: number;
  dispersionSamples?: number;
  fadeDistance?: number;
  fadePower?: number;
  fadeColor?: PovColorModel;
  media?: PovMediaModel[];
  extensions?: PovExtensionNodeModel[];
}

export interface PovTextureLayerModel {
  texture: PovTextureModel;
  extensions?: PovExtensionNodeModel[];
}

export interface PovTextureModel {
  type:
    | "plain"
    | "patterned"
    | "layered"
    | "material-map"
    | "uv-map"
    | "extension";
  pigment?: PovPigmentModel;
  normal?: PovNormalModel;
  finish?: PovFinishModel;
  pattern?: PovPatternModel;
  layers?: PovTextureLayerModel[];
  textureMap?: PovMapEntryModel<PovTextureModel>[];
  materialMap?: PovImageMapModel;
  transforms?: PovTransformModel[];
  extensions?: PovExtensionNodeModel[];
}

export interface PovMaterialModel {
  targetVersion: PovRayTargetVersion;
  texture: PovTextureModel;
  interiorTexture?: PovTextureModel;
  interior?: PovInteriorModel;
  transforms?: PovTransformModel[];
  extensions?: PovExtensionNodeModel[];
}

export interface MaterialDefinitionModel {
  id: string;
  name: string;
  category: string;
  tags: string[];
  presetId: MaterialPresetId | null;
  preview: PhysicalMaterialPreviewModel;
  pov: PovMaterialModel;
}
