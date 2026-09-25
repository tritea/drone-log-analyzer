import * as THREE from 'three';
import { runtime } from '@/modules/shared/runtime';
import { useUiStore } from '@/modules/shared/ui-store';
import type { View3dStoreCtx, WaterApi } from '../types';
import { SKY_COLOR_GLSL } from './sky';

/* 水面视觉参数（数值与旧版逐字一致，改这里=改水面观感）。 */
const WATER_PLANE_SIZE = 20000;       // 平面边长（世界单位）
const WAVE_AMPLITUDE = 0.5;           // 涟漪法线扰动幅度
const RIPPLE_NEAR = 80;               // 全幅涟漪距离上限
const RIPPLE_FAR = 700;               // 涟漪完全衰减距离
const FRESNEL_BASE = 0.2;             // Schlick 菲涅尔基准反射率
const GLINT_EXPONENT = 120;           // 太阳高光指数
const GLINT_STRENGTH = 2.2;           // 太阳粼光强度
const DEEP_COLOR = 0x2a5e80;          // 深水色
const SHALLOW_COLOR = 0x67a8c9;       // 浅水色
const HORIZON_FADE_SKY = 0.06;        // 地平线淡入起始（俯角 sin）
const HORIZON_FADE_WATER = 0.20;      // 地平线淡入结束（俯角 sin）

