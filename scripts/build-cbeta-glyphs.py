#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build-cbeta-glyphs.py — CBETA 悉曇字型（Siddham.ttf，字族 `Siddam`）的上接續／下接續字形 → 一份 SVG sprite。

用法：  python3 scripts/build-cbeta-glyphs.py                 → 寫出 public/apps/bonji-mobile/cbeta/cbeta-ligatures.svg
        python3 scripts/build-cbeta-glyphs.py --font PATH     → 指定字型檔（預設見 FONT_CANDIDATES）
        python3 scripts/build-cbeta-glyphs.py --check         → 不寫；印出會產生幾個字形、有沒有缺字

⚠️⚠️ **產物不進 GitHub**〔owner 2026-10-09〕：SVG 路徑就是字型外框的複製，而這支字型**沒有再散布的授權**
   （家族「CBETA 悉曇字型不隨 repo 散布」）。owner 的決定是：**SVG 只放進 Artifacts 版（private）**，
   本 repo 是 public ⇒ `cbeta/` 由 `.gitignore` 擋掉、`verify.js` 第 ㉕ 條確認它沒被追蹤。
   InProgress 鏡像（3001，不在版控）也會帶著它——那裡本來就以 HTTP 提供這支字型。
   **本腳本可以公開**：它不含任何字形資料，要在本機有那支字型才跑得出東西。

哪些字：`data/element-catalog.json`（bonji 的複製件，由 db_siddham 匯出）裡 Cbeta 群的
`ligature_u`（上接續）與 `ligature_l`（下接續）——每格一個 CJK 碼位，在 Siddam 字型裡畫成悉曇部件。

