"""Black-box persistent collector supervisor tests; no network, all fixtures retained."""
import hashlib, json, os, pathlib, shutil, signal, subprocess, tempfile, time, unittest

SOURCE = pathlib.Path('scripts/dev/gal-collect.sh').resolve()
BASE = pathlib.Path(tempfile.mkdtemp(prefix='gal-bootstrap-tests-'))
print('Fixtures retained:', BASE, flush=True)

GH_STUB = r'''#!/usr/bin/env python3
import json,os,pathlib,sys,time
root=pathlib.Path(os.environ['GAL_STUB_DIR'])
def inc(name):
 p=root/name;n=int(p.read_text())+1 if p.exists() else 1;p.write_text(str(n));return n
conf=json.loads((root/'stub.json').read_text())
if sys.argv[1]=='api':
 n=inc('fetch-count')
 if n<=conf.get('fetch_failures',0):print('network unavailable',file=sys.stderr);sys.exit(1)
 if conf.get('fetch_hang'):time.sleep(60)
 sys.stdout.buffer.write((root/'remote.sh').read_bytes());sys.exit(0)
if sys.argv[1:3]==['release','upload']:
 file=pathlib.Path(sys.argv[4])
 if file.name.endswith('-ERROR.log.gz'):sys.exit(0)
 inc('upload-count')
 if conf.get('upload_hang'):time.sleep(60)
 if conf.get('upload_fail'):sys.exit(1)
 with open(root/'uploaded','a')as f:f.write(file.name+'\n')
 sys.exit(0)
sys.exit(0)
'''

