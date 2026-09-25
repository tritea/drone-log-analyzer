export var LINE_PROGRESSIVE_THRESHOLD = 5000;

export var TRAJ_MAX_POINTS = 500;
export var TRAJ_CLOSE_METERS = 0.5;

export var THREE_UNITS_PER_METER = 1.5;
export var THREE_DONE_SCALE = 0.15;
export var THREE_ATTRIBUTE_POSITION = { x: 1, y: 0, z: 12.5 };

interface Propeller {
  name: string;
  dir: number;
  func?: number;
}

export var THREE_PROPELLER_ORDER: Record<string, Propeller[]> = {
  "HEXA-X":[
    { name: 'M1', dir: -1, func: 33 }, 
    { name: 'M2', dir: 1,  func: 34 }, 
    { name: 'M3', dir: -1, func: 35 }, 
    { name: 'M4', dir: 1,  func: 36 }, 
    { name: 'M5', dir: -1, func: 37 }, 
    { name: 'M6', dir: 1,  func: 38 }  
  ],
  "QUAD-X": [
    { name: 'M1', dir: -1, func: 33 }, 
    { name: 'M2', dir: -1, func: 34 }, 
    { name: 'M3', dir: 1,  func: 35 }, 
    { name: 'M4', dir: 1,  func: 36 }  
  ],
  "OCTO-X": [
    { name: 'M1', dir: -1, func: 33 },
    { name: 'M2', dir: 1,  func: 34 },
    { name: 'M3', dir: -1, func: 35 },
    { name: 'M4', dir: 1,  func: 36 },
    { name: 'M5', dir: -1, func: 37 },
    { name: 'M6', dir: 1,  func: 38 },
    { name: 'M7', dir: -1, func: 39 },
    { name: 'M8', dir: 1,  func: 40 }
  ],
  "VTOL": [
    { name: 'M1', dir: -1, func: 33 }, 
    { name: 'M2', dir: 1,  func: 34 }, 
    { name: 'M3', dir: -1, func: 35 }, 
    { name: 'M4', dir: 1,  func: 36 }, 
    { name: 'throttle', dir: -1, func: 70 } 
  ]
};

export interface MaterialProperties {
  color: number;
  metalness: number;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
}

var PROP_MATERIAL: MaterialProperties = {
  color: 0x14171c,
  metalness: 0.35,
  roughness: 0.42,
  clearcoat: 0.55,
  clearcoatRoughness: 0.45,
};

export var BODY_MATERIAL: MaterialProperties = {
  color: 0x33373f,
  metalness: 0.4,
  roughness: 0.48,
  clearcoat: 0.35,
  clearcoatRoughness: 0.5,
};

var LOWPOLY_ACCENT_MATERIAL: MaterialProperties = {
  color: 0xff2d2d,
  metalness: 0.2,
  roughness: 0.5,
  clearcoat: 0.2,
  clearcoatRoughness: 0.5,
};

export var THREE_MODEL_MATERIAL: Record<string, Record<string, MaterialProperties>>  = {
  "QUAD-X": {
    shell: BODY_MATERIAL,
    'shell-nose': LOWPOLY_ACCENT_MATERIAL,
    M1: PROP_MATERIAL, M2: PROP_MATERIAL, M3: PROP_MATERIAL, M4: PROP_MATERIAL,
  },
  "VTOL": {
    shell: BODY_MATERIAL,
    'shell-nose': LOWPOLY_ACCENT_MATERIAL,
    M1: PROP_MATERIAL, M2: PROP_MATERIAL, M3: PROP_MATERIAL, M4: PROP_MATERIAL, throttle: PROP_MATERIAL,
  },
  "HEXA-X": {
    shell: BODY_MATERIAL,
    'shell-nose': LOWPOLY_ACCENT_MATERIAL,
    M1: PROP_MATERIAL, M2: PROP_MATERIAL, M3: PROP_MATERIAL, M4: PROP_MATERIAL, M5: PROP_MATERIAL, M6: PROP_MATERIAL,
  },
  "OCTO-X": {
    shell: BODY_MATERIAL,
    'shell-nose': LOWPOLY_ACCENT_MATERIAL,
    M1: PROP_MATERIAL, M2: PROP_MATERIAL, M3: PROP_MATERIAL, M4: PROP_MATERIAL,
    M5: PROP_MATERIAL, M6: PROP_MATERIAL, M7: PROP_MATERIAL, M8: PROP_MATERIAL,
  }
}

export var THREE_PROPELLER_PWM_MIN = 1000;
export var THREE_PROPELLER_PWM_MAX = 2000;
export var THREE_PROPELLER_MAX_OMEGA = 81;
export var THREE_PROPELLER_ACCEL_TAU = 0.25;
export var THREE_PROPELLER_DECEL_TAU = 1.2;
export const THREE_DEFAULT_DRONE_MODEL = 'QUAD-X';

// 天空/水面/轨道距离等渲染参数已内聚到 modules/view3d 各域文件（数值不变），不再放共享层。
