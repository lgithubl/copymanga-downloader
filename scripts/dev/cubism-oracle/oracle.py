#!/usr/bin/env python3
"""用真正的 Cubism Core 当「标准答案」，核对 web/static/gal-moc3.js 的求值（顶点 / 绘制顺序 / 不透明度）。

Core 是游戏自带的：KiriKiri 的 plugin/krkrlive2d.dll 里静态链接了一份 32 位 x86 的 Cubism Core（csm* 函数，名字在错误信息的字符串里），
这里用 unicorn 模拟器直接执行它：csmReviveMocInPlace → csmInitializeModelInPlace → 写参数 → csmUpdateModel → 读结果。
Core 的 DLL 和 moc3 都是游戏文件，不进仓库；脚本只靠命令行参数。

  pip install pefile unicorn
  python3 oracle.py --dll <krkrlive2d.dll> --moc <xxx.moc3> [--seed 1] [--n 40]

输出：顶点位置（JS 的 y 轴和 Core 相反，比较时取反）/ 绘制顺序 / 不透明度的不一致个数；全是 0 才算对得上。
"""
import argparse, json, os, re, struct, subprocess, sys, tempfile
import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE, UcError
from unicorn.x86_const import UC_X86_REG_ESP, UC_X86_REG_EIP, UC_X86_REG_EAX

HERE = os.path.dirname(os.path.abspath(__file__))
API = ['csmReviveMocInPlace', 'csmGetSizeofModel', 'csmInitializeModelInPlace', 'csmUpdateModel', 'csmGetParameterCount', 'csmGetParameterValues',
       'csmGetParameterDefaultValues', 'csmGetDrawableCount', 'csmGetDrawableRenderOrders', 'csmGetDrawableOpacities', 'csmGetDrawableVertexCounts',
       'csmGetDrawableVertexPositions', 'csmGetDrawableDynamicFlags']
ARGC = {'HeapCreate': 3, 'HeapDestroy': 1, 'HeapAlloc': 3, 'HeapFree': 3, 'HeapReAlloc': 4, 'HeapCompact': 2, 'HeapSetInformation': 4, 'GlobalMemoryStatusEx': 1,
        'OutputDebugStringA': 1, 'FreeConsole': 0, 'AttachConsole': 1, 'GetProcAddress': 2, 'EnterCriticalSection': 1, 'LeaveCriticalSection': 1,
        'DeleteCriticalSection': 1, 'GetLastError': 0, 'SetLastError': 1, 'GetCurrentThreadId': 0, 'GetCurrentProcess': 0, 'GetCurrentProcessId': 0,
        'IsDebuggerPresent': 0, 'QueryPerformanceCounter': 1, 'GetSystemTimeAsFileTime': 1, 'GetModuleHandleW': 1, 'GetModuleHandleExA': 3,
        'GetModuleHandleExW': 3, 'MultiByteToWideChar': 6, 'EncodePointer': 1, 'DecodePointer': 1, 'TlsAlloc': 0, 'TlsGetValue': 1, 'TlsSetValue': 2,
        'TlsFree': 1, 'InitializeCriticalSectionAndSpinCount': 2, 'IsProcessorFeaturePresent': 1, 'WriteConsoleW': 5, 'CloseHandle': 1, 'FreeLibrary': 1}


