"""Exercise target discovery and exact range collection through the real shell script."""
import base64,hashlib,json,os,pathlib,re,subprocess,tarfile,tempfile,zlib
base=pathlib.Path(tempfile.mkdtemp(prefix='collect-fuyu-edo-'));root=base/'gal';root.mkdir();files=[];plan={}
for label,name in [('fuyukuru','[publisher] fuyukuru v1.0'),('えどわ～る','えどわ～る')]:
    game=root/name;game.mkdir();data=b'header-WANTED-payload-that-is-not-collected';p=game/'sample.arc';p.write_bytes(data);files.append((p,hashlib.sha256(data).hexdigest()))
    plan[label]=[{'path':'sample.arc','sourceBytes':len(data),'offset':7,'bytes':6,'name':'__pair_media/sample.bin'}]
meta=base/'library-meta'/'gal';meta.mkdir(parents=True)
(meta/'test-pair.json').write_text(json.dumps({'title':'fuyukuru','config':{'game':{'id':'silky::fuyukuru'},'password':'never-leak'}}))
(root/'[publisher] fuyukuru v1.0'/'EV003_H03.png').write_bytes(b'old-materialized-png')
other=root/'OtherGame';other.mkdir();(other/'AGE.EXE').write_bytes(b'must not collect')
script=pathlib.Path('scripts/dev/gal-collect-run.sh').read_text();script=re.sub(r'PAIR_ACTIVE_GAMES = \[[^\n]*\]',"PAIR_ACTIVE_GAMES = ['fuyukuru', 'えどわ～る']",script);encoded=base64.b64encode(zlib.compress(json.dumps(plan).encode())).decode();script=re.sub(r"PAIR_MEDIA_PLAN='[^']+'","PAIR_MEDIA_PLAN='"+encoded+"'",script)
runner=base/'collect.sh';runner.write_text(script);env={k:v for k,v in os.environ.items()if not k.startswith('GAL_COLLECT_')};out=base/'out';env.update(GAL_COLLECT_DRYRUN='1',GAL_COLLECT_OUT=str(out))
run=subprocess.run(['bash',str(runner),str(root)],env=env,text=True,capture_output=True);assert run.returncode==0,run.stdout+run.stderr
parts=sorted(out.glob('*.part-*'));assert len(parts)==2,run.stdout
for p in parts:
    with tarfile.open(p)as a:
        names=a.getnames();assert not any('OtherGame'in x or x.endswith('.exe')for x in names)
        sample=next(x for x in names if x.endswith('__pair_media/sample.bin'));assert a.extractfile(sample).read()==b'WANTED'
        assert any(x.endswith('__pair_media/index.json')for x in names)
        if any(x.endswith('EV003_H03.png')for x in names):
            runtime=next(x for x in names if '/__pair_runtime/items/'in x);doc=json.load(a.extractfile(runtime));assert doc['config']['password']=='[redacted]'
            assert a.extractfile(next(x for x in names if x.endswith('EV003_H03.png'))).read()==b'old-materialized-png'
for p,digest in files:assert hashlib.sha256(p.read_bytes()).hexdigest()==digest
# Changed archive sizes must stop collection, rather than silently reading wrong bytes.
(root/'えどわ～る'/'sample.arc').write_bytes(b'changed')
env['GAL_COLLECT_OUT']=str(base/'rejected');bad=subprocess.run(['bash',str(runner),str(root)],env=env,text=True,capture_output=True);assert bad.returncode!=0;assert 'Pair media source changed'in bad.stderr+bad.stdout
print('PASS two normalized targets, exact ranges + SHA manifests, changed-source guard, read-only originals; retained:',base)
