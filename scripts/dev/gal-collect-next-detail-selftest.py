"""Focused second-pass evidence: routing, complete ranges, large JSON, no source mutation."""
import os,pathlib,tempfile,subprocess,tarfile,json,hashlib,struct
base=pathlib.Path(tempfile.mkdtemp(prefix='collect-next-detail-'));root=base/'gal';root.mkdir()
def put(game,rel,data):
 p=root/game/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data if isinstance(data,bytes) else data.encode());return p
for game,prefix in [('RJ01271506',''),('RJ01646655',''),('RJ328940','www/')]:
 for name in ['System','MapInfos','Actors','Tilesets','CommonEvents','Map001','Map004']:
  put(game,prefix+'data/'+name+'.json','[]')
 put(game,prefix+'js/plugins/inazuma/core/system/Encrypt.js','// inspected, never executed')
 put(game,prefix+'save/private.json','secret')
 put(game,'MTool/Tool/js/plugins/unwanted.js','secret')
 put(game,prefix+'img/pictures/secret.png','media')
put('RJ01646655','data/CommonEvents.json','["'+('x'*(17*1024*1024))+'"]')
put('天結いラビリンスマイスター','SC0000.BIN',b'SYS4485 '+bytes(24))
put('天結いラビリンスマイスター','APPEND01.AAI',b'index')
put('天結いラビリンスマイスター','DATA1.ALF',b'x'*300000)
put('天結いラビリンスマイスター','AGE.EXE',b'MZ'+b'private executable')
def string(s):
 b=s.encode();assert len(b)<128;return bytes([len(b)])+b
payload=b'complete script sample';head=b'@ARCH000'+bytes(15);index=struct.pack('<I',2)
off=23
for name,folder,data in [('sc000.txt','src/game',payload),('image.bytes','img/bg',b'unwanted media')]:
 index+=string(name)+struct.pack('<QQB',off,len(data),78)+string(folder);off+=len(data)
put('Remastered','Archives/ver00d3.arc',head+payload+b'unwanted media'+index+struct.pack('<Q',off))
put('Another Game','data/System.json','{}')
snapshot={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
env={k:v for k,v in os.environ.items() if not k.startswith('GAL_COLLECT_')};out=base/'out';env.update(GAL_COLLECT_DRYRUN='1',GAL_COLLECT_OUT=str(out),GAL_COLLECT_RULES='^new-games:next-detail$')
r=subprocess.run(['bash','scripts/dev/gal-collect-run.sh',str(root)],env=env,text=True,capture_output=True);assert r.returncode==0,r.stdout+r.stderr
rows=(out/'games.tsv').read_text().splitlines()[1:];assert len(rows)==5,rows
reports=[]
for part in out.glob('*.part-*'):
 with tarfile.open(part,'r:gz') as t:
  names=t.getnames();assert not any('/save/' in n or '/MTool/' in n or n.endswith(('.exe','.png')) for n in names),names
  report=json.load(t.extractfile(next(n for n in names if n.endswith('__next/index.json'))));reports.append(report)
  for e in report['files']:
   b=t.extractfile(next(n for n in names if n.split('/',1)[1]==e['artifact'])).read();assert len(b)==e['bytes'];assert hashlib.sha256(b).hexdigest()==e['sha256']
  if report['game']=='Remastered':
   scripts=[e for e in report['files'] if 'logicalName' in e];assert len(scripts)==1 and scripts[0]['logicalName']=='src/game/sc000.txt'
   assert t.extractfile(next(n for n in names if n.endswith('/0.bin'))).read()==payload
  if report['game']=='RJ01646655':assert any(e['path']=='data/CommonEvents.json' and e['bytes']>16*1024*1024 for e in report['files'])
assert all(r['sourceReadOnly'] and r['sampleBytes']<=56*1024*1024 for r in reports)
assert snapshot=={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
print('PASS next detail: original5 excluded, five next targets, nested plugins, >16MB complete common events, exact ARCH000 script/index ranges, AGE AAI/BIN, no save/runtime/media, source unchanged; retained:',base)
