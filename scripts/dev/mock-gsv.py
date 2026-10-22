#!/usr/bin/env python3
"""模拟 GSV-TTS-Lite 的 /tts/batched 和 /audio/<文件>，用来在没有 GPU 的地方试朗读。
合成的是「音高随参数变」的正弦音（时长随字数）：同一句话用不同的参考音频/语言，听得出音高不同——
这样试「每个 flag 用自己的 TTS 参数」时，耳朵就能分出来，不用真的有 TTS 服务。
  python3 scripts/dev/mock-gsv.py [端口，默认 8196]  [--log]   监听 0.0.0.0
"""
import json
import math
import os
import struct
import sys
import tempfile
import threading
import wave
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(next((a for a in sys.argv[1:] if a.isdigit()), '8196'))
LOG = '--log' in sys.argv
OUT = tempfile.mkdtemp(prefix='mock-gsv-')
COUNTER = 0
LOCK = threading.Lock()
RATE = 22050


def pitch(body):
    # 参考音频 + 语言决定音高：不同参数 -> 不同的音
    key = f"{body.get('speaker_audio') or ''}|{body.get('prompt_audio') or ''}|{body.get('text_language') or ''}|{body.get('prompt_language') or ''}"
    return 260 + (zlib.crc32(key.encode()) % 6) * 90


def synth(text, freq):
    seconds = min(6.0, max(0.5, len(text) * 0.12))
    global COUNTER
    with LOCK:
        COUNTER += 1
        name = f'f{COUNTER}.wav'
    path = os.path.join(OUT, name)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        frames = []
        n = int(RATE * seconds)
        for i in range(n):
            fade = min(1.0, i / 800, (n - i) / 800)
            frames.append(struct.pack('<h', int(7000 * fade * math.sin(2 * math.pi * freq * i / RATE))))
        w.writeframes(b''.join(frames))
    return name, seconds


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        if LOG:
            sys.stderr.write('[mock-gsv] ' + (fmt % args) + '\n')

    def _json(self, code, value):
        data = json.dumps(value).encode()
        self.send_response(code)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == '/health':
            return self._json(200, {'ok': True})
        if self.path.startswith('/audio/'):
            name = os.path.basename(self.path[len('/audio/'):])
            path = os.path.join(OUT, name)
            if os.path.isfile(path):
                data = open(path, 'rb').read()
                self.send_response(200)
                self.send_header('content-type', 'audio/wav')
                self.send_header('content-length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get('content-length') or 0)
        body = json.loads(self.rfile.read(length) or b'{}')
        if self.path != '/tts/batched':
            self.send_response(404)
            self.end_headers()
            return
        texts = body.get('texts') or []
        if LOG:
            sys.stderr.write(f"[mock-gsv] batch {len(texts)} 句 prompt_audio={body.get('prompt_audio')!r} text_language={body.get('text_language')!r}\n")
        freq = pitch(body)
        names, subs = [], []
        for text in texts:
            name, seconds = synth(str(text), freq)
            names.append(name)
            subs.append([{'text': str(text), 'start': 0, 'end': seconds}])
        self._json(200, {'success': True, 'filenames': names, 'subtitles': subs})


if __name__ == '__main__':
    ThreadingHTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
