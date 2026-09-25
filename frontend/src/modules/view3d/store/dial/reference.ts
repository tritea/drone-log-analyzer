import * as THREE from 'three';
import { runtime } from '@/modules/shared/runtime';
import { useCurveManagerStore } from '@/modules/curves';
import { makeDroneQuaternion } from '@/modules/shared/utils/drone-model';
import { disposeObjectTree } from '../../utils/dispose';

/* 姿态仪参照球半径（世界固连环层/机头箭头长度基准）。 */
const DIAL_SPHERE_R = 1.15;

// 纬线粗环(Torus)：XZ 平面(水平)、半径 radius、高度 y。tube 控制线粗，可半透明。
// 用 Torus 取代 LineLoop——LineBasicMaterial.linewidth 在多数平台被忽略只能 1px，Torus 才有真实粗细。
function makeLatitudeRing(radius: number, y: number, color: number, opacity: number, tube = 0.008): THREE.Mesh | undefined {
  const mesh = new THREE.Mesh(
    new THREE.TorusGeometry(radius, tube, 10, 120),
    new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: opacity, depthWrite: false })
  );
  mesh.rotation.x = Math.PI / 2; // Torus 默认在 XY 平面，转 90° 平躺成纬圈
  mesh.position.y = y;
  return mesh;
}

// 罗盘字母纹理缓存：N/E/S/W 各一张 CanvasTexture，世界固连、内容不变，全局复用。
// disposeObjectTree 只回收 geometry/material、不回收 material.map 纹理，故缓存复用避免每次重建姿态球泄露。
const compassLabelTex: Record<string, THREE.Texture> = {};
function compassLabelTexture(text: string, color: string): THREE.Texture | undefined {
  const key = text + '|' + color;
  if (compassLabelTex[key]) return compassLabelTex[key];
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.font = 'bold 44px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 32, 34);
  const tex = new THREE.CanvasTexture(canvas);
  compassLabelTex[key] = tex;
  return tex;
}

// 罗盘字母 Sprite：永远面向相机，赤道环外侧方位标识。
function makeCompassMark(text: string, color: string): THREE.Sprite | undefined {
  const tex = compassLabelTexture(text, color);
  if (!tex) return;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(0.34, 0.34, 1);
  return sprite;
}

// 径向刻度短线(细 Cylinder)：赤道环上 r0→r1 的方位标记。az=0 对应 −Z(北)，顺时针(与 yaw 同向)。
// 用四元数把圆柱默认 +Y 轴对齐到径向 (sin az, 0, −cos az)；N 刻度更粗更长以突出正北。
function makeCompassTick(az: number, color: number, r0: number, r1: number, thickness: number): THREE.Mesh | undefined {
  const len = r1 - r0;
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(thickness, thickness, len, 8),
    new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.9, depthWrite: false })
  );
  const dir = new THREE.Vector3(Math.sin(az), 0, -Math.cos(az));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const rm = (r0 + r1) / 2;
  mesh.position.set(dir.x * rm, 0, dir.z * rm);
  return mesh;
}

