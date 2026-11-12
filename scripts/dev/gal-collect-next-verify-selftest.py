"""Exact next5 verification ranges, stale-version rejection and source preservation."""
import pathlib,tempfile,re,json,zlib,base64,hashlib,subprocess,os,tarfile
src=pathlib.Path('scripts/dev/gal-collect-run.sh').read_text();match=re.search(r"NEXT_VERIFY_PLAN = '([^']+)'",src);plan=json.loads(zlib.decompress(base64.b64decode(match[1])));assert len(plan)==5
for label,value in plan.items():
 assert sum(row['bytes']for row in value['ranges'])<=16*1024*1024
 for row in value['ranges']:assert row['offset']>=0 and row['offset']+row['bytes']<=row['sourceBytes'] and row['bytes']<=8*1024*1024
assert sum(row['bytes']for p in plan.values()for row in p['ranges'])<32*1024*1024
assert any(row['source']=='AGE.EXE'for row in plan['天結いラビリンスマイスター']['ranges'])
base=pathlib.Path(tempfile.mkdtemp(prefix='collect-next-verify-'));root=base/'gal';root.mkdir();fixture={};before={}
for label in plan:
 d=root/label;d.mkdir();p=d/'source.bin';b=b'0123456789ABCDEF';p.write_bytes(b);before[p]=b
 fixture[label]={'guards':[dict(source='source.bin',offset=0,bytes=4,sha256=hashlib.sha256(b[:4]).hexdigest())],'ranges':[dict(source='source.bin',sourceBytes=16,offset=4,bytes=6,artifact='__verify/payload.bin')]}
script=base/'collector.sh';packed=base64.b64encode(zlib.compress(json.dumps(fixture).encode())).decode();script.write_text(src[:match.start(1)]+packed+src[match.end(1):]);env={k:v for k,v in os.environ.items()if not k.startswith('GAL_COLLECT_')};out=base/'out';env.update(GAL_COLLECT_DRYRUN='1',GAL_COLLECT_OUT=str(out));r=subprocess.run(['bash',str(script),str(root)],env=env,capture_output=True,text=True);assert r.returncode==0,r.stdout+r.stderr
parts=list(out.glob('*.part-*'));assert len(parts)==5
for part in parts:
 with tarfile.open(part) as t:
  names=t.getnames();report=json.load(t.extractfile(next(n for n in names if n.endswith('__verify/index.json'))));assert report['sourceReadOnly']and report['sampleBytes']==6;assert t.extractfile(next(n for n in names if n.endswith('payload.bin'))).read()==b'456789'
assert all(p.read_bytes()==b for p,b in before.items())
p=next(iter(before));p.write_bytes(b'changed-version!');env['GAL_COLLECT_OUT']=str(base/'rejected');r=subprocess.run(['bash',str(script),str(root)],env=env,capture_output=True,text=True);assert r.returncode!=0 and 'refusing stale offsets' in r.stdout+r.stderr
print('PASS verify5 exact byte ranges; 16/32MB budgets; default routing; hash/size guards; no game execution or source mutation; retained:',base)