class Core:
    def __init__(self, dll):
        self.pe = pefile.PE(dll)
        self.base = self.pe.OPTIONAL_HEADER.ImageBase
        self.data = bytes(self.pe.get_memory_mapped_image())
        self.uc = Uc(UC_ARCH_X86, UC_MODE_32)
        self.uc.mem_map(self.base, (self.pe.OPTIONAL_HEADER.SizeOfImage + 0xfff) & ~0xfff)
        self.uc.mem_write(self.base, self.data)
        self.STACK = 0x70000000; self.uc.mem_map(self.STACK, 0x100000)
        self.HEAP = 0x40000000; self.uc.mem_map(self.HEAP, 0x4000000); self.heap_ptr = self.HEAP
        self.uc.mem_map(0x7ff00000, 0x10000); self.RET = 0x7ff00100; self.uc.mem_write(self.RET, b'\xf4')
        self.addr = {n: self.find_api(n) for n in API}
        self.setup_imports()

    def find_api(self, name):   # 名字字符串 → 引用它的位置 → 往回找到函数头（上一段 int3 填充之后）
        needle = name.encode()
        for m in re.finditer(re.escape(needle), self.data):
            if self.data[m.start() - 1] != 0: continue
            va = self.base + m.start()
            for x in re.finditer(re.escape(struct.pack('<I', va)), self.data):
                i = x.start()
                while i > 0 and not (self.data[i - 1] == 0xcc and self.data[i] != 0xcc): i -= 1
                return self.base + i
        raise SystemExit(f'DLL 里找不到 {name}（不是带 Cubism Core 的 DLL？）')

    def setup_imports(self):   # 导入表全部换成桩：Core 只在日志 / 调试输出里用到 KERNEL32
        self.pe.parse_data_directories()
        self.stub = 0x7ff10000; self.uc.mem_map(self.stub, 0x10000); self.imp = {}
        n = 0
        for ent in self.pe.DIRECTORY_ENTRY_IMPORT:
            for i in ent.imports:
                addr = self.stub + n * 16; n += 1
                self.uc.mem_write(addr, b'\xf4'); self.uc.mem_write(i.address, struct.pack('<I', addr))
                self.imp[addr] = i.name.decode() if i.name else str(i.ordinal)

        def hook(uc, address, size, ud):
            name = self.imp.get(address)
            if name is None: return
            sp = uc.reg_read(UC_X86_REG_ESP); ret = struct.unpack('<I', uc.mem_read(sp, 4))[0]
            argc = ARGC.get(name, 0); val = 1
            if name == 'HeapAlloc':
                size_ = struct.unpack('<I', uc.mem_read(sp + 12, 4))[0]; val = self.alloc(max(size_, 1), 16)
            elif name == 'HeapReAlloc':
                old = struct.unpack('<I', uc.mem_read(sp + 12, 4))[0]; size_ = struct.unpack('<I', uc.mem_read(sp + 16, 4))[0]
                val = self.alloc(size_, 16); uc.mem_write(val, bytes(uc.mem_read(old, min(size_, 64))))
            elif name == 'HeapCreate': val = 0x5000000
            elif name in ('GetCurrentThreadId', 'GetCurrentProcessId'): val = 1234
            elif name == 'GetCurrentProcess': val = 0xffffffff
            elif name in ('IsDebuggerPresent', 'IsProcessorFeaturePresent', 'GetLastError', 'AttachConsole', 'GetProcAddress'): val = 0
            elif name in ('EncodePointer', 'DecodePointer'): val = struct.unpack('<I', uc.mem_read(sp + 4, 4))[0]
            uc.reg_write(UC_X86_REG_EAX, val); uc.reg_write(UC_X86_REG_ESP, sp + 4 + 4 * argc); uc.reg_write(UC_X86_REG_EIP, ret)
        self.uc.hook_add(UC_HOOK_CODE, hook, begin=self.stub, end=self.stub + 0x10000)

    def alloc(self, n, align=64):
        p = (self.heap_ptr + align - 1) & ~(align - 1); self.heap_ptr = p + n; return p

    def call(self, name, *args):   # cdecl
        sp = self.STACK + 0xf0000
        for a in reversed(args): sp -= 4; self.uc.mem_write(sp, struct.pack('<I', a & 0xffffffff))
        sp -= 4; self.uc.mem_write(sp, struct.pack('<I', self.RET)); self.uc.reg_write(UC_X86_REG_ESP, sp)
        self.uc.emu_start(self.addr[name], self.RET, count=200_000_000)
        return self.uc.reg_read(UC_X86_REG_EAX)

    def floats(self, p, n): return struct.unpack(f'<{n}f', bytes(self.uc.mem_read(p, 4 * n)))
    def ints(self, p, n): return struct.unpack(f'<{n}i', bytes(self.uc.mem_read(p, 4 * n)))

    def load(self, moc):
        buf = self.alloc(len(moc) + 64); self.uc.mem_write(buf, moc)
        self.moc = self.call('csmReviveMocInPlace', buf, len(moc)); assert self.moc, 'moc 校验没过'
        size = self.call('csmGetSizeofModel', self.moc); mb = self.alloc(size + 64, 16)
        self.model = self.call('csmInitializeModelInPlace', self.moc, mb, size); assert self.model
        self.nparam = self.call('csmGetParameterCount', self.model); self.pvals = self.call('csmGetParameterValues', self.model)
        self.nd = self.call('csmGetDrawableCount', self.model)

    def update(self, params):
        self.uc.mem_write(self.pvals, struct.pack(f'<{len(params)}f', *params))
        self.call('csmUpdateModel', self.model)
        n = self.nd; c = self.call
        ro = self.ints(c('csmGetDrawableRenderOrders', self.model), n); op = self.floats(c('csmGetDrawableOpacities', self.model), n)
        df = list(bytes(self.uc.mem_read(c('csmGetDrawableDynamicFlags', self.model), n)))
        counts = self.ints(c('csmGetDrawableVertexCounts', self.model), n)
        ptrs = struct.unpack(f'<{n}I', bytes(self.uc.mem_read(c('csmGetDrawableVertexPositions', self.model), 4 * n)))
        verts = [self.floats(ptrs[i], counts[i] * 2) if counts[i] else () for i in range(n)]
        return ro, op, df, verts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dll', required=True); ap.add_argument('--moc', required=True)
    ap.add_argument('--seed', default='1'); ap.add_argument('--n', default='40')
    a = ap.parse_args()
    tmp = tempfile.mkdtemp()
    cin, cout = os.path.join(tmp, 'in.json'), os.path.join(tmp, 'out.json')
    subprocess.run(['node', os.path.join(HERE, 'fuzz-gen.mjs'), a.moc, cin, a.seed, a.n], check=True)
    subprocess.run(['node', os.path.join(HERE, 'eval-js.mjs'), cin, cout], check=True)
    cases = json.load(open(cout))
    core = Core(a.dll); core.load(open(a.moc, 'rb').read())
    bv = bo = bp = tv = 0; worst = 0.0
    for cs in cases:
        ro, op, df, verts = core.update(cs['params'])
        for x, y in zip(verts, cs['verts']):
            if not x: continue
            tv += 1; d = max(max(abs(x[j] - y[j]), abs(x[j + 1] + y[j + 1])) for j in range(0, len(x), 2)); worst = max(worst, d)
            if d > 1e-3: bv += 1
        seq = sorted([i for i in range(len(ro)) if df[i] & 1], key=lambda i: ro[i])
        if seq != cs['order']: bo += 1
        if max(abs(op[i] - cs['opac'][i]) for i in range(len(op))) > 1e-3: bp += 1
    print(f'参数组 {len(cases)}，网格 {tv}：顶点不一致 {bv}（最大差 {worst:.5f}），绘制顺序不一致 {bo}，不透明度不一致 {bp}')
    sys.exit(1 if bv or bo or bp else 0)


if __name__ == '__main__':
    main()
