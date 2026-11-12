# Validate the real bounded range plan, then run the complete collector on small fixtures.
import pathlib,tempfile,base64,zlib,json,re,hashlib,os,subprocess,tarfile
src=pathlib.Path('scripts/dev/gal-collect-run.sh').read_text();m=re.search(r"REMAINING_RANGE_PLAN = '([^']+)'",src);assert m
real=json.loads(zlib.decompress(base64.b64decode(m[1])));assert set(real)=={'AI','ツヴァイトリガー'}
for game,plan in real.items():
 assert sum(r['bytes'] for r in plan['ranges'])<=8*1024*1024
 assert plan['guards'] and all(g['bytes']<=8*1024*1024 and len(g['sha256'])==64 for g in plan['guards'])
 for r in plan['ranges']:
  assert 0<=r['offset'] and r['offset']+r['bytes']<=r['sourceBytes']
  assert all(v not in ('','.','..') for v in r['artifact'].split('/')) and not r['artifact'].startswith('/')
  if 'storedBytes' in r:assert r['partial']==(r['bytes']!=r['storedBytes'])
base=pathlib.Path(tempfile.mkdtemp(prefix='remaining-collect-'));root=base/'gal';root.mkdir();fixture={};originals={}
for game in real:
 d=root/game;d.mkdir();(d/'game.exe').write_bytes(b'not-requested')
 b=b'0123456789ABCDEF'*8;p=d/'package.bin';p.write_bytes(b);originals[p]=hashlib.sha256(b).hexdigest()
 fixture[game]={'guards':[{'source':'package.bin','offset':0,'bytes':16,'sha256':hashlib.sha256(b[:16]).hexdigest()}],'ranges':[{'source':'package.bin','sourceBytes':len(b),'offset':16,'bytes':9,'artifact':'__remaining/raw-sample.bin','partial':True,'storedBytes':50}]}
for game in ['How to Build a Magnificent Kingdom v1.05','夜勤病棟リメイク','シロクロv1.1']:
 d=root/game;d.mkdir();(d/'game.exe').write_bytes(b'excluded-game')
packed=base64.b64encode(zlib.compress(json.dumps(fixture).encode())).decode();script=base/'collector.sh';script.write_text(src[:m.start(1)]+packed+src[m.end(1):]);out=base/'out';env={k:v for k,v in os.environ.items() if k not in ['GAL_COLLECT_TSK_LOG','GAL_COLLECT_RULES','GAL_COLLECT_ONLY']};env.update(GAL_COLLECT_RULES='^new-games:remaining$',GAL_COLLECT_DRYRUN='1',GAL_COLLECT_OUT=str(out))
r=subprocess.run(['bash',str(script),str(root)],env=env,capture_output=True,text=True);assert r.returncode==0,r.stdout+r.stderr
parts=list(out.glob('*.part-*'));assert len(parts)==len(real)
for part in parts:
 with tarfile.open(part) as t:
  names=t.getnames();report=json.load(t.extractfile(next(n for n in names if n.endswith('__remaining/index.json'))));assert report['sourceReadOnly'];assert report['sampleBytes']==9 and report['files'][0]['partial'];assert not any(n.endswith('.exe') for n in names);assert t.extractfile(next(n for n in names if n.endswith('raw-sample.bin'))).read()==b'012345678'
assert all(hashlib.sha256(p.read_bytes()).hexdigest()==h for p,h in originals.items())
first=next(iter(originals));first.write_bytes(b'x'+first.read_bytes()[1:]);env['GAL_COLLECT_OUT']=str(base/'mismatch');r=subprocess.run(['bash',str(script),str(root)],env=env,capture_output=True,text=True);assert r.returncode!=0 and 'refusing stale offsets' in r.stdout+r.stderr
print('PASS selected remaining games only; bounded/valid real offsets; encrypted/partial bytes preserved; version guard rejects stale index; no source mutation; retained:',base)