// 地平参照球：外层淡玻璃球壳(包裹感) + 下半球深灰染色(下半球远面 BackSide，上浅下深、不盖机体)
// + 浅灰赤道/正向圆环/赤道十字 + N。世界固定、无人机与红机头杆在内旋转。
// 玻璃壳+下深上浅给"球内包裹/天地"视觉感；赤道判 pitch/roll，正向圆环判 yaw，
// 赤道十字给水平面基准；正北 N 给航向零点。
export function buildDialReference(): THREE.Group | undefined {
  const dv = runtime.view3dDial;
  if (!dv) return;
  const R = DIAL_SPHERE_R;
  const group = new THREE.Group();
  group.name = 'dial-reference';

  // 背景圆（在 3D 之后、比球大一点、独立浅色 ≠ 画布背景 → 有层次）：给上半球一个有层次的底色——
  // 上半球透明→显背景圆色(不直接透到画布背景)，下半球再叠更深染色 → 上浅(背景圆)、下深(染色)分明。
  // 相机方向在此算一次(正向环复用)。世界固连（不随机身转）。
  // 相机此刻必须已摆好（ensureDial 在 runtime 赋值前先 aimDialCamera），否则 camDir 走兜底 (0,0,1)，
  // 背景/正向环朝向烘死、与真实相机错位（参考环偏心 bug 的根因）。
  const camPos = dv.camera ? dv.camera.position : new THREE.Vector3(0, 0, 1);
  const camDir = camPos.lengthSq() > 1e-6 ? camPos.clone().normalize() : new THREE.Vector3(0, 0, 1);
  const bgDiscMat = new THREE.MeshBasicMaterial({ color: 0xe3e8ee, side: THREE.DoubleSide, depthWrite: false });
  const bgDisc = new THREE.Mesh(new THREE.CircleGeometry(R * 1.4, 64), bgDiscMat);
  bgDisc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), camDir); // 圆面朝相机
  bgDisc.position.copy(camDir).multiplyScalar(-R * 1.1); // 贴在球后(远离相机侧)
  bgDisc.renderOrder = -2; // 最底层
  group.add(bgDisc);
  // 下半球染色（SpaceX 风：下半球染比背景更深的同色系灰，上半球留空显浅背景 → 上浅下深）：
  // 只染下半球"远面"=BackSide，位于无人机之后→机体遮挡、不被盖住。世界固连（不随机身转）。
  const lowerDyeMat = new THREE.MeshBasicMaterial({ color: 0xb8c2cc, transparent: true, opacity: 0.6, side: THREE.BackSide, depthWrite: false });
  const lowerDye = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), lowerDyeMat); // 赤道→南极(下半球) 远面
  lowerDye.renderOrder = -1;
  group.add(lowerDye);

  // 赤道（E-W 地平基准）：粗环(Torus) 浅灰，不透明——下半染色不透到赤道，赤道保持自身浅灰、不被染。
  // 半径=R，与正向圆环同径（正面看似等大、不超出）；横向不再拉长——拉长会超出正圆。
  const equator = makeLatitudeRing(R, 0, 0xBAC3CE, 1.0, 0.015);
  if (equator) group.add(equator);
  // 赤道面上的十字参考线：W-E(沿 X)、N-S(沿 Z) 两条直径，灰、与环同粗，作赤道面方向参照（非经纬网格）。
  const crossMat = new THREE.MeshBasicMaterial({ color: 0xBAC3CE, transparent: true, opacity: 1.0, depthWrite: false });
  const we = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, R * 2, 8), crossMat);
  we.rotation.z = Math.PI / 2; // 圆柱默认沿 Y，绕 Z 转 90° → 沿 X（W-E 直径）
  group.add(we);
  const ns = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, R * 2, 8), crossMat);
  ns.rotation.x = Math.PI / 2; // 圆柱默认沿 Y，绕 X 转 90° → 沿 Z（N-S 直径）
  group.add(ns);
  // 正向圆环（面朝相机 → 正面看似 2D 正圆，非侧立椭圆）：环面法线对齐"原点→相机"方向。
  // 半径略放大(×1.05)以盖过赤道椭圆的视觉宽度；相机固定时该环固定；粗灰、与赤道同粗。
  const faceRing = new THREE.Mesh(
    new THREE.TorusGeometry(R * 1.05, 0.015, 12, 120),
    new THREE.MeshBasicMaterial({ color: 0xBAC3CE, transparent: true, opacity: 1.0, depthWrite: false })
  );
  faceRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), camDir);
  group.add(faceRing);
  // 正北标识（世界固连）：yaw=0 时机头朝 −Z(见 makeDroneQuaternion)，故 az=0→−Z=北。
  // 仅标一个 N 作航向零点：字母加深加大、renderOrder 抬到最上 → 不被天地半球上色模糊、清晰可读。
  const N_AZ = 0;
  const nTick = makeCompassTick(N_AZ, 0xBAC3CE, R, R + 0.22, 0.014);
  if (nTick) { nTick.renderOrder = 2; group.add(nTick); }
  const nLabel = makeCompassMark('N', '#1e293b');
  if (nLabel) {
    nLabel.scale.set(0.46, 0.46, 1); // 放大字母
    nLabel.renderOrder = 2;          // 画在天地半球/环线之上，清晰不被模糊
    nLabel.position.set(Math.sin(N_AZ) * (R + 0.4), 0, -Math.cos(N_AZ) * (R + 0.4));
    group.add(nLabel);
  }
  // 朝向偏移由机头箭头(跟随无人机的本体层) 与世界环的夹角指示，球本身保留赤道+十字+正北标识作世界参照。
  return group;
}

