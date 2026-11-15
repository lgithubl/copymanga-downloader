"""Probe is bounded, read-only, credential-free and does not re-upload ddd files."""
import ast
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import socket
import tarfile
import tempfile
import urllib.request
from unittest.mock import patch

code = Path('scripts/dev/gal-collect-run.sh').read_text().split("<<'PYEOF'\n", 1)[1].split('\nPYEOF', 1)[0]
tree = ast.parse(code)
selected = [n for n in tree.body if isinstance(n, (ast.ClassDef, ast.FunctionDef)) and n.name in ('Split', 'collect_ddd_access')]
cache = Path('.cache/ddd-access-test').resolve()
cache.mkdir(exist_ok=True)
base = Path(tempfile.mkdtemp(prefix='run-', dir=cache))
root, out = base / 'gal', base / 'out'
(root / 'ddd').mkdir(parents=True)
(root / 'ddd/never-upload-token.txt').write_text('fixture-secret')
out.mkdir()
calls, reads = [], []

class Response:
    def __init__(self, api):
        self.code = 401 if api else 403
        self.headers = {'Server': 'AmazonS3', 'Set-Cookie': 'fixture-secret', 'WWW-Authenticate': 'OAuth realm="Users"'}
    def read(self, size):
        reads.append(size)
        return (b'<Error><Code>AccessDenied</Code></Error>' + b'fixture-secret' * 100)[:size]
    def __enter__(self): return self
    def __exit__(self, *args): pass

class Opener:
    def open(self, request, timeout):
        assert timeout <= 12
        assert not any('authorization' in k.lower() or 'cookie' in k.lower() for k in request.headers)
        assert '/addStory' not in request.full_url
        assert request.get_method() == ('POST' if request.data else 'GET')
        if request.data: assert json.loads(request.data) == {'storyIds': '10010204', 'adult': 1}
        calls.append(request.full_url)
        return Response(bool(request.data))

ns = dict(os=os, root=str(root), out=str(out), VERSION='test', PART=1024*1024,
          gzip=gzip, hashlib=hashlib, io=io, json=json, tarfile=tarfile,
          re=re, ts='fixture', host='test', say=lambda text: None)
exec(compile(ast.Module(body=selected, type_ignores=[]), '<collector-probe>', 'exec'), ns)
with patch('urllib.request.getproxies', return_value={'https': 'http://user:fixture-secret@proxy.invalid'}), patch('urllib.request.build_opener', return_value=Opener()), patch('socket.getaddrinfo', return_value=[(0, 0, 0, '', ('192.0.2.1', 443))]):
    ns['collect_ddd_access']()
assert len(calls) == 10 and all(n <= 512 for n in reads)
part = next(out.glob('*.part-*'))
with tarfile.open(part) as archive:
    assert archive.getnames() == ['g01/__access_probe.json']
    data = archive.extractfile(archive.getnames()[0]).read()
    assert b'fixture-secret' not in data and b'proxy.invalid' not in data
    report = json.loads(data)
    assert report['sourceReadOnly'] and not report['accountCredentialsUsed']
    assert report['proxyConfigured'] and len(report['rows']) == 10
assert (root / 'ddd/never-upload-token.txt').read_text() == 'fixture-secret'
print('PASS bounded credential-free network probe; no account modification or bundled-file upload:', base)
