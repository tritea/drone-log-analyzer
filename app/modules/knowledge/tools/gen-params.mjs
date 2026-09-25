// gen-params.mjs — 从官方参数文档 HTML 生成参数知识库 JSON。
// 用法：node app/modules/knowledge/tools/gen-params.mjs <下载的html目录>
// 输入（需先 curl 到本地）：
//   copter.html / plane.html / rover.html / sub.html  (ardupilot.org/<veh>/docs/parameters.html)
//   px4.html                                           (docs.px4.io .../parameter_reference.html)
// 输出：formats/apm-params.json、formats/ulog-params.json（相对 knowledge 模块根）
import fs from 'node:fs';
import path from 'node:path';

const inDir = process.argv[2];
if (!inDir) {
  console.error('usage: node gen-params.mjs <paramdocs-dir>');
  process.exit(1);
}
const outDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

const read = (f) => fs.readFileSync(path.join(inDir, f), 'utf-8');

// ---------- HTML 工具 ----------
const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
const strip = (s) => decode(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/** 抽取一段 HTML 里所有 <p> 文本（先剔除表格/行块，避免混入 Range/Values 单元格文字） */
function paraTexts(html) {
  const clean = html.replace(/<table[\s\S]*?<\/table>/g, '').replace(/<div class="line-block">[\s\S]*?<\/div>/g, '');
  const out = [];
  for (const m of clean.matchAll(/<p>([\s\S]*?)<\/p>/g)) {
    const t = strip(m[1]);
    if (t && !t.startsWith('Note:')) out.push(t);
  }
  return out;
}

/** 解析一个 <table>：返回 {header:[...], rows:[[...]]}（就近匹配标签文本） */
function parseTable(tableHtml) {
  const thead = tableHtml.match(/<thead>([\s\S]*?)<\/thead>/);
  if (!thead) return null;
  const headers = [...thead[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => strip(m[1]));
  const tbody = tableHtml.match(/<tbody>([\s\S]*?)<\/tbody>/);
  const rows = [];
  if (tbody) {
    for (const r of tbody[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      rows.push([...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1])));
    }
  }
  return { headers, rows };
}

const num = (s) => {
  if (s == null) return undefined;
  const v = Number(String(s).trim());
  return Number.isFinite(v) ? v : undefined;
};

// ---------- ArduPilot 解析 ----------
function parseApm(html) {
  const params = {};
  // h3 内含 <a class="headerlink"> 锚点，标题捕获到 '<' 为止，尾部懒匹配到 </h3>。
  const h3s = [...html.matchAll(/<h3>([A-Z][A-Z0-9_]{2,}):\s*([^<]*)[\s\S]*?<\/h3>/g)];
  for (let i = 0; i < h3s.length; i++) {
    const m = h3s[i];
    const name = m[1];
    const title = strip(m[2]);
    const bodyStart = m.index + m[0].length;
    const bodyEnd = i + 1 < h3s.length ? h3s[i + 1].index : html.length;
    const body = html.slice(bodyStart, bodyEnd);

    const paras = paraTexts(body);
    const entry = { d: title };
    if (paras.length > 0 && paras[0] !== title) {
      const long = paras.join(' ').slice(0, 220);
      if (long && long !== title) entry.D = long;
    }

    // APM 表头组合：Increment|Range|Units 或 Values/Bitmask 枚举。
    const tables = [...body.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)].map((t) => parseTable(t[0]));
    for (const t of tables) {
      if (!t) continue;
      const hset = t.headers.map((h) => h.toLowerCase()).join('|');
      if (hset.includes('range') && t.rows.length > 0) {
        const idx = (label) => t.headers.findIndex((h) => h.toLowerCase() === label);
        const r = t.rows[0];
        if (idx('range') >= 0) {
          const rm = String(r[idx('range')] || '').match(/^(-?[\d.]+)\s*(?:to|-|–)\s*(-?[\d.]+)$/);
          if (rm) {
            entry.rmin = num(rm[1]);
            entry.rmax = num(rm[2]);
          }
        }
        if (idx('units') >= 0 && r[idx('units')]) entry.u = r[idx('units')];
      } else if (hset.includes('value') && hset.includes('meaning')) {
        const vi = t.headers.findIndex((h) => h.toLowerCase() === 'value');
        const mi = t.headers.findIndex((h) => h.toLowerCase() === 'meaning');
        const vals = [];
        for (const r of t.rows.slice(0, 24)) {
          if (r[vi] !== '' && r[mi]) vals.push(`${r[vi]}: ${r[mi]}`);
        }
        if (vals.length) entry.v = vals;
      } else if (hset.includes('bit') && t.rows.length > 0) {
        // Bitmask：Bit|Description 行。
        const vals = [];
        for (const r of t.rows.slice(0, 16)) {
          if (r.length >= 2 && r[1]) vals.push(`bit${r[0]}: ${r[1]}`);
        }
        if (vals.length && !entry.v) entry.v = vals;
      }
    }
    params[name] = entry;
  }
  return params;
}

