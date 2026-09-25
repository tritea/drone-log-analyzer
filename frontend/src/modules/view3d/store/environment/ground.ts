import * as THREE from 'three';
import { runtime } from '@/modules/shared/runtime';
import { useUiStore } from '@/modules/shared/ui-store';
import type { GroundApi, View3dStoreCtx } from '../types';

export function createGround(ctx: View3dStoreCtx): GroundApi {
  const st = ctx.state;

  // 地面网格：反走样网格 shader（fwidth 线宽 + 远处淡出），一次性构建、按轨迹半径整体缩放。
  function buildGroundGrid(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'view3d-grid';
    const SIZE = 240;

    const gridMat = new THREE.ShaderMaterial({
      uniforms: {
        uBaseColor: { value: new THREE.Color(0xeaeef2) },
        uMinorColor: { value: new THREE.Color(0x707880) },
        uMajorColor: { value: new THREE.Color(0x4a5260) },
        uMinorScale: { value: 240 },
        uMajorScale: { value: 48 },
        uMinorOpacity: { value: 0.35 },
        uMajorOpacity: { value: 0.9 },
      },
      vertexShader: [
        'varying vec2 vUv;',
        'void main() {',
        '  vUv = uv;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}',
      ].join('\n'),
      fragmentShader: [
        'varying vec2 vUv;',
        'uniform vec3 uBaseColor;',
        'uniform vec3 uMinorColor;',
        'uniform vec3 uMajorColor;',
        'uniform float uMinorScale;',
        'uniform float uMajorScale;',
        'uniform float uMinorOpacity;',
        'uniform float uMajorOpacity;',
        'float lineAxis(float c) { return 1.0 - min(abs(fract(c - 0.5) - 0.5) / fwidth(c), 1.0); }',
        'void main() {',
        '  float minorLine = max(lineAxis(vUv.x * uMinorScale), lineAxis(vUv.y * uMinorScale));',
        '  float majorLine = max(lineAxis(vUv.x * uMajorScale), lineAxis(vUv.y * uMajorScale));',
        '  float minorDeriv = max(fwidth(vUv.x * uMinorScale), fwidth(vUv.y * uMinorScale));',
        '  minorLine *= 1.0 - smoothstep(1.0, 2.5, minorDeriv);',
        '  vec3 col = uBaseColor;',
        '  col = mix(col, uMinorColor, minorLine * uMinorOpacity);',
        '  col = mix(col, uMajorColor, majorLine * uMajorOpacity);',
        '  gl_FragColor = vec4(col, 1.0);',
        '}',
      ].join('\n'),
      transparent: false,
      depthWrite: true,
      side: THREE.FrontSide,
      fog: false,
      toneMapped: false,
      extensions: { derivatives: true },
    });

    const plane = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), gridMat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 0;
    plane.renderOrder = 2;           // 地面在水面(1)之后绘制：画家算法盖掉重叠区（水面不写深度，见 water.ts）
    plane.name = 'view3d-ground';
    plane.visible = st.value.ground.show;
    group.add(plane);
    const tv = runtime.view3dMain;
    if (tv) tv.ground = plane;

    return group;
  }

  function toggleGround(show: boolean): void {
    st.value.ground.show = show;
    const tv = runtime.view3dMain;
    if (tv && tv.ground) tv.ground.visible = show;
    if (useUiStore().ui.mainView === 'three') ctx.frame.renderView3d();
  }

  return { buildGroundGrid, toggleGround };
}