// 机头箭头（本体固连）：醒目红，加粗杆 + 锥形箭头尖，随机身姿态指向机头(局部 +Z)。
// 锥尖给出明确朝向；箭头总长=球半径，尖端落在球面上、不超出包围球/正向圆，方向一眼可辨。
export function rebuildNosePointer(): void {
  const dv = runtime.view3dDial;
  if (!dv) return;
  if (dv.nose) {
    dv.scene.remove(dv.nose);
    disposeObjectTree(dv.nose);
    dv.nose = null;
  }
  const nose = new THREE.Group();
  nose.name = 'dial-nose';
  const noseMat = new THREE.MeshBasicMaterial({ color: 0xff3b30, depthWrite: false });
  const HEAD_LEN = 0.22;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, DIAL_SPHERE_R - HEAD_LEN, 12), noseMat);
  shaft.rotation.x = Math.PI / 2; // 圆柱默认沿 Y，转 90° 对齐局部 +Z（机头方向）
  shaft.position.set(0, 0, (DIAL_SPHERE_R - HEAD_LEN) / 2);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.07, HEAD_LEN, 18), noseMat);
  head.rotation.x = Math.PI / 2; // 圆锥默认指 +Y，转 90° 指 +Z（箭头朝机头方向）
  head.position.set(0, 0, DIAL_SPHERE_R - HEAD_LEN / 2); // 尖端 = 球半径，落在球面上、不超出
  nose.add(shaft);
  nose.add(head);
  dv.nose = nose;
  dv.scene.add(nose);
}

// 风向箭头：世界固连(不随机身转)，按 WIND.Dir 偏航。青色，与世界环/红机头箭头区分。
// 无风数据时隐藏。用 makeDroneQuaternion({yaw}) 取向，与机头(heading)同一世界系，二者夹角即相对风向。
export function rebuildWindPointer(): void {
  const dv = runtime.view3dDial;
  if (!dv) return;
  if (dv.wind?.arrow) { dv.scene.remove(dv.wind.arrow); disposeObjectTree(dv.wind.arrow); }
  const mat = new THREE.MeshBasicMaterial({ color: 0x00e676, depthWrite: false });
  const g = new THREE.Group();
  g.name = 'dial-wind';
  // 短箭头贴在球面、指向球心：头部尖朝 -Z(中心)，杆在外侧一点点。整体靠近 R、长度很短。
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.13, 14), mat);
  head.rotation.x = -Math.PI / 2; // 圆锥默认指 +Y，转 -90° 指 -Z(朝球心)
  head.position.set(0, 0, DIAL_SPHERE_R - 0.065); // 尖端 ~R-0.13、底 ~R
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.09, 8), mat);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.set(0, 0, DIAL_SPHERE_R + 0.045); // 杆在球面外侧一点点
  g.add(head);
  g.add(shaft);
  g.visible = false; // 无风数据时隐藏，aimWindPointer 命中时再显示
  if (!dv.wind) dv.wind = { curves: null, arrow: null };
  dv.wind.arrow = g;
  dv.scene.add(g);
}

// 每帧按风速向量 (N,E,D) 定向箭头：yaw=atan2(E,N)(水平流向)，pitch 按 VWD 上下俯仰(3D 风向量)。
// 无 VWD(XKF2)→pitch=0 退化为水平。箭头沿风速向量(风去的方向)；要"风来的方向"改 yaw+180。与机头同世界系。
export function aimWindPointer(t: number): void {
  const dv = runtime.view3dDial;
  if (!dv || !dv.wind?.arrow) return;
  const c = dv.wind.curves;
  if (!c) { dv.wind.arrow.visible = false; return; }
  const cm = useCurveManagerStore();
  const n = cm.getValueAt(c.n.type, c.n.field, t, NaN);
  const e = cm.getValueAt(c.e.type, c.e.field, t, NaN);
  if (n === null || e === null || !isFinite(n) || !isFinite(e)) { dv.wind.arrow.visible = false; return; }
  const horiz = Math.sqrt(n * n + e * e);
  const yawDeg = Math.atan2(e, n) * 180 / Math.PI;
  let d = 0;
  if (c.d) {
    const dv2 = cm.getValueAt(c.d.type, c.d.field, t, 0);
    if (dv2 !== null && isFinite(dv2)) d = dv2;
  }
  // VWD 为 NED-down(正=向下风)；-d 转上正，与 pitch(抬头正) 对齐。
  const pitchDeg = horiz > 1e-9 ? Math.atan2(-d, horiz) * 180 / Math.PI : 0;
  // 风向 = 气象"风来的方向"(FROM)：流速向量反方向(+180)，故风从左侧来→箭头落在左侧指向球心。
  dv.wind.arrow.visible = true;
  dv.wind.arrow.quaternion.copy(makeDroneQuaternion({ roll: 0, pitch: pitchDeg, yaw: yawDeg + 180 }));
}

// 每帧把机头箭头同步到无人机姿态（四元数已在 poseDrone 写入 dv.drone）。
export function syncNosePointer(): void {
  const dv = runtime.view3dDial;
  if (!dv) return;
  if (dv.nose && dv.drone) dv.nose.quaternion.copy(dv.drone.quaternion);
}
