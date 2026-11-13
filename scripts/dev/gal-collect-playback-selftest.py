"""Read-only full collector route: saved config, all EV009 candidates, exact media."""
import pathlib,tempfile,json,hashlib,zlib,base64,re,os,subprocess,tarfile
src=pathlib.Path('scripts/dev/gal-collect-run.sh').read_text();base=pathlib.Path(tempfile.mkdtemp(prefix='collect-playback-'));root=base/'data/library/gal';root.mkdir(parents=True);before={}
def put(game,rel,data):
 p=root/game/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data);before[p]=hashlib.sha256(data).hexdigest();return p
def js(game,rel,value):return put(game,rel,json.dumps(value,ensure_ascii=False).encode())
def ev(eid,name,commands,note=''):return {'id':eid,'name':name,'note':note,'pages':[{'conditions':{},'trigger':0,'image':{},'list':commands}]}
def cmd(code,*p):return {'code':code,'parameters':list(p)}
mz='RJ01271506';mv='RJ328940';twi='ツヴァイトリガー'
for game,prefix in [(mz,''),(mv,'www/')]:
 js(game,prefix+'data/System.json',{});js(game,prefix+'data/Actors.json',[None]);js(game,prefix+'data/Tilesets.json',[None]);js(game,prefix+'data/MapInfos.json',[None]*500);js(game,prefix+'data/CommonEvents.json',[None,{'id':1,'name':'child','list':[cmd(250,{'name':'_meifa_child'})]}]);plugins=[{'name':'triacontane/TemplateEvent','status':True,'parameters':{'TemplateMapIdList':'["252"]','TemplateMapId':'252'}},{'name':'triacontane/PictureAnimation','status':True,'parameters':{}}]if game==mz else[{'name':'SimpleVoice','status':True,'parameters':{'フォルダ名':'voice'}}];put(game,prefix+'js/plugins.js',('var $plugins='+json.dumps(plugins)+';').encode())
js(mz,'audio/voice/voice_list.json',{'uniqueIds':[5949]})
js(mz,'data/Map102.json',{'data':[7,8,9],'events':[None,ev(20,'recipe',[cmd(401,'original')],'<TE:recipe>')]});js(mz,'data/Map128.json',{'data':[9],'events':[None,ev(31,'recipe2',[],'<TE:recipe2>')]})
commands=[cmd(357,'triacontane/PictureAnimation','INIT','',{'cellNumber':'3','direction':'number'}),cmd(231,2,'still/bisty/h/H001_00'),cmd(401,'\\TRN[5949] voiced'),cmd(401,'\\TRN[5950] originally unvoiced'),cmd(117,1),cmd(241,{'name':'not-needed-music'})]
js(mz,'data/Map252.json',{'data':[1,2],'events':[None,ev(13,'recipe',commands),ev(14,'recipe2',[])]})
for i in range(3):put(mz,'img/pictures/still/bisty/h/H001_0%d.png_'%i,b'picture'+bytes([i]))
put(mz,'audio/bgm/not-needed-music.ogg_',b'original background track')
put(mz,'dlc/dlc_10000/audio/voice/unique/5949.ogg_',b'native-DLC-voice');put(mz,'img/pictures/busts/bisty/normal.png_',b'body');put(mz,'img/pictures/busts/bisty/texture.json',b'{}')
for mid,events in [(239,[ev(50,'control',[cmd(250,{'name':'_meifa_first'}),cmd(401,'text')])]),(402,[ev(9,'EV009',[cmd(401,'text'),cmd(401,'more text'),cmd(356,'SV_ボイスの演奏 voice_clip 90 100 0 1'),cmd(231,1,'__shadow')])]),(459,[ev(9,'EV009',[cmd(401,'other same-name event'),cmd(401,'more text'),cmd(117,1)])])]:js(mv,'www/data/Map%03d.json'%mid,{'data':[mid],'events':[None]+events})
for rel,b in [('audio/se/_meifa_first.rpgmvo',b'short voice'),('audio/se/_meifa_child.rpgmvo',b'child voice'),('audio/voice/voice_clip.rpgmvo',b'explicit voice'),('img/pictures/__shadow.rpgmvp',b'shadow')]:put(mv,'www/'+rel,b)
put(twi,'data.xp3',b'NEVER COPY ARCHIVE');put(twi,'arc/.stamp.json',b'{}');put(twi,'arc/refs/data/names.json',b'{}');put(twi,'arc/script/data/yn03.krkr',b'{"format":"krkr-scn/1"}')
put('Remastered','game.exe',b'not requested')
meta=base/'data/library-meta/gal/aa/bb';meta.mkdir(parents=True)
for label,ident in [(mz,'a'*40),(mv,'b'*40),(twi,'c'*40)]:
 cfg={'game':{'id':'rpgmaker::'+label if label!=twi else'krkr::zweitrigger'},'scriptRoots':[{'dir':'arc/script'}],'containers':{'keys':[{'secret':'do not leak'}]},'script':{'version':'2.62.0'}};p=meta/(ident+'.json');p.write_text(json.dumps({'itemId':ident,'title':label,'source':{'path':'/data/library/gal/'+label},'adapters':['rpgmaker-json'],'config':cfg}));before[p]=hashlib.sha256(p.read_bytes()).hexdigest()