做法（Python 標準函式庫，無 fontTools）：cmap format 4 → loca／glyf（簡單字形＋複合字形）→
TrueType 二次曲線轉 SVG path（相鄰兩個 off-curve 點之間補隱含的 on-curve 中點）。
**保留整個 em 方框**（viewBox 高 ＝ ascender − descender）：上接續畫在上方、下接續畫在下方，
部件的位置本身就是資訊，裁到外框會把它丟掉。y 軸翻轉：SVG y ＝ ascender − 字型 y。
"""
import json
import pathlib
import struct
import sys
import hashlib

REPO = pathlib.Path(__file__).resolve().parent.parent
APP = REPO / 'public' / 'apps' / 'bonji-mobile'
ELEMENTS = APP / 'data' / 'element-catalog.json'
OUT = APP / 'cbeta' / 'cbeta-ligatures.svg'
FONT_CANDIDATES = [
    REPO.parent.parent / 'InProgress' / 'public' / 'lib' / 'fonts' / 'Siddham.ttf',   # v2.00 ＝ tb_font 的 authority
]
CATS = ('ligature_u', 'ligature_l')


class Font:
    def __init__(self, data):
        self.d = data
        n = struct.unpack('>H', data[4:6])[0]
        self.t = {}
        for i in range(n):
            tag, _, off, ln = struct.unpack('>4sIII', data[12 + 16 * i:28 + 16 * i])
            self.t[tag.decode('latin-1')] = (off, ln)
        if 'glyf' not in self.t:
            raise SystemExit('✗ 不是 TrueType（沒有 glyf 表）')
        h = self.t['head'][0]
        self.upem = struct.unpack('>H', data[h + 18:h + 20])[0]
        self.long_loca = struct.unpack('>h', data[h + 50:h + 52])[0] == 1
        hh = self.t['hhea'][0]
        self.asc, self.desc = struct.unpack('>hh', data[hh + 4:hh + 8])
        self.n_hmetrics = struct.unpack('>H', data[hh + 34:hh + 36])[0]
        self.cmap = self._cmap4()

    def name(self, nid):
        o = self.t['name'][0]
        cnt, so = struct.unpack('>HH', self.d[o + 2:o + 6])
        for i in range(cnt):
            pid, _, _, n, ln, off = struct.unpack('>HHHHHH', self.d[o + 6 + 12 * i:o + 18 + 12 * i])
            if n == nid and pid == 3:
                return self.d[o + so + off:o + so + off + ln].decode('utf-16-be')
        return ''

    def _cmap4(self):
        o = self.t['cmap'][0]
        nsub = struct.unpack('>H', self.d[o + 2:o + 4])[0]
        for i in range(nsub):
            pid, eid, sub = struct.unpack('>HHI', self.d[o + 4 + 8 * i:o + 12 + 8 * i])
            if (pid, eid) == (3, 1) and struct.unpack('>H', self.d[o + sub:o + sub + 2])[0] == 4:
                return self._parse4(o + sub)
        raise SystemExit('✗ 找不到 (3,1) format 4 的 cmap')

    def _parse4(self, p):
        d = self.d
        segx2 = struct.unpack('>H', d[p + 6:p + 8])[0]
        seg = segx2 // 2
        ends = struct.unpack('>%dH' % seg, d[p + 14:p + 14 + segx2])
        starts = struct.unpack('>%dH' % seg, d[p + 16 + segx2:p + 16 + 2 * segx2])
        deltas = struct.unpack('>%dh' % seg, d[p + 16 + 2 * segx2:p + 16 + 3 * segx2])
        ro_pos = p + 16 + 3 * segx2
        ros = struct.unpack('>%dH' % seg, d[ro_pos:ro_pos + segx2])
        m = {}
        for i in range(seg):
            for c in range(starts[i], ends[i] + 1):
                if c == 0xFFFF:
                    continue
                if ros[i] == 0:
                    g = (c + deltas[i]) & 0xFFFF
                else:
                    a = ro_pos + 2 * i + ros[i] + 2 * (c - starts[i])
                    g = struct.unpack('>H', d[a:a + 2])[0]
                    if g:
                        g = (g + deltas[i]) & 0xFFFF
                if g:
                    m[c] = g
        return m

    def advance(self, gid):
        o = self.t['hmtx'][0]
        i = min(gid, self.n_hmetrics - 1)
        return struct.unpack('>H', self.d[o + 4 * i:o + 4 * i + 2])[0]

    def _glyph_range(self, gid):
        o = self.t['loca'][0]
        if self.long_loca:
            a, b = struct.unpack('>II', self.d[o + 4 * gid:o + 4 * gid + 8])
        else:
            a, b = struct.unpack('>HH', self.d[o + 2 * gid:o + 2 * gid + 4])
            a, b = a * 2, b * 2
        g = self.t['glyf'][0]
        return g + a, b - a

    def contours(self, gid, depth=0):
        """回傳 [[(x, y, on), …], …]（字型座標）。"""
        if depth > 8:
            raise SystemExit('✗ 複合字形巢狀過深（gid %d）' % gid)
        p, ln = self._glyph_range(gid)
        if ln == 0:
            return []
        d = self.d
        nc = struct.unpack('>h', d[p:p + 2])[0]
        if nc >= 0:
            return self._simple(p, nc)
        return self._composite(p, depth)

    def _simple(self, p, nc):
        d = self.d
        q = p + 10
        ends = struct.unpack('>%dH' % nc, d[q:q + 2 * nc]); q += 2 * nc
        ilen = struct.unpack('>H', d[q:q + 2])[0]; q += 2 + ilen
        npts = ends[-1] + 1 if nc else 0
        flags = []
        while len(flags) < npts:
            f = d[q]; q += 1
            flags.append(f)
            if f & 8:
                r = d[q]; q += 1
                flags.extend([f] * r)
        flags = flags[:npts]

        def coords(short_bit, same_bit):
            nonlocal q
            v, out = 0, []
            for f in flags:
                if f & short_bit:
                    dv = d[q]; q += 1
                    v += dv if f & same_bit else -dv
                elif not (f & same_bit):
                    v += struct.unpack('>h', d[q:q + 2])[0]; q += 2
                out.append(v)
            return out
        xs = coords(2, 16)
        ys = coords(4, 32)
        res, s = [], 0
        for e in ends:
            res.append([(xs[i], ys[i], bool(flags[i] & 1)) for i in range(s, e + 1)])
            s = e + 1
        return res

    def _composite(self, p, depth):
        d = self.d
        q = p + 10
        out = []
        while True:
            flags, gi = struct.unpack('>HH', d[q:q + 4]); q += 4
            if flags & 1:
                a1, a2 = struct.unpack('>hh', d[q:q + 4]); q += 4
            else:
                a1, a2 = struct.unpack('>bb', d[q:q + 2]); q += 2
            if not (flags & 2):
                raise SystemExit('✗ 複合字形用點對齊（ARGS_ARE_XY_VALUES=0），本腳本未實作')
            a = b = c = dd = 1.0; b = c = 0.0
            if flags & 8:
                a = dd = struct.unpack('>h', d[q:q + 2])[0] / 16384.0; q += 2
            elif flags & 0x40:
                a, dd = [v / 16384.0 for v in struct.unpack('>hh', d[q:q + 4])]; q += 4
            elif flags & 0x80:
                a, b, c, dd = [v / 16384.0 for v in struct.unpack('>hhhh', d[q:q + 8])]; q += 8
            for ct in self.contours(gi, depth + 1):
                out.append([(a * x + c * y + a1, b * x + dd * y + a2, on) for x, y, on in ct])
            if not (flags & 0x20):
                break
        return out


def path_of(contours, asc):
    def P(x, y):
        return '%s %s' % (fmt(x), fmt(asc - y))
    parts = []
    for ct in contours:
        if not ct:
            continue
        pts = list(ct)
        # 起點：找一個 on-curve；全是 off-curve 時用頭兩點的中點
        k = next((i for i, p in enumerate(pts) if p[2]), None)
        if k is None:
            x0, y0, _ = pts[0]; x1, y1, _ = pts[1]
            pts.insert(0, ((x0 + x1) / 2, (y0 + y1) / 2, True)); k = 0
        pts = pts[k:] + pts[:k]
        sx, sy, _ = pts[0]
        seg = ['M' + P(sx, sy)]
        i, n = 1, len(pts)
        pending = None
        for j in range(1, n + 1):
            x, y, on = pts[j % n] if j < n else (sx, sy, True)
            if on:
                seg.append(('Q' + P(*pending) + ' ' + P(x, y)) if pending else ('L' + P(x, y)))
                pending = None
            else:
                if pending:
                    mx, my = (pending[0] + x) / 2, (pending[1] + y) / 2
                    seg.append('Q' + P(*pending) + ' ' + P(mx, my))
                pending = (x, y)
        seg.append('Z')
        parts.append(''.join(seg))
    return ''.join(parts)


def fmt(v):
    r = round(v, 2)
    return str(int(r)) if r == int(r) else ('%.2f' % r).rstrip('0').rstrip('.')


def main():
    argv = sys.argv[1:]
    font_path = None
    if '--font' in argv:
        font_path = pathlib.Path(argv[argv.index('--font') + 1])
    unknown = [a for i, a in enumerate(argv) if a not in ('--check', '--font') and not (i and argv[i - 1] == '--font')]
    if unknown:
        print('✗ 未知旗標：%s' % ' '.join(unknown)); return 2
    if font_path is None:
        font_path = next((p for p in FONT_CANDIDATES if p.exists()), None)
    if not font_path or not font_path.exists():
        print('✗ 找不到 CBETA 悉曇字型（Siddham.ttf）。本機沒有這支字型就產生不出來——那是刻意的：它不隨 repo 散布。')
        return 2
    raw = font_path.read_bytes()
    f = Font(raw)
    fam, ver = f.name(1), f.name(5)
    if fam != 'Siddam':
        print('✗ 字族是 %r，不是 Siddam' % fam); return 2
    el = json.loads(ELEMENTS.read_text(encoding='utf-8'))
    grp = next(g for g in el['groups'] if g['id'] == 'cbeta')
    chars = []
    for c in grp['categories']:
        if c['id'] in CATS:
            chars += [e['char'] for e in c['entries'] if e.get('char')]
    seen, uniq = set(), []
    for ch in chars:
        if ch not in seen:
            seen.add(ch); uniq.append(ch)
    missing = [ch for ch in uniq if ord(ch) not in f.cmap]
    empty = []
    H = f.asc - f.desc
    syms = []
    for ch in uniq:
        if ch in missing:
            continue
        gid = f.cmap[ord(ch)]
        d = path_of(f.contours(gid), f.asc)
        if not d:
            empty.append(ch); continue
        adv = f.advance(gid) or f.upem
        syms.append('<symbol id="cb-%x" viewBox="0 0 %d %d"><path d="%s"/></symbol>' % (ord(ch), adv, H, d))
    print('字型：%s（%s）md5 %s' % (font_path, ver, hashlib.md5(raw).hexdigest()))
    print('上接續＋下接續：%d 格／%d 個相異字形；產出 %d 個 symbol；缺字 %d；空字形 %d'
          % (len(chars), len(uniq), len(syms), len(missing), len(empty)))
    if missing or empty:
        print('✗ 缺字：%s　空字形：%s' % (' '.join('U+%04X' % ord(c) for c in missing), ' '.join('U+%04X' % ord(c) for c in empty)))
        return 1
    if '--check' in argv:
        return 0
    head = ('<!-- 由 scripts/build-cbeta-glyphs.py 自 CBETA %s（%s，md5 %s）產生。\n'
            '     ⚠️ 字形外框的複製；這支字型沒有再散布的授權 ⇒ 不進 GitHub，只隨 Artifacts 版（private）與 InProgress 鏡像。 -->\n'
            % (fam, ver, hashlib.md5(raw).hexdigest()))
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n' + head + '\n'.join(syms) + '\n</svg>\n')
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(svg, encoding='utf-8')
    print('✓ 寫出 %s（%d bytes）' % (OUT.relative_to(REPO), len(svg.encode('utf-8'))))
    return 0


if __name__ == '__main__':
    sys.exit(main())
