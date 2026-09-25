import * as THREE from 'three';
import { runtime } from '@/modules/shared/runtime';
import { useUiStore } from '@/modules/shared/ui-store';
import type { SkyApi, View3dStoreCtx } from '../types';

/* 云层漂移速度（uTime 缩放）与预烘焙噪声纹理尺寸。 */
const CLOUD_DRIFT_SPEED = 0.03;
const NOISE_TEXTURE_SIZE = 256;

// 共享天空颜色 GLSL 函数（天空盒与水面倒影烘焙共用同一份 shader：方向→颜色，含渐变/太阳/云）。
// water.ts 的倒影回落路径同样内嵌此函数——两处必须逐字一致，倒影与实天空才逐像素对齐。
export const SKY_COLOR_GLSL = [
  'vec3 skyColorAt(vec3 dir){',
  '  dir = normalize(dir);',
  '  float y = dir.y;',
  '  vec3 col = y > 0.0',
  '    ? mix(uHorizonColor, uTopColor, smoothstep(0.0, 0.6, y))',
  '    : mix(uHorizonColor, uBottomColor, clamp(-y*1.5, 0.0, 1.0));',
  '  if(uCloud > 0.001){',
  '    vec2 cuv = vec2(atan(dir.z, dir.x) * 0.63662, asin(clamp(dir.y, -1.0, 1.0)) * 1.27324);',
  '    cuv += vec2(uTime * ' + CLOUD_DRIFT_SPEED + ', uTime * ' + (CLOUD_DRIFT_SPEED * 0.73) + ');',
  '    float c = texture2D(uNoiseTex, cuv).r;',
  '    c = smoothstep(0.5, 0.92, c);',
  '    float mask = smoothstep(0.02, 0.22, dir.y) * (1.0 - smoothstep(0.55, 0.95, dir.y));',
  '    col = mix(col, vec3(1.0, 0.98, 0.96), c * mask * uCloud);',
  '  }',
  '  float d = max(dot(dir, uSunDir), 0.0);',
  '  float disc = smoothstep(0.9994, 0.9998, d);',
  '  float glow = pow(d, 220.0)*0.7 + pow(d, 16.0)*0.4 + pow(d, 4.0)*0.15;',
  '  col += uSunColor * (disc*3.0 + glow);',
  '  return col;',
  '}'
].join('\n');

// 预烘焙可平铺 FBM 噪声为 DataTexture（单通道灰度装 RGBA，RepeatWrapping）。
// 与天空 shader 同款 5 倍频 value noise，但用周期化整数格点保证纹理无缝；
// shader 内云层改为一次纹理采样（替代每片元 5 倍频计算）。
function bakeNoiseTexture(): THREE.DataTexture | null {
  const N = NOISE_TEXTURE_SIZE;
  // 整数 hash → [0,1)
  const hash2 = function (ix: number, iy: number): number {
    let h = (ix * 374761393 + iy * 668265263) | 0;
    h = ((h ^ (h >> 13)) * 1274126177) | 0;
    h = (h ^ (h >> 16)) >>> 0;
    return h / 4294967296;
  };
  // 可平铺 2D value noise：f=每 tile 的格数；整数格点按 f 取模保证无缝。
  const vnoiseTile = function (u: number, v: number, f: number): number {
    const x = u * f, y = v * f;
    let ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const fxs = fx * fx * (3 - 2 * fx), fys = fy * fy * (3 - 2 * fy);
    ix = ((ix % f) + f) % f; iy = ((iy % f) + f) % f;
    const ix1 = (ix + 1) % f, iy1 = (iy + 1) % f;
    const v00 = hash2(ix, iy), v10 = hash2(ix1, iy), v01 = hash2(ix, iy1), v11 = hash2(ix1, iy1);
    const a = v00 + (v10 - v00) * fxs;
    const b = v01 + (v11 - v01) * fxs;
    return a + (b - a) * fys;
  };
  // 5 倍频 fbm：基频 4 格/tile，倍频 4/8/16/32/64 均整除 256 → 全可平铺。
  const fbmTile = function (u: number, v: number): number {
    let val = 0, a = 0.5, f = 4;
    for (let o = 0; o < 5; o++) { val += a * vnoiseTile(u, v, f); f *= 2; a *= 0.5; }
    return val;
  };
  // 先用 Float 收集 fbm 并记录 min/max，再归一化到 [0,1] —— 避免 value-noise fbm 集中在 ~0.48
  // 导致 smoothstep(0.5,0.92) 几乎全 0（云消失）。归一化后阈值约落在中位，云覆盖率合理。
  const raw = new Float32Array(N * N);
  let mn = Infinity, mx = -Infinity;
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      const c = fbmTile((px + 0.5) / N, (py + 0.5) / N);
      raw[py * N + px] = c;
      if (c < mn) mn = c;
      if (c > mx) mx = c;
    }
  }
  const range = (mx - mn) || 1;
  // RGBA 灰度（rgb 复用同一噪声值、a=255）：规避 RedFormat 在某些驱动/GLSL 组合下采样异常。
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    let n = (raw[i] - mn) / range;
    if (n < 0) n = 0; else if (n > 1) n = 1;
    const b = Math.round(n * 255);
    data[i * 4] = b; data[i * 4 + 1] = b; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

