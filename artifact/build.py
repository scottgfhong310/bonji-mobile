#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build.py — 把 bonji-mobile 的前端組成可發佈到 Claude Artifacts 的一份。

用法：  python3 artifact/build.py            → 輸出到 artifact/dist/（不進版控）
        python3 artifact/build.py --out DIR  → 輸出到別的地方

形制照 `bonji/artifact/build.py`：**本目錄不放逐字複製件**，建置時從
`public/apps/bonji-mobile/` 現抓，差異一律以下面的 PATCHES 表達——那張表就是
「Express 版與 Artifact 版差在哪」的權威說明。
⚠️ 每一處錨點都要求**恰好命中一次**，否則 exit 1：app 那一側改了而補丁沒跟上時，
   建置會當場失敗，而不是安靜地少打一個補丁。

bonji-mobile 本來就零後端，所以 Artifact 版只差一件事：
  ① `materialize.min.css` 自己託管（vendor/）：Artifact 的 CSP 只允許 fonts.googleapis.com
     當外部樣式表來源，**cdnjs 的樣式表會被擋掉而且不報錯**（整頁沒有樣式）。
     來源 https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/css/materialize.min.css（MIT），
     與 bonji/artifact/vendor/ 那份逐位元組相同。
  （bonji 的另外四件——backend:false、downloads capability、對照表換頁、不帶 xlsx——這裡都不存在。）

⚠️ 字型：只有 Noto Sans Siddham（OFL）。`verify()` 在最後擋著：dist 裡出現別的字型檔就 exit 1。
⚠️ 已知未驗：Artifacts 版跑在宿主頁的 iframe 裡，鍵盤彈出時 iframe 自己的 visualViewport
   會不會跟著縮，**取決於宿主**，不是本 app 控制得了的（見 DESIGN.md §6）。
"""
import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent
APP = REPO / 'public' / 'apps' / 'bonji-mobile'

EXCLUDE_NAMES = {'.DS_Store'}

CDN_CSS = '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/css/materialize.min.css" />'
LOCAL_CSS = '<link rel="stylesheet" href="./materialize.min.css" />'

# (相對路徑, 舊, 新)
PATCHES = [
    ('index.html', CDN_CSS, LOCAL_CSS),
]

FONT_EXT = {'.ttf', '.otf', '.ttc', '.dfont', '.woff', '.woff2', '.eot'}
FONT_ALLOWED = {'fonts/NotoSansSiddham-Regular.woff2'}


def main():
    out = pathlib.Path(sys.argv[sys.argv.index('--out') + 1]).resolve() \
        if '--out' in sys.argv else HERE / 'dist'
    if not APP.is_dir():
        print('✗ 找不到 app 目錄：%s' % APP); return 2
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    print('輸出：%s\n' % out)

    print('① 自 app 取檔')
    n = 0
    for src in sorted(APP.rglob('*')):
        if not src.is_file() or src.name in EXCLUDE_NAMES:
            continue
        rel = src.relative_to(APP).as_posix()
        dst = out / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        n += 1
    shutil.copy2(HERE / 'vendor' / 'materialize.min.css', out / 'materialize.min.css')
    print('  ✓ %d 個檔 ＋ materialize.min.css' % n)

    print('② 補丁（每一處恰好命中一次）')
    for rel, old, new in PATCHES:
        p = out / rel
        s = p.read_text(encoding='utf-8')
        c = s.count(old)
        if c != 1:
            print('  ✗ %s：錨點命中 %d 次（應為 1）——app 那側改了而補丁沒跟上\n    %s' % (rel, c, old.splitlines()[0]))
            return 1
        p.write_text(s.replace(old, new), encoding='utf-8')
    print('  ✓ %d 處' % len(PATCHES))

    print('③ 檢查')
    bad = []
    for p in out.rglob('*'):
        rel = p.relative_to(out).as_posix()
        if p.is_file() and p.suffix.lower() in FONT_EXT and rel not in FONT_ALLOWED:
            bad.append('不可散布的字型：' + rel)
        if p.is_file() and p.suffix in {'.html', '.js', '.css'}:
            t = p.read_text(encoding='utf-8')
            if '\x00' in t:
                bad.append('含 NUL：' + rel)
            if p.suffix == '.html' and 'cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/css/' in t:
                bad.append('仍引用 cdnjs 樣式表：' + rel)
    if bad:
        for b in bad:
            print('  ✗ ' + b)
        return 1
    print('  ✓ 沒有 Noto 以外的字型、沒有 cdnjs 樣式表')

    print('\n✓ 建置完成。發佈時不需宣告任何 capability。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
