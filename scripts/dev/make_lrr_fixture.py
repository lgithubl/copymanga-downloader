#!/usr/bin/env python3
"""生成一份仿 LANraragi 的测试数据：zip 内容目录、封面目录、以及加载进 Redis 用的 RESP 命令文件。

用法：make_lrr_fixture.py <输出目录> [数量]
输出：
  <out>/content/...            各种 zip（含 GBK 文件名、子目录、cbz、非 zip、缺失文件…）
  <out>/thumb/ab/<id>.jpg      封面
  <out>/redis.resp             redis-cli --pipe 用的命令
  <out>/expect.json            自测期望值
LRR 的档案 ID 是文件前 512000 字节的 SHA-1，这里同样算。
"""
import hashlib
import json
import os
import struct
import subprocess
import sys
import zipfile
import zlib

PREFIX = '/home/koyomi/lanraragi/content'   # 模拟 LRR 容器里的路径前缀


def png(width, height, color):
    raw = b''.join(b'\x00' + bytes(color) * width for _ in range(height))

    def chunk(kind, data):
        body = kind + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xffffffff)

    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


def jpeg(path, color):
    """封面：能用 ImageMagick 就生成真 JPEG，否则写 PNG 字节（浏览器照样能显示）。"""
    hexcolor = '#%02x%02x%02x' % tuple(color)
    if os.environ.get('FAST_THUMBS'):   # 大数量压测时不逐个调 ImageMagick
        with open(path, 'wb') as handle:
            handle.write(png(16, 22, color))
        return
    try:
        subprocess.run(['convert', '-size', '160x220', f'xc:{hexcolor}', path], check=True, capture_output=True)
    except Exception:
        with open(path, 'wb') as handle:
            handle.write(png(16, 22, color))


def lrr_id(path):
    with open(path, 'rb') as handle:
        return hashlib.sha1(handle.read(512000)).hexdigest()


def resp(*args):
    out = [b'*%d\r\n' % len(args)]
    for arg in args:
        data = arg if isinstance(arg, bytes) else str(arg).encode('utf-8')
        out.append(b'$%d\r\n%s\r\n' % (len(data), data))
    return b''.join(out)


