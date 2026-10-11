#!/usr/bin/env python3
"""AniDB UDP API 的本地替身。自测专用——绝不指向真实地址。

响应全部是对 api.anidb.net:9000 实测抓到的真实报文回放（见 .verify/anidb-udp/），
不是照文档编的。字段布局也是实测确认的：
  245 CREATOR   creatorid|日文名|罗马字|type|图片|url英|url日|wiki英|wiki日|更新时间   （10 字段）
  235 CHARACTER charid|日文名|罗马字|图片|anime关联|?|更新时间|type|性别              （9 字段）

按 id 分支模拟：正常 / 查无此人 / 超时 / session 失效。
"""
import socket
import sys
import time

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 11597
SESSION = 'mockSess'

# —— 实测真实响应（原样）——
CREATORS = {
    '39412': '39412|板場広し|Itaba Hiroshi|1|241280.jpg||http://itabatatamten.blog93.fc2.com/||板場広志|1573905836',
    '32321': '32321|魔人|Majin|2|86532.jpg||https://www.a1c.jp/~majin/top.html|||1337765837',
    '39305': '39305|秋本ねりね|Akimoto Nerine|1|203454.jpg|||||1546396872',
    '1': '1|谷口悟朗|Taniguchi Gorou|1|44996.jpg|||Gorō_Taniguchi|谷口悟朗|1269181188',
    # 注意：有些社团本来就是拉丁名，日文名字段和罗马字一模一样，不是 bug
    '15709': '15709|AniMan|AniMan|2|65595.png||http://www.ms-pictures.com/label/animan/index.php|||1514737184',
    '39414': '39414|小日向このこ|Kohinata Konoko|1||||||1392985074',
    # 没有日文名的情况：第 2 字段空，脚本应该回退或跳过
    '77001': '77001||Romaji Only Person|1|0.jpg|||||1500000000',
}
CHARACTERS = {
    '64764': '64764|女社長|Onna Shachou|157820.jpg|10459,2,39305,1||1404949033|1|F',
    '64765': '64765|新人社員|Shinjin Shain|157821.jpg|10459,2,39306,1||1404949034|1|M',
}

# 查无此人：实测 PRODUCER 返回的就是 pid=0 全空，CREATOR 对不存在的 id 也该是这个形状
EMPTY_CREATOR = '0|||||||||'


def parse(line):
    cmd, _, rest = line.partition(' ')
    params = {}
    for part in rest.split('&'):
        k, _, v = part.partition('=')
        if k:
            params[k.strip()] = v
    return cmd.strip().upper(), params


def handle(line):
    cmd, p = parse(line)
    tag = p.get('tag', '')
    pre = f'{tag} ' if tag else ''

    if cmd == 'PING':
        return f'{pre}300 PONG'

    if cmd == 'AUTH':
        user, pwd = p.get('user', ''), p.get('pass', '')
        client = p.get('client', '')
        if not client:
            return f'{pre}505 ILLEGAL INPUT OR ACCESS DENIED'
        # 真实环境里 client 没注册就是 505，这里用一个特殊 client 名模拟
        if client == 'badclient':
            return f'{pre}505 ILLEGAL INPUT OR ACCESS DENIED'
        if not user or not pwd:
            return f'{pre}500 LOGIN FAILED'
        if user == 'wronguser':
            return f'{pre}500 LOGIN FAILED'
        return f'{pre}200 {SESSION} LOGIN ACCEPTED'

    if cmd == 'LOGOUT':
        return f'{pre}203 LOGGED OUT'

    # 以下都要 session。真实服务端是先查 session 再解析命令，没登录一律 501。
    if p.get('s') != SESSION:
        return f'{pre}501 LOGIN FIRST'

    if cmd == 'CREATOR':
        cid = p.get('creatorid', '')
        if cid == '999002':          # 超时分支
            time.sleep(30)
            return f'{pre}245 CREATOR\n{EMPTY_CREATOR}'
        if cid == '999003':          # session 失效分支（测自动重登）
            return f'{pre}506 INVALID SESSION'
        if not cid:
            return f'{pre}505 ILLEGAL INPUT OR ACCESS DENIED'
        return f'{pre}245 CREATOR\n' + CREATORS.get(cid, EMPTY_CREATOR)

    if cmd == 'CHARACTER':
        chid = p.get('charid', '')
        if not chid:
            return f'{pre}505 ILLEGAL INPUT OR ACCESS DENIED'
        row = CHARACTERS.get(chid)
        return f'{pre}235 CHARACTER\n{row}' if row else f'{pre}340 NO SUCH CHARACTER'

    return f'{pre}598 UNKNOWN COMMAND'


sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind(('0.0.0.0', PORT))
print(f'mock anidb udp on {PORT}', flush=True)
while True:
    try:
        data, addr = sock.recvfrom(8192)
    except Exception:
        continue
    try:
        reply = handle(data.decode('utf-8', 'replace').strip())
        sock.sendto(reply.encode('utf-8'), addr)
    except Exception as exc:  # noqa: BLE001 - mock 不该因为一个坏包就死掉
        print(f'mock error: {exc}', flush=True)