// 天空 ShaderMaterial 构造器（天空盒与水面倒影烘焙共用同一份 shader：方向→颜色，含渐变/太阳/云）。
// 抽出来便于烘焙倒影在天空 mesh 未构建(天空关)时也能即时造一份材质烘成立方体贴图。
function buildSkyMaterial(noiseTex: THREE.DataTexture | null, cloud: number): THREE.ShaderMaterial {
  const sunDir = new THREE.Vector3(0.5, 0.78, 0.39).normalize(); // 与主光 key(90,140,70) 同源
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
    uniforms: {
      uTopColor: { value: new THREE.Color(0x2a63c9) },
      uHorizonColor: { value: new THREE.Color(0xc4dcf2) },
      uBottomColor: { value: new THREE.Color(0xd8dde2) },
      uSunDir: { value: sunDir },
      uSunColor: { value: new THREE.Color(0xfff3d6) },
      // 云层：uTime 推进漂移、uCloud 控制云量（每帧由 advanceSkyUniforms 同步）；uNoiseTex=预烘焙噪声。
      uTime: { value: 0 },
      uCloud: { value: cloud },
      uNoiseTex: { value: noiseTex }
    },
    vertexShader: [
      'varying vec3 vDir;',
      'void main(){',
      '  vDir = position;',
      '  vec4 p = projectionMatrix * mat4(mat3(modelViewMatrix)) * vec4(position,1.0);',
      '  p.z = p.w;', // 推到远平面，避免盒子背面被近裁面剔除
      '  gl_Position = p;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'varying vec3 vDir;',
      'uniform vec3 uTopColor;',
      'uniform vec3 uHorizonColor;',
      'uniform vec3 uBottomColor;',
      'uniform vec3 uSunDir;',
      'uniform vec3 uSunColor;',
      'uniform float uTime;',
      'uniform float uCloud;',
      'uniform sampler2D uNoiseTex;', // 预烘焙可平铺 FBM 噪声（替代每片元 5 倍频计算）
      SKY_COLOR_GLSL,                // 共享天空颜色函数（与水面反射同源）
      'void main(){',
      '  gl_FragColor = vec4(skyColorAt(vDir), 1.0);',
      '}'
    ].join('\n')
  });
}