// ---------- PX4 解析 ----------
function parsePx4(html) {
  const params = {};
  const h3s = [...html.matchAll(/<h3 id="([A-Z][A-Z0-9_]+)"/g)];
  for (let i = 0; i < h3s.length; i++) {
    const m = h3s[i];
    const name = m[1];
    const bodyStart = m.index + m[0].length;
    const nextH3 = html.indexOf('<h3 id=', bodyStart);
    const body = html.slice(bodyStart, nextH3 < 0 ? html.length : nextH3);

    const paras = paraTexts(body);
    if (paras.length === 0) continue;
    const entry = { d: paras[0].slice(0, 120) };
    if (paras.length > 1) {
      const long = paras.slice(1).join(' ').slice(0, 220);
      if (long) entry.D = long;
    }
    const table = body.match(/<table[^>]*>([\s\S]*?)<\/table>/);
    const t = table && parseTable(table[0]);
    if (t) {
      const idx = (label) => t.headers.findIndex((h) => h.toLowerCase() === label);
      const r = t.rows[0] || [];
      const lower = (i) => (i >= 0 ? String(r[i] || '').toLowerCase() : '');
      if (idx('minvalue') >= 0) entry.rmin = num(r[idx('minvalue')]);
      if (idx('maxvalue') >= 0 && lower(idx('maxvalue')) !== 'int32_max' && r[idx('maxvalue')]) {
        entry.rmax = num(r[idx('maxvalue')]);
      }
      if (idx('default') >= 0 && r[idx('default')] !== '') entry.def = num(r[idx('default')]);
      if (idx('unit') >= 0 && r[idx('unit')]) entry.u = r[idx('unit')];
    }
    params[name] = entry;
  }
  return params;
}

// ---------- 机型归类 ----------
const VEH_CLASS = {
  copter: ['multirotor', 'helicopter', 'vtol'],
  plane: ['fixedwing', 'vtol'],
  rover: ['rover', 'boat'],
  sub: ['sub'],
};

function buildApm(docsDir) {
  const merged = {};
  for (const veh of ['copter', 'plane', 'rover', 'sub']) {
    const parsed = parseApm(read(`${veh}.html`));
    for (const [name, e] of Object.entries(parsed)) {
      if (merged[name]) {
        const t = merged[name];
        t.ap = [...new Set([...t.ap, ...VEH_CLASS[veh]])];
        for (const k of ['D', 'u', 'rmin', 'rmax', 'v']) {
          if (t[k] == null && e[k] != null) t[k] = e[k];
        }
      } else {
        merged[name] = { ...e, ap: [...VEH_CLASS[veh]] };
      }
    }
  }
  // 前缀级机型修正：H_*（直升机）与 Q_*（QuadPlane VTOL）。
  for (const [name, e] of Object.entries(merged)) {
    if (name.startsWith('H_') || name.startsWith('QR_')) e.ap = ['helicopter'];
    else if (name.startsWith('Q_')) e.ap = ['vtol'];
  }
  return merged;
}

function buildPx4() {
  const params = parsePx4(read('px4.html'));
  for (const [name, e] of Object.entries(params)) {
    let ap;
    if (/^FW/.test(name)) ap = ['fixedwing', 'vtol'];
    else if (/^(MC|MPC|MCY)/.test(name)) ap = ['multirotor', 'vtol'];
    else if (/^VT/.test(name)) ap = ['vtol'];
    if (ap) e.ap = ap;
  }
  return params;
}