(meta/('d'*40+'.json')).write_text(json.dumps({'title':'unrelated private game','config':{'secret':'private'}}))
# Reuse full media/core exactly, but preserve full selected maps even when only
# their event projection has previously been collected.
known={mz:{},mv:{}}
for game,prefix in [(mz,''),(mv,'www/')]:
 for p in (root/game).rglob('*'):
  if not p.is_file():continue
  rel=p.relative_to(root/game).as_posix();known[game][rel.casefold()]={'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),**({'projection':True}if re.search(r'/Map\d+\.json$',rel)else{})}
# One new CG and one new voice must be transferred, not only referenced.
known[mz].pop('img/pictures/still/bisty/h/h001_02.png_');known[mv].pop('www/audio/voice/voice_clip.rpgmvo')
encoded=base64.b64encode(zlib.compress(json.dumps(known).encode())).decode();src=re.sub(r"(?m)^PLAYBACK_REUSED = '[^']*'$",'PLAYBACK_REUSED = '+repr(encoded),src);script=base/'collector.sh';script.write_text(src);out=base/'out';env={k:v for k,v in os.environ.items()if not k.startswith('GAL_COLLECT_')};env.update(GAL_COLLECT_RULES='^new-games:playback$',GAL_COLLECT_DRYRUN='1',GAL_COLLECT_OUT=str(out));r=subprocess.run(['bash',str(script),str(root)],env=env,capture_output=True,text=True);assert r.returncode==0,r.stdout+r.stderr
reports={}
for part in out.glob('*.part-*'):
 with tarfile.open(part)as t:
  names=t.getnames();report=json.load(t.extractfile(next(n for n in names if n.endswith('__playback/index.json'))));reports[report['game']]=report
  assert report['sourceReadOnly']and not report['runtime']['httpEndpointsCalled'];assert len(report['runtime']['matchingItems'])==1
  assert not any(n.endswith(('.xp3','.exe','.dll'))for n in names);assert not any('not-needed-music' in n for n in names)
  runtime=json.load(t.extractfile(next(n for n in names if '/__playback/runtime/items/'in n)));assert runtime['config']['containers']['keys']=='[redacted]';assert b'do not leak'not in json.dumps(runtime).encode()
  for row in report['files']:
   b=t.extractfile(next(n for n in names if n.endswith('/'+row['artifact']))).read();assert len(b)==row['bytes']and hashlib.sha256(b).hexdigest()==row['sha256']
  if report['game']==mz:
   original=json.load(t.extractfile(next(n for n in names if n.endswith('/data/Map102.json'))));assert original['data']==[7,8,9];assert original['events'][1]['note']=='<TE:recipe>'
   refs=json.load(t.extractfile(next(n for n in names if n.endswith('/__playback/media-references.json'))));assert any(x['logical'].endswith('H001_02')for x in refs);assert any('dlc/dlc_10000/audio/voice/unique/5949.ogg_'in x['physicalSources']for x in refs);assert report['unvoicedTrnIds']==[5950];assert any(n.endswith('H001_02.png_')for n in names)
  if report['game']==mv:
   refs=json.load(t.extractfile(next(n for n in names if n.endswith('/__playback/media-references.json'))));assert any(x['logical']=='www/audio/voice/voice_clip'and x['physicalSources']for x in refs);assert any(n.endswith('voice_clip.rpgmvo')for n in names)
   candidates=json.load(t.extractfile(next(n for n in names if n.endswith('ev009-candidates.json'))));assert {x['map']for x in candidates}=={402,459};assert any(x['event']==1 and x['kind']=='common'for x in report['dependencies'])
assert set(reports)=={mz,mv,twi};assert all(hashlib.sha256(p.read_bytes()).hexdigest()==sha for p,sha in before.items())
print('PASS explicit3-game playback route, saved config redaction, full native tile/TE pages, all EV009 names, common dependencies, numbered CG cells, DLC/voice folder, SHA reuse, original sources unchanged; retained:',base)

# Actual user invokes from gal/[G]/[]: metadata still lives beside data/library.
nested=root/'[G]/[]';nested.mkdir(parents=True)
for game in [mz,mv,twi]:(nested/game).symlink_to(root/game,target_is_directory=True)
env['GAL_COLLECT_OUT']=str(base/'nested-out');r=subprocess.run(['bash',str(script),str(nested)],env=env,capture_output=True,text=True);assert r.returncode==0,r.stdout+r.stderr
found=0
for part in (base/'nested-out').glob('*.part-*'):
 with tarfile.open(part)as t:
  report=json.load(t.extractfile(next(n for n in t.getnames()if n.endswith('__playback/index.json'))));assert len(report['runtime']['matchingItems'])==1;found+=1
assert found==3;assert all(hashlib.sha256(p.read_bytes()).hexdigest()==sha for p,sha in before.items())
print('PASS nested gal/[G]/[] root discovers only named ancestor metadata directories')