class Bootstrap(unittest.TestCase):
    def setUp(self):
        self.base = BASE/(self._testMethodName+'-'+str(time.time_ns())); self.base.mkdir()
        self.launch = self.base/'launcher'; self.launch.mkdir()
        shutil.copyfile(SOURCE,self.launch/'gal-collect.sh')
        (self.launch/'gh').write_text(GH_STUB); (self.launch/'gh').chmod(0o755)
        self.token = 'test-bootstrap-private-token-do-not-print'
        (self.launch/'github_pat').write_text(self.token)
        self.root = self.base/'gal root'; self.root.mkdir()
        self.env = {k:v for k,v in os.environ.items() if not k.startswith('GAL_') and k not in ('GH_TOKEN','GH_TOKEN_FILE')}
        self.env.update(GAL_STUB_DIR=str(self.base),GAL_COLLECT_POLL_SECONDS='.15',GAL_COLLECT_FETCH_TIMEOUT='3',
                        GAL_COLLECT_RUN_TIMEOUT='3',GAL_COLLECT_UPLOAD_TIMEOUT='3',GAL_COLLECT_STOP_GRACE_SECONDS='.1',GAL_COLLECT_ONCE='1')
        self.config()
        self.remote('1.0')
    def config(self,**values): (self.base/'stub.json').write_text(json.dumps(values))
    def remote(self,version,extra=''):
        (self.base/'remote.sh').write_text('#!/usr/bin/env bash\nVERSION="'+version+'"\nprintf "run\\n" >> "$GAL_STUB_DIR/executions"\n'+extra+'\n')
    def start(self,**env):
        return subprocess.Popen(['bash',str(self.launch/'gal-collect.sh'),str(self.root)],env=dict(self.env,**env),stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
    def finish(self,p,timeout=6):
        try: out=p.communicate(timeout=timeout)[0].decode(); return p.returncode,out
        except subprocess.TimeoutExpired:
            os.killpg(p.pid,signal.SIGKILL);p.communicate();self.fail('Supervisor did not terminate in time')
    def once(self,**env): return self.finish(self.start(**env))
    def count(self): return len((self.base/'executions').read_text().splitlines()) if (self.base/'executions').exists() else 0
    def offsets(self): return list((self.launch/'cache/gal-collect').glob('tasks/*/offset.json'))
    def wait(self,predicate,timeout=5):
        end=time.monotonic()+timeout
        while time.monotonic()<end:
            if predicate():return
            time.sleep(.03)
        self.fail('Expected condition not reached')
    def test_persist_restart_changes_and_parameter_scope(self):
        self.assertEqual(self.once()[0],0); self.assertEqual(self.count(),1)
        first=self.offsets()[0]; old=first.read_bytes()
        self.assertEqual(self.once()[0],0); self.assertEqual(self.count(),1); self.assertEqual(first.read_bytes(),old)
        self.remote('1.1'); self.assertEqual(self.once()[0],0); self.assertEqual(self.count(),2)
        self.remote('1.1','echo changed'); self.assertEqual(self.once()[0],0); self.assertEqual(self.count(),3)
        self.assertEqual(json.loads(first.read_text())['sha256'],hashlib.sha256((self.base/'remote.sh').read_bytes()).hexdigest())
        self.assertEqual(self.once(GAL_COLLECT_ONLY='different')[0],0); self.assertEqual(self.count(),4); self.assertEqual(len(self.offsets()),2)
        # Timing changes must not create a fresh task offset or rerun a completed version.
        self.assertEqual(self.once(GAL_COLLECT_POLL_SECONDS='2')[0],0); self.assertEqual(self.count(),4)
    def test_failure_retains_last_success_then_same_content_retries(self):
        self.assertEqual(self.once()[0],0); offset=self.offsets()[0]; old=offset.read_bytes()
        self.remote('2.0','[ -e "$GAL_STUB_DIR/allow" ] || exit 1')
        self.assertEqual(self.once()[0],1); self.assertEqual(offset.read_bytes(),old)
        (self.base/'allow').write_text('yes')
        self.assertEqual(self.once()[0],0); self.assertEqual(self.count(),3); self.assertEqual(json.loads(offset.read_text())['version'],'2.0')
    def test_force_runs_once_without_creating_a_separate_offset(self):
        self.assertEqual(self.once()[0],0)
        p=self.start(GAL_COLLECT_ONCE='0',GAL_COLLECT_FORCE='1')
        try:
            self.wait(lambda:self.count()==2)
            self.wait(lambda:int((self.base/'fetch-count').read_text() or '0')>=4)
            self.assertEqual(self.count(),2);self.assertEqual(len(self.offsets()),1)
        finally:p.send_signal(signal.SIGTERM);self.finish(p)
    def test_fetch_failure_and_timeout_do_not_advance(self):
        self.config(fetch_failures=1); self.assertEqual(self.once()[0],1); self.assertEqual(self.count(),0); self.assertEqual(self.offsets(),[])
        self.config(fetch_hang=True); start=time.monotonic(); self.assertEqual(self.once(GAL_COLLECT_FETCH_TIMEOUT='.8')[0],1); self.assertLess(time.monotonic()-start,5)
        self.config(); self.assertEqual(self.once()[0],0); self.assertEqual(self.count(),1)
    def test_loop_survives_error_skips_same_then_runs_update(self):
        self.config(fetch_failures=1); p=self.start(GAL_COLLECT_ONCE='0')
        try:
            self.wait(lambda:self.count()==1)
            self.wait(lambda:int((self.base/'fetch-count').read_text() or '0')>=4)
            self.assertEqual(self.count(),1)
            self.remote('1.2'); self.wait(lambda:self.count()==2)
            p.send_signal(signal.SIGTERM); rc,out=self.finish(p); self.assertEqual(rc,130); self.assertIn('本轮失败',out)
        finally:
            if p.poll() is None:p.send_signal(signal.SIGTERM);self.finish(p)
    def test_lock_prevents_two_collectors(self):
        p=self.start(GAL_COLLECT_ONCE='0')
        try:
            self.wait(lambda:len(self.offsets())==1)
            rc,out=self.once(); self.assertEqual(rc,3); self.assertIn('已运行',out); self.assertEqual(self.count(),1)
        finally:p.send_signal(signal.SIGTERM);self.finish(p)
    def test_resume_only_failed_uploads_across_restarts(self):
        self.remote('1.0','mkdir -p "$GAL_COLLECT_OUT"\nf="$GAL_COLLECT_OUT/sample with space.part-000"\nprintf payload > "$f"\nprintf "FAIL %s\\n" "$f" > "$GAL_COLLECT_OUT/.failed"\nexit 2')
        self.assertEqual(self.once()[0],1); self.assertEqual(self.count(),1); self.assertEqual(self.offsets(),[])
        self.config(upload_fail=True); self.assertEqual(self.once()[0],1); self.assertEqual(self.count(),1)
        self.config(upload_hang=True); self.assertEqual(self.once(GAL_COLLECT_UPLOAD_TIMEOUT='.8')[0],1); self.assertEqual(self.count(),1)
        self.config(); self.assertEqual(self.once()[0],0); self.assertEqual(self.count(),1)
        offset=json.loads(self.offsets()[0].read_text()); self.assertTrue(offset['resumed_uploads'])
        self.assertEqual((self.base/'uploaded').read_text(),'sample with space.part-000\n')
        self.assertTrue((pathlib.Path(offset['run_dir'])/'output/sample with space.part-000').exists())
    def child_script(self):
        code='import os,pathlib,signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);pathlib.Path(os.environ["GAL_STUB_DIR"],"child-pid").write_text(str(os.getpid()));time.sleep(60)'
        return "python3 -c '"+code+"' &\nwait"
    def assert_child_stopped(self):
        pid=int((self.base/'child-pid').read_text())
        def gone():
            result=subprocess.run(['ps','-p',str(pid),'-o','stat='],capture_output=True,text=True)
            return result.returncode!=0 or result.stdout.strip().startswith('Z')
        self.wait(gone,3)
    def test_run_timeout_kills_entire_process_group(self):
        self.remote('1.0',self.child_script()); start=time.monotonic(); rc,out=self.once(GAL_COLLECT_RUN_TIMEOUT='.8')
        self.assertEqual(rc,1); self.assertIn('超时',out); self.assertLess(time.monotonic()-start,5); self.assertEqual(self.offsets(),[]); self.assert_child_stopped()
    def test_manual_stop_kills_descendants_and_preserves_offset(self):
        self.remote('1.0',self.child_script()); p=self.start(GAL_COLLECT_ONCE='0',GAL_COLLECT_RUN_TIMEOUT='30')
        self.wait(lambda:(self.base/'child-pid').exists()); p.send_signal(signal.SIGINT); rc,out=self.finish(p)
        self.assertEqual(rc,130); self.assertEqual(self.offsets(),[]); self.assert_child_stopped()
    def test_invalid_download_and_pinned_hash_never_execute(self):
        for payload in ['<html>bad</html>','#!/bin/bash\nVERSION="1.0"\nif','#!/bin/bash\necho no-version']:
            (self.base/'remote.sh').write_text(payload); self.assertEqual(self.once()[0],1)
        self.remote('1.0'); self.assertEqual(self.once(GAL_COLLECT_SHA256='f'*64)[0],1)
        self.assertEqual(self.count(),0); self.assertEqual(self.offsets(),[])
    def test_secret_redaction_and_offset_contains_no_credentials(self):
        self.remote('1.0','echo "$GH_TOKEN"')
        rc,out=self.once(); self.assertEqual(rc,0); self.assertNotIn(self.token,out)
        for file in (self.launch/'cache').rglob('*'):
            if file.is_file():self.assertNotIn(self.token.encode(),file.read_bytes(),str(file))
    def test_missing_pending_file_recollects_next_round(self):
        self.remote('1.0','mkdir -p "$GAL_COLLECT_OUT"\nprintf "FAIL %s/missing.part\\n" "$GAL_COLLECT_OUT" > "$GAL_COLLECT_OUT/.failed"\nexit 2')
        self.assertEqual(self.once()[0],1); self.assertEqual(self.once()[0],1); self.assertEqual(self.count(),1)
        self.assertEqual(self.once()[0],1); self.assertEqual(self.count(),2)

class CoreUpload(unittest.TestCase):
    def test_read_failure_is_not_reported_as_success(self):
        base=BASE/('read-failure-'+str(time.time_ns()));base.mkdir()
        root=base/'gal';game=root/'Small Game';game.mkdir(parents=True)
        source=game/'sample.exe';source.write_bytes(b'fixture executable data, never run')
        src=pathlib.Path('scripts/dev/gal-collect-run.sh').read_text()
        marker='import base64, collections, gzip, hashlib, io, os, re, struct, sys, tarfile, time, json, zlib'
        injection="\nimport builtins\n_original_open=builtins.open\ndef _read_error(file,*args,**kwargs):\n    if os.fspath(file)=="+repr(str(source))+" and args and args[0]=='rb':raise OSError('fixture read failure')\n    return _original_open(file,*args,**kwargs)\nbuiltins.open=_read_error\n"
        script=base/'core.sh';script.write_text(src.replace(marker,marker+injection))
        env={k:v for k,v in os.environ.items() if not k.startswith('GAL_COLLECT_')}
        env.update(GAL_COLLECT_RULES='all',GAL_COLLECT_DRYRUN='1',GAL_COLLECT_OUT=str(base/'out'))
        result=subprocess.run(['bash',str(script),str(root)],env=env,capture_output=True,text=True,timeout=10)
        self.assertNotEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertIn('本轮不能记为成功',result.stdout+result.stderr)
        self.assertIn('ERROR',(base/'out/manifest.tsv').read_text())
        self.assertEqual(source.read_bytes(),b'fixture executable data, never run')
    def test_single_upload_timeout_and_cache_archive(self):
        base=BASE/('core-upload-'+str(time.time_ns()));base.mkdir()
        gh=base/'gh';gh.write_text(GH_STUB);gh.chmod(0o755)
        (base/'stub.json').write_text(json.dumps({'upload_hang':True}))
        src=pathlib.Path('scripts/dev/gal-collect-run.sh').read_text()
        upload=src[src.index('upload_one()'):src.index('archive_tmp()')]
        archive=src[src.index('archive_tmp()'):src.index('ERROR_DONE=0')]
        script=base/'test.sh'
        script.write_text('set -uo pipefail\nPY=python3\nGH="$GAL_STUB_DIR/gh"\nTAG=31\nREPO=test/repo\nDRYRUN=0\nOUT="$GAL_STUB_DIR/output"\nlog(){ echo "$*"; }\nsleep(){ :; }\n'+upload+archive+'mkdir -p "$OUT"\nprintf payload > "$OUT/part"\nif upload_one "$OUT/part"; then exit 9; fi\narchive_tmp "$OUT/part"\n')
        env={**os.environ,'GAL_STUB_DIR':str(base),'GAL_COLLECT_UPLOAD_TIMEOUT':'2','GAL_COLLECT_STOP_GRACE_SECONDS':'.1','GAL_COLLECT_ARCHIVE_DIR':str(base/'archive')}
        start=time.monotonic();result=subprocess.run(['bash',str(script)],env=env,capture_output=True,text=True,timeout=12)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr);self.assertLess(time.monotonic()-start,10)
        self.assertEqual((base/'upload-count').read_text(),'3')
        self.assertIn('上传超时',result.stderr);self.assertEqual(len(list((base/'archive').glob('*/part'))),1)
        self.assertFalse((base/'output/part').exists())

if __name__=='__main__':unittest.main(verbosity=2)