def write_zip(path, pages, names=None, encoding=None, extra=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as archive:
        for index, name in enumerate(names or [f'{i:03d}.png' for i in range(1, pages + 1)]):
            color = ((index * 37) % 256, (index * 91) % 256, (index * 53) % 256)
            info = zipfile.ZipInfo(name)
            if encoding:
                # 模拟 GBK 打包：文件名写裸字节、不置 UTF-8 标志位
                info.filename = name
                info.orig_filename = name
                info.flag_bits = 0
            archive.writestr(info, png(40 + index, 60, color), zipfile.ZIP_DEFLATED)
        # 每个包都带一个按路径区分的小文件：ID 是文件头 512000 字节的哈希，内容相同的包 ID 会相同（LRR 里也是这样）
        archive.writestr('uniq.txt', path)
        for name, data in (extra or {}).items():
            archive.writestr(name, data)


def main():
    out = os.path.abspath(sys.argv[1])
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 40
    content = os.path.join(out, 'content')
    thumb = os.path.join(out, 'thumb')
    os.makedirs(content, exist_ok=True)
    commands = [resp('SELECT', 0)]
    expect = {'archives': [], 'prefix': PREFIX}
    entries = []   # (id, fields, expect-extra)

    def add(path, name, title, tags, pagecount, thumb_color=None, tag_override=None, file_override=None, raw_fields=None, note=''):
        archive_id = lrr_id(path) if os.path.exists(path) else hashlib.sha1(path.encode()).hexdigest()
        rel = os.path.relpath(path, content)
        fields = {
            'name': name, 'title': title, 'tags': tags, 'file': file_override or f'{PREFIX}/{rel}',
            'pagecount': str(pagecount), 'isnew': 'false', 'arcsize': str(os.path.getsize(path)) if os.path.exists(path) else '0',
            'progress': '0', 'lastreadtime': '0',
        }
        if raw_fields:
            fields.update(raw_fields)
        entries.append((archive_id, fields))
        if thumb_color is not None:
            jpeg_path = os.path.join(thumb, archive_id[:2], f'{archive_id}.jpg')
            os.makedirs(os.path.dirname(jpeg_path), exist_ok=True)
            jpeg(jpeg_path, thumb_color)
        return archive_id

    # 1) 普通 zip，带命名空间标签、date_added、source
    for i in range(count):
        path = os.path.join(content, f'book{i:04d}.zip')
        write_zip(path, 3 + (i % 5))
        # 内容里夹一个唯一页，保证每个 zip 前 512000 字节不同（ID 才不同）
        with zipfile.ZipFile(path, 'a') as archive:
            archive.writestr('unique.txt', f'unique-{i}')
        tags = f'artist:artist{i % 7}, parody:series{i % 3}, language:chinese, date_added:{1700000000 + i * 86400}'
        if i % 5 == 0:
            tags += f', source:https://example.com/g/{i}'
        archive_id = add(path, f'book{i:04d}', f'第{i}本 标题', tags, 3 + (i % 5), thumb_color=((i * 7) % 256, 120, 200))
        expect['archives'].append({'id': archive_id, 'title': f'第{i}本 标题', 'tags': [t.strip() for t in tags.split(',')]})

    # 2) GBK 文件名（zip 里是裸 GBK 字节，没置 UTF-8 标志位），页序要自然序：1 < 2 < 10
    gbk_path = os.path.join(content, 'gbk.zip')
    # Python 的 zipfile 写不了裸 GBK 字节（非 ASCII 一律转 UTF-8 并置标志位），所以先用等长的 ASCII 占位名写，
    # 再把本地头和中央目录里的占位名替换成 GBK 字节：得到和真实 GBK 打包一样的 zip（标志位 0）。
    placeholders = {'PAGE10.png': '第10页.png', 'PAGE2.png': '第2页.png', 'PAGE1.png': '第1页.png'}
    with zipfile.ZipFile(gbk_path, 'w', zipfile.ZIP_DEFLATED) as archive:
        for index, placeholder in enumerate(placeholders):
            archive.writestr(placeholder, png(30 + index, 50, (index * 80, 10, 10)))
    blob = open(gbk_path, 'rb').read()
    for placeholder, real in placeholders.items():
        encoded = real.encode('gbk')
        assert len(encoded) == len(placeholder), (placeholder, real)
        blob = blob.replace(placeholder.encode(), encoded)
    open(gbk_path, 'wb').write(blob)
    gbk_id = add(gbk_path, 'gbk', 'GBK 文件名', 'artist:gbk', 3, thumb_color=(10, 200, 10))
    expect['gbk'] = {'id': gbk_id, 'order': ['第1页.png', '第2页.png', '第10页.png']}

    # 3) 目录层级 + 资源叉 + 非图片，页序按完整路径自然序
    nested = os.path.join(content, 'nested', 'deep', 'nested.zip')
    write_zip(nested, 0, names=['b/2.png', 'b/10.png', 'a/1.png', '__MACOSX/a/._1.png'], extra={'readme.txt': 'hi', 'a/Thumbs.db': 'x'})
    nested_id = add(nested, 'nested', '嵌套目录', 'artist:nested', 0, thumb_color=(200, 10, 10))
    expect['nested'] = {'id': nested_id, 'pages': 3}

    # 4) cbz
    cbz = os.path.join(content, 'comic.cbz')
    write_zip(cbz, 2)
    cbz_id = add(cbz, 'comic', 'CBZ 档案', 'artist:cbz', 2, thumb_color=(10, 10, 200))
    expect['cbz'] = {'id': cbz_id}

    # 5) ComicInfo.xml
    info_zip = os.path.join(content, 'info.zip')
    write_zip(info_zip, 2, extra={'ComicInfo.xml': '<ComicInfo><Writer>作者甲</Writer><Series>某系列</Series><Genre>冒险</Genre><LanguageISO>zh</LanguageISO></ComicInfo>'})
    info_id = add(info_zip, 'info', '[社团甲 (作者乙)] 带信息的标题 (某原作) [中国翻訳]', 'artist:info', 2, thumb_color=(100, 100, 100))
    expect['info'] = {'id': info_id}

    # 6) 没有任何图片的 zip（封面脚本应该失败，阅读报错）
    empty = os.path.join(content, 'noimages.zip')
    with zipfile.ZipFile(empty, 'w') as archive:
        archive.writestr('readme.txt', 'no images here')
    empty_id = add(empty, 'noimages', '没有图片', '', 0)
    expect['noimages'] = {'id': empty_id}

    # 6b) 只有 1 页的 zip（没有预览动图：页数不足）
    single = os.path.join(content, 'single.zip')
    write_zip(single, 1)
    single_id = add(single, 'single', '单页', 'artist:single', 1, thumb_color=(120, 60, 60))
    expect['single'] = {'id': single_id}

    # 7) 双重编码的标题（LRR 的 redis_decode 要解两次）+ 空标签
    dbl = os.path.join(content, 'double.zip')
    write_zip(dbl, 2)
    original = '双重编码的标题'
    double_title = original.encode('utf-8').decode('latin-1')   # 字符串里每个字符是原 UTF-8 字节
    dbl_id = add(dbl, 'double', double_title, '', 2, thumb_color=(50, 50, 50))
    expect['double'] = {'id': dbl_id, 'title': original}

    # 8) 标题为空 → 退回 name
    notitle = os.path.join(content, 'notitle.zip')
    write_zip(notitle, 2)
    nt_id = add(notitle, '无标题文件名', '', 'artist:nt', 2)
    expect['notitle'] = {'id': nt_id, 'title': '无标题文件名'}

    # 9) 非 zip：跳过并统计
    rar = os.path.join(content, 'old.rar')
    with open(rar, 'wb') as handle:
        handle.write(b'Rar!' + os.urandom(64))
    add(rar, 'old', 'RAR 档案', 'artist:rar', 0)
    expect['skippedExtension'] = {'rar': 1}

    # 10) 文件缺失 / 路径前缀不匹配
    add(os.path.join(content, 'missing.zip'), 'missing', '缺失文件', 'artist:miss', 0)
    add(os.path.join(content, 'other.zip'), 'other', '前缀不对', 'artist:other', 0, file_override='/somewhere/else/other.zip')

    # 11) 封面缺失的普通 zip（上面最后几个都没封面；再加一个明确的）
    nothumb = os.path.join(content, 'nothumb.zip')
    write_zip(nothumb, 2)
    nothumb_id = add(nothumb, 'nothumb', '没有封面', 'artist:nothumb', 2)
    expect['nothumb'] = {'id': nothumb_id}

    # Redis：db0 里放档案 hash，另外放几个非档案的 key（迁移必须忽略）
    for archive_id, fields in entries:
        args = ['HSET', archive_id]
        for key, value in fields.items():
            args += [key, value]
        commands.append(resp(*args))
    commands.append(resp('HSET', 'SET_1700000000', 'name', '某分类', 'archives', '[]', 'search', ''))
    commands.append(resp('HSET', 'TANK_1700000001', 'name', '某合集'))
    commands.append(resp('SET', 'LRR_VERSION', '0.9.0'))
    with open(os.path.join(out, 'redis.resp'), 'wb') as handle:
        handle.write(b''.join(commands))

    expect['total_hashes'] = len(entries)
    expect['importable'] = len(entries) - 1 - 1 - 1   # 去掉 rar、缺失、前缀不对
    with open(os.path.join(out, 'expect.json'), 'w', encoding='utf-8') as handle:
        json.dump(expect, handle, ensure_ascii=False, indent=2)
    print(f'fixture: {len(entries)} hashes, importable {expect["importable"]} -> {out}')


if __name__ == '__main__':
    main()