export function createSky(ctx: View3dStoreCtx): SkyApi {
  const st = ctx.state;

  // 惰性烘焙/复用天空噪声纹理（云层 + 水面涟漪共用，挂在主视图 runtime 的 sky 组）。
  function ensureNoiseTexture(): THREE.DataTexture | null {
    const tv = runtime.view3dMain;
    if (!tv) return null;
    if (!tv.sky) tv.sky = {};
    if (!tv.sky.noiseTex) tv.sky.noiseTex = bakeNoiseTexture();
    return tv.sky.noiseTex ?? null;
  }

  // 一次性把天空 shader 烘焙成立方体贴图（CubeCamera 六面采样，云冻结），供水面倒影采样。
  // 失败返回 null（水面回落到解析天空）。
  function bakeSkyForReflection(): THREE.WebGLCubeRenderTarget | null {
    const tv = runtime.view3dMain;
    if (!tv || !tv.renderer) return null;
    try {
      const noiseTex = ensureNoiseTexture();
      const skyMat = buildSkyMaterial(noiseTex, st.value.sky.cloud);
      const skyGeom = new THREE.BoxGeometry(1, 1, 1);
      const cubeRT = new THREE.WebGLCubeRenderTarget(256, {
        format: THREE.RGBAFormat,
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter,
        type: THREE.UnsignedByteType,
      });
      const cubeCam = new THREE.CubeCamera(0.1, 1000, cubeRT);
      const tmp = new THREE.Scene();
      tmp.add(new THREE.Mesh(skyGeom, skyMat)); // 共享几何/材质的副本置于临时场景
      cubeCam.update(tv.renderer, tmp);
      skyGeom.dispose();
      skyMat.dispose();
      return cubeRT;
    } catch (e) {
      return null;
    }
  }

  // 程序化天空盒：BoxGeometry + 自定义渐变着色器（蓝紫天顶 → 浅蓝地平线 + 太阳光晕）。
  // 顶点着色器用 mat4(mat3(modelViewMatrix)) 剥离相机平移，使天空始终包络相机（"无限远"），
  // 无需每帧重定位；并把 gl_Position.z 置为 w 推到远平面，避免盒子被近裁面剔除。
  // 配合 depthTest/depthWrite 关闭 + renderOrder=-1，始终先画铺底、不挡场景物体，近似游戏引擎 Skybox。
  // 另用 PMREMGenerator.fromScene 把天空烘焙成 IBL——机身清漆层能反射出天空，无需任何外部资源。
  function ensureSky(): void {
    const tv = runtime.view3dMain;
    if (!tv || tv.sky?.mesh) return;

    if (!tv.sky) tv.sky = {};
    if (!tv.sky.noiseTex) tv.sky.noiseTex = bakeNoiseTexture();

    const skyMat = buildSkyMaterial(tv.sky.noiseTex, st.value.sky.cloud);
    const skyGeom = new THREE.BoxGeometry(1, 1, 1);
    const sky = new THREE.Mesh(skyGeom, skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    sky.name = 'view3d-sky';
    tv.sky.mesh = sky;
    tv.scene.add(sky);
    // 天空网格本身就是背景，关掉纯色 background 以免多余绘制。
    tv.scene.background = null;

    // 把天空烘焙成 IBL：临时场景只放一份共享几何/材质的天空副本，fromScene 用内部
    // 立方相机采样六面并预过滤。失败则仅保留背景天空、不阻断 3D。
    // Low 档不烘焙天空 IBL（Basic 不采样 envMap、applyMainLighting 会摘 scene.environment，省启动开销）。
    if (tv.materialTier !== 'low' && tv.renderer) {
      try {
        const pmrem = new THREE.PMREMGenerator(tv.renderer);
        const skyScene = new THREE.Scene();
        skyScene.add(new THREE.Mesh(skyGeom, skyMat));
        tv.sky.envRt = pmrem.fromScene(skyScene);
        // scene.environment 的挂载交给 applyMainLighting 统一决策（天空开→skyEnvRt，否则 envRt），
        // 此处不直接赋值，避免互相覆盖。
        pmrem.dispose();
      } catch (e) {
        tv.sky.envRt = undefined;
      }
    }
    // 按当前 tier 决定天空形态：Low → 烘焙静态背景(零天空 shader)；其余 → mesh + 噪声 shader(云漂移)。
    applySkyQuality(tv.materialTier || 'high');
  }

  // Low 档天空：把天空 mesh 一次性渲染成立方体纹理 → scene.background，隐藏 mesh（零天空 shader、云冻结）。
  function bakeSkyBackdrop(): void {
    const tv = runtime.view3dMain;
    const mesh = tv?.sky?.mesh;
    if (!tv || !tv.renderer || !mesh) return;
    try {
      const cubeRT = new THREE.WebGLCubeRenderTarget(256, {
        format: THREE.RGBAFormat,
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter,
        type: THREE.UnsignedByteType,
      });
      const cubeCam = new THREE.CubeCamera(0.1, 1000, cubeRT);
      const tmp = new THREE.Scene();
      tmp.add(mesh.clone()); // 共享几何/材质的副本置于临时场景，立方相机采样六面
      cubeCam.update(tv.renderer, tmp);
      tv.sky!.backdropTex = cubeRT;
      tv.scene.background = cubeRT.texture;
      mesh.visible = false; // 背景接管，停 mesh 绘制
    } catch (e) {
      /* 烘焙失败则保留 mesh 天空，不阻断 */
    }
  }

  // 按 tier 切换天空形态：Low → 静态背景(烘焙)；其余 → mesh + 噪声 shader。仅天空开启时生效。
  function applySkyQuality(tier: 'high' | 'medium' | 'low'): void {
    const tv = runtime.view3dMain;
    if (!tv || !tv.sky?.mesh) return;
    if (!st.value.sky.enabled) return; // 天空关：背景由 toggleSky 管理，此处不碰
    if (tier === 'low') {
      if (!tv.sky.backdropTex) bakeSkyBackdrop();
    } else if (tv.sky.backdropTex) {
      // 回到 mesh 天空：移除静态背景、显 mesh（ensureSky 已置 scene.background=null 由 mesh 接管）。
      try { tv.sky.backdropTex.dispose(); } catch (e) { /* noop */ }
      tv.sky.backdropTex = undefined;
      tv.scene.background = null;
      tv.sky.mesh.visible = true;
    }
    // 仅在视图就绪（相机已建）时刷新：ensureSky 在 buildView3d 相机创建之前被调用，
    // 此时跳过，由 ensureView3d 末尾的 renderView3d 统一刷新。
    if (tv.activeCamera && useUiStore().ui.mainView === 'three') ctx.frame.renderView3d();
  }

  function advanceSkyUniforms(ts: number): void {
    const tv = runtime.view3dMain;
    const mesh = tv?.sky?.mesh;
    if (!tv || !mesh) return;
    if (tv.sky?.backdropTex) return;
    const u = (mesh.material as THREE.ShaderMaterial).uniforms;
    if (!u) return;
    u.uTime.value = (ts || 0) / 1000;
    u.uCloud.value = st.value.sky.cloud;
  }

  function toggleSky(enabled: boolean): void {
    st.value.sky.enabled = enabled;
    const tv = runtime.view3dMain;
    if (enabled) {
      ensureSky();
    } else if (tv) {
      disposeSky();
      tv.scene.background = new THREE.Color(0xf3f4f6);
    }
    ctx.lighting.applyMainLighting();
    if (useUiStore().ui.mainView === 'three') ctx.frame.renderView3d();
  }

  function setCloudAmount(value: number): void {
    st.value.sky.cloud = value;
  }

  function disposeSky(): void {
    const tv = runtime.view3dMain;
    if (!tv || !tv.sky) return;
    const mesh = tv.sky.mesh;
    if (mesh) {
      try { tv.scene.remove(mesh); } catch (e) { /* noop */ }
      if (mesh.geometry) { try { mesh.geometry.dispose(); } catch (e) { /* noop */ } }
      if (mesh.material) { try { (mesh.material as THREE.Material).dispose(); } catch (e) { /* noop */ } }
      tv.sky.mesh = undefined;
    }
    if (tv.sky.envRt) { try { tv.sky.envRt.dispose(); } catch (e) { /* noop */ } tv.sky.envRt = undefined; }
    // 地面归 grid group 拥有（buildGroundGrid），不随天空销毁；此处只释放天空专属资源。
    if (tv.sky.noiseTex) { try { tv.sky.noiseTex.dispose(); } catch (e) { /* noop */ } tv.sky.noiseTex = undefined; }
    if (tv.sky.backdropTex) { try { tv.sky.backdropTex.dispose(); } catch (e) { /* noop */ } tv.sky.backdropTex = undefined; }
  }

  return { ensureSky, disposeSky, applySkyQuality, advanceSkyUniforms, toggleSky, setCloudAmount, bakeSkyForReflection, ensureNoiseTexture };
}