// ---------- 前缀组知识（手工策展：作用 + 影响域） ----------
const APM_GROUPS = {
  ARM: { description: '解锁检查与安全开关', affects: ['safety', 'arming'] },
  ATC: { description: '姿态控制（角度/速率 PID 与限制）', affects: ['attitude', 'stability'] },
  AUTOTUNE: { description: '自动调参行为', affects: ['tuning'] },
  AVD: { description: 'ADS-B 避让', affects: ['avoidance'] },
  BARO: { description: '气压计', affects: ['altitude'] },
  BATT: { description: '电池监测与失效保护阈值', affects: ['power', 'safety'] },
  BRD: { description: '板载硬件配置', affects: ['system'] },
  CAM: { description: '相机/快门控制', affects: ['payload'] },
  CAN: { description: 'DroneCAN 总线', affects: ['system'] },
  CHUTE: { description: '降落伞', affects: ['safety'] },
  CIRCLE: { description: '绕圈模式', affects: ['navigation'] },
  COMPASS: { description: '罗盘（偏置/使用/阈值）', affects: ['heading'] },
  CRUISE: { description: '巡航速度学习', affects: ['navigation'] },
  EK2: { description: 'EKF2 估计器', affects: ['ekf'] },
  EK3: { description: 'EKF3 估计器（源/门限/开关）', affects: ['ekf'] },
  ESC: { description: '电调', affects: ['power', 'throttle'] },
  FENCE: { description: '电子围栏', affects: ['safety', 'navigation'] },
  FLTMODE: { description: '飞行模式通道映射', affects: ['control'] },
  FOLL: { description: '跟随模式', affects: ['navigation'] },
  GPS: { description: 'GPS 类型与配置', affects: ['position'] },
  GUID: { description: 'Guided 模式', affects: ['navigation'] },
  H: { description: '直升机（传统旋翼头）专属', affects: ['helicopter'] },
  INS: { description: 'IMU/滤波/陷波器', affects: ['vibration', 'attitude'] },
  LAND: { description: '自动着陆', affects: ['landing'] },
  LOG: { description: '日志记录', affects: ['system'] },
  LOIT: { description: '留待（Loiter）参数', affects: ['navigation'] },
  LIM: { description: '固定翼飞行包线限制', affects: ['safety'] },
  MIS: { description: '任务（航点）行为', affects: ['mission'] },
  MOT: { description: '电机/推力（悬停油门/指数/矢量）', affects: ['throttle', 'power'] },
  MNT: { description: '云台', affects: ['payload'] },
  NTF: { description: '通知（蜂鸣器/LED）', affects: ['system'] },
  OA: { description: '障碍规避', affects: ['avoidance'] },
  OSD: { description: '图传 OSD', affects: ['system'] },
  PILOT: { description: '摇杆输入行为', affects: ['control'] },
  PLND: { description: '精准着陆', affects: ['landing'] },
  PRX: { description: '接近传感器', affects: ['avoidance'] },
  Q: { description: 'QuadPlane（垂起固定翼）多旋翼部分', affects: ['vtol'] },
  RNGFND: { description: '测距仪', affects: ['altitude', 'landing'] },
  RC: { description: '遥控接收机映射与失效保护', affects: ['control', 'safety'] },
  RLL: { description: '固定翼横滚控制', affects: ['attitude'] },
  RPM: { description: '转速传感器', affects: ['power'] },
  SAIL: { description: '帆船', affects: ['boat'] },
  SERVO: { description: '舵机通道功能与行程', affects: ['control'] },
  SR: { description: '遥测串口流率', affects: ['link'] },
  SYSID: { description: 'MAVLink 系统/组件 ID', affects: ['link'] },
  TEC: { description: '固定翼 TECS 高度/速度控制', affects: ['altitude', 'airspeed'] },
  THROW: { description: '抛飞模式', affects: ['launch'] },
  TKOFF: { description: '自动起飞', affects: ['launch'] },
  VISO: { description: '视觉里程计', affects: ['position'] },
  VTX: { description: '图传', affects: ['link'] },
  WPNAV: { description: '航点导航（速度/加速度）', affects: ['navigation'] },
  WENC: { description: '轮式里程计（Rover）', affects: ['position'] },
};
const PX4_GROUPS = {
  BAT: { description: '电池与失效保护', affects: ['power', 'safety'] },
  CAL: { description: '传感器校准', affects: ['calibration'] },
  COM: { description: '系统命令/解锁/失效保护', affects: ['safety', 'system'] },
  EKF2: { description: 'EKF2 估计器', affects: ['ekf'] },
  FW: { description: '固定翼控制器', affects: ['attitude', 'airspeed'] },
  GNSS: { description: 'GNSS 接收机', affects: ['position'] },
  LAND: { description: '着陆', affects: ['landing'] },
  LNDMC: { description: '多旋翼着陆检测', affects: ['landing'] },
  MC: { description: '多旋翼姿态/速率控制', affects: ['attitude', 'stability'] },
  MPC: { description: '多旋翼位置控制', affects: ['navigation'] },
  NAV: { description: '导航/RTL 失效保护', affects: ['navigation', 'safety'] },
  RC: { description: '遥控输入', affects: ['control'] },
  RTL: { description: '返航', affects: ['navigation'] },
  SENS: { description: '外接传感器（气压/磁力计）', affects: ['calibration'] },
  SYS: { description: '系统配置', affects: ['system'] },
  VT: { description: '垂起（VTOL）专属', affects: ['vtol'] },
  UAVCAN: { description: 'DroneCAN', affects: ['system'] },
};

// ---------- 汇总输出 ----------
function emit(file, format, groups, params) {
  const kb = { format, version: 1, groups, params };
  const out = path.join(outDir, 'formats', file);
  fs.writeFileSync(out, JSON.stringify(kb));
  console.error(`${file}: ${Object.keys(params).length} params, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}

emit('apm-params.json', 'apm', APM_GROUPS, buildApm());
emit('ulog-params.json', 'ulog', PX4_GROUPS, buildPx4());
