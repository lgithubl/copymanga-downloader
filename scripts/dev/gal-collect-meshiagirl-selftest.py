"""Run the actual collector's bounded meshiagirl probe with read-only fixtures."""
import base64,zlib,re,hashlib,json,os,pathlib,subprocess,tarfile,tempfile
base=pathlib.Path(tempfile.mkdtemp(prefix='collect-meshiagirl-'));root=base/'gal';game=root/'[publisher] meshiagirl';(game/'scenario').mkdir(parents=True)
source=game/'scenario'/'sample.json';source.write_text(json.dumps({'text':'原始剧情','image':'test.png'},ensure_ascii=False));before=hashlib.sha256(source.read_bytes()).hexdigest()
other=root/'fuyukuru';other.mkdir();(other/'script.arc').write_bytes(b'unrelated')
code=pathlib.Path('scripts/dev/gal-collect-run.sh').read_text();code=re.sub(r"PAIR_MEDIA_PLAN='[^']*'","PAIR_MEDIA_PLAN='"+base64.b64encode(zlib.compress(b'{}')).decode()+"'",code);script=base/'collect.sh';script.write_text(code);out=base/'out';env={k:v for k,v in os.environ.items()if not k.startswith('GAL_COLLECT_')};env.update(GAL_COLLECT_DRYRUN='1',GAL_COLLECT_OUT=str(out))
r=subprocess.run(['bash',str(script),str(root)],env=env,text=True,capture_output=True);assert r.returncode==0,r.stdout+r.stderr
parts=sorted(out.glob('*.part-*'));assert len(parts)==1,r.stdout
with tarfile.open(parts[0])as a:
 names=a.getnames();sample=next(n for n in names if n.endswith('__meshi_probe/files/scenario/sample.json'));assert a.extractfile(sample).read()==source.read_bytes();assert not any('script.arc'in n for n in names)
 report=json.load(a.extractfile(next(n for n in names if n.endswith('__meshi_probe/index.json'))));assert report['sourceReadOnly'];assert report['files'][0]['sourceBytes']==source.stat().st_size
assert hashlib.sha256(source.read_bytes()).hexdigest()==before
print('PASS meshiagirl-only probe, exact original sample/SHA, unrelated games omitted, source unchanged:',base)

# Exercise the real archive-wide budget too (the per-game range limit alone is insufficient).
large=game/'range.bin';large.write_bytes(bytes(1024*1024));plan={'meshiagirl':[{'path':'range.bin','sourceBytes':large.stat().st_size,'offset':0,'bytes':large.stat().st_size,'name':'__pair_media/range-%03d.bin'%i}for i in range(70)]}
code=re.sub(r"PAIR_MEDIA_PLAN='[^']*'","PAIR_MEDIA_PLAN='"+base64.b64encode(zlib.compress(json.dumps(plan).encode())).decode()+"'",code);script.write_text(code);env['GAL_COLLECT_OUT']=str(base/'range-out')
r=subprocess.run(['bash',str(script),str(root)],env=env,text=True,capture_output=True);assert r.returncode==0,r.stdout+r.stderr
with tarfile.open(next((base/'range-out').glob('*.part-*')))as a:assert len([n for n in a.getnames()if '/__pair_media/range-'in n])==70
print('PASS actual meshiagirl archive-wide budget permits bounded70MiB evidence')
