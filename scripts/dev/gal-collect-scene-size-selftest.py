"""970 complete RPG event maps (~84MiB output) must survive the default round."""
import pathlib,tempfile,json,hashlib,subprocess,os,tarfile
base=pathlib.Path(tempfile.mkdtemp(prefix='collect-scene-size-'));root=base/'gal';game=root/'RJ328940';data=game/'www/data';data.mkdir(parents=True);(game/'www/js/plugins').mkdir(parents=True)
for name,value in [('System',{}),('CommonEvents',[None]),('MapInfos',[None])]: (data/(name+'.json')).write_text(json.dumps(value))
(game/'www/js/plugins.js').write_text('var $plugins=[];');(game/'www/js/plugins/SimpleVoice.js').write_text('se.name.includes("_lize")')
hashes={};last=''
for n in range(1,971):
 text='native-map-%04d:'%n+'x'*90000;last=text
 doc={'data':[0]*1024,'events':[None,{'id':1,'name':'native event','pages':[{'conditions':{},'list':[{'code':101,'parameters':['',0,0,2,'']},{'code':401,'parameters':[text]}]}]}]}
 p=data/('Map%03d.json'%n);p.write_text(json.dumps(doc,separators=(',',':')));hashes[p]=hashlib.sha256(p.read_bytes()).hexdigest()
env={k:v for k,v in os.environ.items()if not k.startswith('GAL_COLLECT_')};out=base/'out';env.update(GAL_COLLECT_RULES='^new-games:scene-audit$',GAL_COLLECT_DRYRUN='1',GAL_COLLECT_OUT=str(out))
r=subprocess.run(['bash','scripts/dev/gal-collect-run.sh',str(root)],env=env,capture_output=True,text=True);assert r.returncode==0,r.stdout+r.stderr
parts=list(out.glob('*.part-*'));assert len(parts)==1,'fixture is compressible; the raw-byte limit must not be confused with compressed part size'
with tarfile.open(parts[0])as t:
 names=t.getnames();report=json.load(t.extractfile(next(n for n in names if n.endswith('__scene-audit/index.json'))));assert report['sampleBytes']>64*1024*1024;assert report['sceneCoverage']['maps']==970
 rows=[r for r in report['files']if r.get('projection')];assert len(rows)==970
 for row in rows:
  b=t.extractfile(next(n for n in names if n.endswith('/'+row['artifact']))).read();assert len(b)==row['bytes']and hashlib.sha256(b).hexdigest()==row['sha256'];doc=json.loads(b);assert'data'not in doc;assert len(doc['events'][1]['pages'][0]['list'][1]['parameters'][0])>90000
 final=json.load(t.extractfile(next(n for n in names if n.endswith('/Map970.json'))));assert final['events'][1]['pages'][0]['list'][1]['parameters'][0]==last
assert all(hashlib.sha256(p.read_bytes()).hexdigest()==h for p,h in hashes.items())
print('PASS970maps, full first-to-last dialogue, output>64MiB, all SHA/lengths, sources unchanged; retained:',base)
