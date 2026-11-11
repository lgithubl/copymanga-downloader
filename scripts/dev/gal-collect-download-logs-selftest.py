"""Collect latest run through a symlink without packaging a >64MB plan."""
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile

base = Path(tempfile.mkdtemp(prefix='gal-download-log-test-'))
root, cache, out = base / 'gal', base / 'cache', base / 'out'
root.mkdir()
for rel in ['runs/previous', 'runs/old', 'runs/latest', 'runs/newer-imys', 'plans/task', 'bundles']:
    (cache / rel).mkdir(parents=True)
(root / 'gal-download').symlink_to(cache, target_is_directory=True)
(cache / 'bundles/never-upload').write_text('bundle payload')
old = cache / 'runs/old/result.json'
old.write_text('{}')
os.utime(old, (1, 1))
old_progress = cache / 'runs/old/progress.json'
old_progress.write_text('{"taskId":"tsk"}')
os.utime(old_progress, (1, 1))
previous = cache / 'runs/previous/progress.json'
previous.write_text('{"taskId":"tsk-second"}')
os.utime(previous, (2, 2))
plan = cache / 'plans/task/plan.json'
with plan.open('wb') as f:
    f.truncate(70 * 1024 * 1024)
before = (plan.stat().st_size, plan.stat().st_mtime_ns)
pointer = {'runDir': '/data/cache/gal-download/runs/latest', 'planPath': '/data/cache/gal-download/plans/task/plan.json'}
(cache / 'plans/task/current.json').write_text(json.dumps(pointer))
result = {'results': [{'plan': pointer['planPath'], 'categoryTotals': {'downloadBundles': 42, 'cachedBundles': 7}, 'repairs': {'candidateFiles': 12}, 'entries': [{'status': 'would-download'}] * 100}]}
# Exercise large-result summarization too, preserving real counts.
(cache / 'runs/latest/result.json').write_text(json.dumps(result) + ' ' * (9 * 1024 * 1024))
(cache / 'runs/latest/run.log').write_text('latest run log')
(cache / 'runs/latest/repairs.json').write_text('{"candidateFiles":12}')
(cache / 'runs/latest/progress.json').write_text('{"taskId":"tsk"}')
(cache / 'runs/newer-imys/progress.json').write_text('{"taskId":"imys"}')
os.utime(cache / 'runs/newer-imys/progress.json', (2100000000, 2100000000))
env = dict(os.environ, GAL_COLLECT_DRYRUN='1', GAL_COLLECT_OUT=str(out), GAL_COLLECT_TS='fixture',
           GAL_COLLECT_RULES='^tsk:ch10340034$', GAL_COLLECT_TSK_LOG='', GH_TOKEN='')
p = subprocess.run(['bash', 'scripts/dev/gal-collect-run.sh', str(root)], env=env, capture_output=True, text=True)
assert p.returncode == 0, p.stdout + p.stderr
assert (plan.stat().st_size, plan.stat().st_mtime_ns) == before
parts = sorted(out.glob('*-g01.tar.gz.part-*'))
assert parts
with tarfile.open(fileobj=io.BytesIO(b''.join(f.read_bytes() for f in parts)), mode='r:gz') as archive:
    names = archive.getnames()
    assert not any('/bundles/' in n or '/old/' in n or '/previous/' in n or '/newer-imys/' in n for n in names), names
    assert 'g01/plans/task/plan.json' not in names
    summaries = [json.load(archive.extractfile(n)) for n in names if n.endswith('.summary.json')]
    plan_summary = next(v for v in summaries if v['source'] == 'plans/task/plan.json')
    assert plan_summary['sourceBytes'] == before[0] and 'omitted' in plan_summary
    row = next(v for v in summaries if v['source'].endswith('result.json'))['data']['results'][0]
    assert row['categoryTotals'] == {'downloadBundles': 42, 'cachedBundles': 7}
    assert row['repairs']['candidateFiles'] == 12
    assert row['entries']['totalItems'] == 100
    assert row['entries']['statusCounts'] == {'would-download': 100}
    assert len(row['entries']['sample']) == 20
assert sum(p.stat().st_size for p in parts) < 1024 * 1024
print('PASS: >64MB plan, large result, exact counts, latest-only symlink collection; source unchanged')
print('Fixture retained:', base)

for count, expected in [('2', {'latest', 'previous'}), ('10', {'latest', 'previous', 'old'})]:
    target = base / ('out-' + count)
    run_env = dict(env, GAL_COLLECT_TSK_LOG=count, GAL_COLLECT_OUT=str(target))
    run = subprocess.run(['bash', 'scripts/dev/gal-collect-run.sh', str(root)], env=run_env, capture_output=True, text=True)
    assert run.returncode == 0, run.stdout + run.stderr
    parts = sorted(target.glob('*-g01.tar.gz.part-*'))
    with tarfile.open(fileobj=io.BytesIO(b''.join(f.read_bytes() for f in parts)), mode='r:gz') as archive:
        names = archive.getnames()
        actual = {n.split('/')[2] for n in names if n.startswith('g01/runs/') and len(n.split('/')) > 3}
        assert actual == expected, (count, actual, names)
        assert not any('/bundles/' in n or '/newer-imys/' in n for n in names)
    assert (plan.stat().st_size, plan.stat().st_mtime_ns) == before
for count in ['0', '-1', 'abc', '1.5']:
    run = subprocess.run(['bash', 'scripts/dev/gal-collect-run.sh', str(root)], env=dict(env, GAL_COLLECT_TSK_LOG=count, GAL_COLLECT_OUT=str(base / ('invalid-' + count))), capture_output=True, text=True)
    assert run.returncode != 0 and 'GAL_COLLECT_TSK_LOG 必须是正整数' in run.stdout + run.stderr
print('PASS: N=2, N greater than available, invalid N rejected; non-TSK excluded, source unchanged')
