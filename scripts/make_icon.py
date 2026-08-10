#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Drone Log Analyzer 应用图标生成器。

用 Pillow 几何绘制「俯视 X 机架四旋翼」图标，过采样(SS=4)+LANCZOS 抗锯齿，
一次产出全部图标产物（覆盖现有文件）：
  - build/appicon.png       1024×1024 圆角方砖（Wails 主图标 / exe 图标源）
  - build/windows/icon.ico  多尺寸 Windows ICO（16/32/48/64/128/256，wails build 打包用）
  - meta/logo.ico           同上多尺寸 ICO（meta/app.rc 经 windres → .syso 的资源源；
                            当前 Wails 构建不编译 app.rc，但保留与新设计一致，避免遗留旧品牌）
  - frontend/public/image/logo.png + frontend/dist/image/logo.png  256×256 favicon

设计单位 U=1024，所有几何在此空间定义，渲染时 ×SS。
直接运行：  python scripts/make_icon.py
依赖：Pillow（PIL）。
"""
import math
import os

from PIL import Image, ImageDraw

# ── 画布 / 过采样 ───────────────────────────────────────────────
U = 1024          # 设计单位（正方形画布边长）
SS = 4            # 过采样倍数，最终 LANCZOS 缩回 U → 抗锯齿
S = U * SS        # 实际渲染分辨率
K = SS            # 设计坐标 → 渲染坐标 的缩放因子

# ── 圆角方砖（squircle）─────────────────────────────────────────
PAD = 64                       # 外边距
RAD = 232                      # 圆角半径（约 22.6%，接近 iOS squircle）

# ── 配色 ───────────────────────────────────────────────────────
BG_INNER  = (44, 72, 134)      # 深警色，中心偏亮（径向渐变内）
BG_OUTER  = (13, 25, 53)       # 深警色，边缘偏暗（径向渐变外）
EDGE_HI   = (120, 160, 220)    # 方砖内缘细高光
ARM       = (229, 242, 246)    # 机臂：近白冷调（深底上清晰）
ROTOR     = (45, 212, 239)     # 旋翼/电机：青
BODY      = (9, 17, 36)        # 中心机身：深藏蓝
BODY_LINE = (45, 212, 239)     # 机身描边：青
LED       = (190, 248, 255)    # 高光点：亮青白

# ── 无人机几何（设计单位）──────────────────────────────────────
C = U / 2                      # 中心
TIP = 240                      # 旋翼中心距画布中心的轴向偏移（→ 四角）
ARM_W = 70                     # 机臂粗细
ROTOR_R = 104                  # 旋翼盘外半径
RING_W = 24                    # 青环宽度（外半径 - 内半径）
HUB_R = 30                     # 旋翼中心毂半径
LED_R = 12                     # 中心/毂上的高光点半径
BODY_HW = 78                   # 中心机身半边长（→ 156×156）
BODY_R = 34                    # 中心机身圆角

TIPS = [(C - TIP, C - TIP), (C + TIP, C - TIP),
        (C - TIP, C + TIP), (C + TIP, C + TIP)]


def px(x):
    """设计单位 → 渲染像素。"""
    return x * K


def radial_gradient(size, inner, outer):
    """size×size 的径向渐变（中心 inner → 角落 outer）。小网格计算后放大，平滑且快。"""
    n = 256
    g = Image.new("RGB", (n, n))
    put = g.load()
    cx = cy = (n - 1) / 2.0
    max_r = math.hypot(cx, cy)
    for y in range(n):
        for x in range(n):
            t = min(1.0, math.hypot(x - cx, y - cy) / max_r)
            put[x, y] = tuple(int(inner[i] + (outer[i] - inner[i]) * t) for i in range(3))
    return g.resize((size, size), Image.LANCZOS)


def build_icon():
    """渲染并返回 (render_4096, final_1024) 两张 RGBA 图。"""
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # 圆角方砖 alpha 蒙版
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [px(PAD), px(PAD), px(U - PAD), px(U - PAD)], radius=px(RAD), fill=255
    )

    # 渐变背景，裁切到方砖形状（四角透明）
    grad = radial_gradient(S, BG_INNER, BG_OUTER).convert("RGBA")
    img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)

    # 方砖内缘细高光（深色背景下更挺括）
    d.rounded_rectangle(
        [px(PAD) + K, px(PAD) + K, px(U - PAD) - K, px(U - PAD) - K],
        radius=px(RAD) - K, outline=EDGE_HI + (90,), width=K * 2,
    )

    # ── 机臂（先画，被旋翼盘与机身覆盖端头）──
    for (tx, ty) in TIPS:
        d.line([(px(C), px(C)), (px(tx), px(ty))], fill=ARM + (255,), width=int(px(ARM_W)))
        cap = px(ARM_W) / 2
        d.ellipse([px(tx) - cap, px(ty) - cap, px(tx) + cap, px(ty) + cap], fill=ARM + (255,))

    # ── 旋翼/电机（青环 + 深毂面 + 青心 + 高光点）──
    inner_r = ROTOR_R - RING_W
    for (tx, ty) in TIPS:
        d.ellipse([px(tx) - px(ROTOR_R), px(ty) - px(ROTOR_R),
                   px(tx) + px(ROTOR_R), px(ty) + px(ROTOR_R)], fill=ROTOR + (255,))
        d.ellipse([px(tx) - px(inner_r), px(ty) - px(inner_r),
                   px(tx) + px(inner_r), px(ty) + px(inner_r)], fill=BODY + (255,))
        d.ellipse([px(tx) - px(HUB_R), px(ty) - px(HUB_R),
                   px(tx) + px(HUB_R), px(ty) + px(HUB_R)], fill=ROTOR + (255,))
        d.ellipse([px(tx) - px(LED_R), px(ty) - px(LED_R),
                   px(tx) + px(LED_R), px(ty) + px(LED_R)], fill=LED + (255,))

    # ── 中心机身 + 高光点 ──
    b0, b1 = px(C - BODY_HW), px(C + BODY_HW)
    d.rounded_rectangle([b0, b0, b1, b1], radius=px(BODY_R),
                        fill=BODY + (255,), outline=BODY_LINE + (255,), width=int(px(6)))
    d.ellipse([px(C) - px(LED_R), px(C) - px(LED_R),
               px(C) + px(LED_R), px(C) + px(LED_R)], fill=LED + (255,))

    final = img.resize((U, U), Image.LANCZOS)
    return img, final


def main():
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    render, final = build_icon()

    # 1) Wails 主图标（1024×1024 RGBA PNG）
    appicon = os.path.join(repo, "build", "appicon.png")
    final.save(appicon)

    # 2) Windows 多尺寸 ICO（Pillow 按 sizes 从 1024 源逐级缩放）
    ico_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
    ico = os.path.join(repo, "build", "windows", "icon.ico")
    final.save(ico, format="ICO", sizes=ico_sizes)

    # 2b) meta/logo.ico —— meta/app.rc 的资源源（windres → syso 路径，当前 Wails 构建未启用，
    #     但保持与新设计一致，避免仓库里残留旧「APM」品牌图标）
    meta_ico = os.path.join(repo, "meta", "logo.ico")
    os.makedirs(os.path.dirname(meta_ico), exist_ok=True)
    final.save(meta_ico, format="ICO", sizes=ico_sizes)

    # 3) 前端 favicon（256×256），同步 public/ 源与 dist/ 构建副本
    logo = render.resize((256, 256), Image.LANCZOS)
    pub_logo = os.path.join(repo, "frontend", "public", "image", "logo.png")
    logo.save(pub_logo)
    dist_logo = os.path.join(repo, "frontend", "dist", "image", "logo.png")
    if os.path.isdir(os.path.dirname(dist_logo)):
        logo.save(dist_logo)

    print("icon generated:")
    print("  ", appicon)
    print("  ", ico)
    print("  ", meta_ico)
    print("  ", pub_logo, "(+ dist copy)")


if __name__ == "__main__":
    main()