export function createWater(ctx: View3dStoreCtx): WaterApi {
  const st = ctx.state;

  // 水面：单 pass 程序化反射。天空盒本身是计算的(方向→颜色)，水面用反射方向 R=reflect(-V,N)
  // 复算同一 skyColorAt 函数 → 直接得到该处水面应反射的天色，无需 RTT/planar reflection；
  // 无人机不进反射(零额外 draw call)。涟漪 = 复用天空噪声纹理在世界 XZ 做有限差分求高度场梯度
  // → 法线扰动。菲涅尔(掠射更反光/俯视透水色) + 太阳 Blinn-Phong 粼光 + 远处淡入地平线天色
  // → 无缝水天交界(消除地面硬边)。
  function ensureWater(): void {
    const tv = runtime.view3dMain;
    if (!tv || tv.water?.mesh) return;
    if (!tv.water) tv.water = {};
    // 复用天空噪声纹理(涟漪法线 + 云反射共用)；天空未构建时即时烘焙一份。
    ctx.sky.ensureNoiseTexture();
    // 烘焙天空到立方体贴图(一次性，云冻结)：水面用反射方向采样 + 法线扰动 → 廉价倒影；
    // 失败则回落解析天空。
    tv.water.skyTex = ctx.sky.bakeSkyForReflection();
    const skyTex = tv.water.skyTex ? tv.water.skyTex.texture : null;

    const sunDir = new THREE.Vector3(0.5, 0.78, 0.39).normalize(); // 与天空/主光同源
    const waterMat = new THREE.ShaderMaterial({
      uniforms: {
        // 共享天空 uniform（与天空盒同名 → skyColorAt 直接复用，倒影与实天空逐像素一致）
        uTopColor: { value: new THREE.Color(0x2a63c9) },
        uHorizonColor: { value: new THREE.Color(0xc4dcf2) },
        uBottomColor: { value: new THREE.Color(0xd8dde2) },
        uSunDir: { value: sunDir },
        uSunColor: { value: new THREE.Color(0xfff3d6) },
        uTime: { value: 0 },
        uCloud: { value: st.value.sky.cloud },
        uNoiseTex: { value: runtime.view3dMain?.sky?.noiseTex ?? null },
        // 水面专属
        uWave: { value: st.value.water.wave },
        uDeepColor: { value: new THREE.Color(DEEP_COLOR) },
        uShallowColor: { value: new THREE.Color(SHALLOW_COLOR) },
        // 自带相机/平面世界坐标 uniform：不依赖 Three 自动注入的 cameraPosition/modelMatrix
        // （该版本对 ShaderMaterial 片元 cameraPosition 注入不稳，曾致着色器编译失败 → 水面不绘制）。
        uCamPos: { value: new THREE.Vector3() },
        uPlanePos: { value: new THREE.Vector3() },
        // 倒影：预烘焙天空立方体贴图 + 开关（烘焙失败时 uUseSkyTex=0，回落解析天空 skyColorAt）。
        uSkyTex: { value: skyTex },
        uUseSkyTex: { value: skyTex ? 1.0 : 0.0 }
      },
      vertexShader: [
        'varying vec3 vWorldPos;',
        'uniform vec3 uPlanePos;', // 平面世界位移(=mesh.position)；几何已 rotateX 烘焙到 XZ，mesh 无旋转
        'void main(){',
        '  vWorldPos = position + uPlanePos;', // 世界坐标 = 顶点(已烘焙朝向) + 平面位移
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'varying vec3 vWorldPos;',
        'uniform vec3 uTopColor;',
        'uniform vec3 uHorizonColor;',
        'uniform vec3 uBottomColor;',
        'uniform vec3 uSunDir;',
        'uniform vec3 uSunColor;',
        'uniform float uTime;',
        'uniform float uCloud;',
        'uniform sampler2D uNoiseTex;',
        'uniform float uWave;',
        'uniform vec3 uDeepColor;',
        'uniform vec3 uShallowColor;',
        'uniform vec3 uCamPos;', // 相机世界坐标(每帧由 anchorWaterToCamera 写入)
        'uniform samplerCube uSkyTex;', // 预烘焙天空立方体贴图(倒影源)
        'uniform float uUseSkyTex;',    // 1=采样纹理，0=解析天空(烘焙失败回落)
        SKY_COLOR_GLSL, // 共享天空颜色函数（烘焙失败时回落用）
        // 平缓涟漪(小河感)：几组低频正弦叠加 → 连续柔和起伏。刻意不采样噪声纹理，
        // 避免高频噪声在远处因平铺走样成"颗粒凸起"。
        // 频率刻意取互不可约值(0.143/0.181/0.097/0.223，非同一小数的整数倍)——否则合成场会有
        // 有限宏观周期(如旧 0.14/0.18/0.10/0.22 同为 0.02 倍→周期 ~314 单位)→ 肉眼可见"一块一块"规则平铺。
        // 多加一档离轴(非 0/90/±45°)小振幅细节，进一步打破栅格感。扰动随距离衰减见下(distFade)。
        'float waveH(vec2 p){',
        '  float t = uTime;',
        '  float w = 0.0;',
        '  w += sin(p.x * 0.143 + t * 0.90) * 0.50;',
        '  w += sin(p.y * 0.181 - t * 0.70) * 0.40;',
        '  w += sin((p.x + p.y) * 0.097 + t * 0.50) * 0.35;',
        '  w += sin((p.x - p.y) * 0.223 + t * 0.80) * 0.20;',
        '  w += sin((p.x * 1.30 + p.y * 0.70) * 0.183 - t * 0.60) * 0.15;',
        '  return w;',
        '}',
        'void main(){',
        '  float dist = length(uCamPos - vWorldPos);',
        // 扰动按「点到相机距离」衰减：近处明显涟漪 → 远处完全平静(镜面反射天空)，近似真实海面。
        // NEAR 内全幅、NEAR→FAR 平滑衰减到 0；远处淡入天色(见下)前水面早已平静 → 过渡自然。
        '  float distFade = 1.0 - smoothstep(float(' + RIPPLE_NEAR + '), float(' + RIPPLE_FAR + '), dist);',
        // 法线扰动：正弦高度场有限差分(步长较大→低频柔和法线) → 轻微倾斜，把倒影打碎成涟漪。
        '  float e = 2.0;',
        '  float h0 = waveH(vWorldPos.xz);',
        '  float hx = waveH(vWorldPos.xz + vec2(e, 0.0));',
        '  float hz = waveH(vWorldPos.xz + vec2(0.0, e));',
        '  float amp = uWave * ' + WAVE_AMPLITUDE + ' * distFade;',
        '  vec3 N = normalize(vec3((h0 - hx) * amp, 1.0, (h0 - hz) * amp));',
        '  vec3 V = normalize(uCamPos - vWorldPos);',
        '  vec3 R = reflect(-V, N);',
        // 倒影：优先采样预烘焙天空立方体贴图(法线扰动已打碎倒影=涟漪)；烘焙失败回落解析天空。
        '  vec3 sky;',
        '  if (uUseSkyTex > 0.5) {',
        '    sky = textureCube(uSkyTex, R).rgb;',
        '  } else {',
        '    sky = skyColorAt(R);',
        '  }',
        // Schlick 菲涅尔：掠射→全反射天色，俯视→透水体本色。指数3+高 FRESNEL0 → 大多数角度反射占主导(近镜面)。
        '  float f = ' + FRESNEL_BASE + ' + (1.0 - ' + FRESNEL_BASE + ') * pow(1.0 - max(dot(V, N), 0.0), 3.0);',
        '  vec3 water = mix(uDeepColor, uShallowColor, clamp(N.y - 0.6, 0.0, 1.0) * 2.0);', // 偏向更亮的浅色
        '  vec3 col = mix(water, sky, clamp(f, 0.0, 1.0));',
        // 太阳水面粼光：扰动法线把高光碎成粼光；远处随 distFade 衰减，避免远方亮斑。
        '  vec3 H = normalize(uSunDir + V);',
        '  col += uSunColor * (pow(max(dot(N, H), 0.0), float(' + GLINT_EXPONENT + ')) * ' + GLINT_STRENGTH + ') * distFade;',
        // 地平线淡入按俯角(depression=sin 俯角，与相机高度无关)：高空俯视正下方仍水色、仅地平线带融天色 →
        // 任意相机距离/轨迹尺度水都可见。旧按绝对距离 [1000,3000] 淡入时，大航线相机拉远后正下方水面
        // 距离超阈值会被整片淡成天色「看不到」。
        '  float depression = clamp((uCamPos.y - vWorldPos.y) / max(dist, 1e-4), 0.0, 1.0);',
        '  col = mix(col, uHorizonColor, 1.0 - smoothstep(float(' + HORIZON_FADE_SKY + '), float(' + HORIZON_FADE_WATER + '), depression));',
        '  gl_FragColor = vec4(col, 1.0);',
        '}'
      ].join('\n'),
      transparent: false,
      depthWrite: false,
      // 水面不写深度：地面在其后绘制(renderOrder 更高)按画家算法直接盖掉水面颜色，重叠区不做深度比较 →
      // 彻底消除高空/远距离深度精度不足导致的地面↔水面 z-fight 闪烁（两个共面层都写深度时，
      // 精度会让二者逐像素随机胜负）。depthTest 仍开：水面与先绘制的无人机/线条等(写深度者)
      // 保持正确遮挡，只是不留自己的深度给地面去比。
      side: THREE.FrontSide, // 仅渲染朝上的正面（+Y），与地面一致
      fog: false,
      toneMapped: false
    });

    // 旋转烘焙进几何（rotateX 返回 this）：mesh 无旋转 → 顶点局部坐标即世界朝向，
    // 顶点着色器里 vWorldPos = position + uPlanePos 才正确（无需 modelMatrix）。
    const waterGeom = new THREE.PlaneGeometry(WATER_PLANE_SIZE, WATER_PLANE_SIZE).rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(waterGeom, waterMat);
    // mesh.rotation 不设(已烘焙)；position 由 anchorWaterToCamera 每帧对齐：相机 XZ + grid 的 Y(下沉到机身底部)。
    water.frustumCulled = false;     // 每帧钉到相机 XZ，AABB 不稳；关裁剪保始终绘制
    water.renderOrder = 1;           // 先于地面(ground=2)绘制：水面画完(不写深度)→ 地面后画直接覆盖重叠区(画家算法，无 z-fight)
    water.name = 'view3d-water';
    tv.water.mesh = water;
    tv.scene.add(water);
    anchorWaterToCamera();
    // 不在此处 renderView3d：buildView3d 在相机创建之前调用本函数，渲染会经 resizeView3d
    // 读未建相机的 aspect 而崩。渲染交给调用方——buildView3d 末尾 applyMainLighting、
    // toggleWater 末尾均会渲染。
  }

  function disposeWater(): void {
    const tv = runtime.view3dMain;
    if (!tv || !tv.water?.mesh) return;
    const mesh = tv.water.mesh;
    try { tv.scene.remove(mesh); } catch (e) { /* noop */ }
    if (mesh.geometry) { try { mesh.geometry.dispose(); } catch (e) { /* noop */ } }
    if (mesh.material) { try { (mesh.material as THREE.Material).dispose(); } catch (e) { /* noop */ } }
    tv.water.mesh = undefined;
    if (tv.water.skyTex) { try { tv.water.skyTex.dispose(); } catch (e) { /* noop */ } tv.water.skyTex = undefined; }
  }

  // 每帧对齐水面：钉到相机 XZ（infinite-ocean 技巧）+ 与 grid 同高(下沉到机身底部) + 同步自带相机/平面 uniform。
  function anchorWaterToCamera(): void {
    const tv = runtime.view3dMain;
    const mesh = tv?.water?.mesh;
    if (!tv || !mesh) return;
    const cam = tv.activeCamera || tv.camera;
    if (!cam) return;
    mesh.position.x = cam.position.x;
    mesh.position.z = cam.position.z;
    // 水面略低于地面：地面在 grid.position.y(机身底部)，水面再下沉机身半高的 25%，给出一道可见台阶。
    // 反 z-fight 由「水面 depthWrite:false + 地面后绘制(画家算法)」负责(见 ensureWater)，此间隙只管近处台阶观感。
    // 不抬地面 → 不会把无人机半埋(机身已被归一化到很小)。
    if (tv.grid) mesh.position.y = tv.grid.position.y - (tv.droneHalfHeight || 0) * 0.25;
    // 自带 uniform：相机世界坐标 + 平面世界位移(=mesh.position，与 modelMatrix 平移一致)。
    const u = (mesh.material as THREE.ShaderMaterial).uniforms;
    if (u) {
      u.uCamPos.value.copy(cam.position);
      u.uPlanePos.value.set(mesh.position.x, mesh.position.y, mesh.position.z);
    }
  }

  // 水面 uniform 每帧推进：uTime 驱动涟漪漂移(与回放无关)、uWave 实时同步滑杆、uCloud 同步云量(倒影与天空一致)。
  function advanceWaterUniforms(ts: number): void {
    const tv = runtime.view3dMain;
    const mesh = tv?.water?.mesh;
    if (!tv || !mesh) return;
    const u = (mesh.material as THREE.ShaderMaterial).uniforms;
    if (!u) return;
    u.uTime.value = (ts || 0) / 1000;
    u.uWave.value = st.value.water.wave;
    u.uCloud.value = st.value.sky.cloud;
  }

  function toggleWater(enabled: boolean): void {
    st.value.water.enabled = enabled;
    const tv = runtime.view3dMain;
    if (enabled) {
      if (tv) ensureWater();
    } else {
      disposeWater();
    }
    if (useUiStore().ui.mainView === 'three') ctx.frame.renderView3d();
  }

  function setWaveAmount(value: number): void {
    st.value.water.wave = value;
  }

  return { ensureWater, disposeWater, anchorWaterToCamera, advanceWaterUniforms, toggleWater, setWaveAmount };
}
