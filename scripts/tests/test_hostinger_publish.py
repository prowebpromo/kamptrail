"""Exercise publication against a local bare remote, including rollback history."""
from pathlib import Path
import json
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'publish-hostinger.js'


class HostingerPublishTests(unittest.TestCase):
    def test_built_branch_is_repeatable_and_retains_previous_release(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            remote, repo = root / 'remote.git', root / 'source'
            def git(*args, cwd=repo):
                return subprocess.check_output(['git', *args], cwd=cwd, text=True, stderr=subprocess.DEVNULL).strip()
            git('init', '--bare', str(remote), cwd=root)
            git('init', str(repo), cwd=root)
            git('config', 'user.name', 'Test')
            git('config', 'user.email', 'test@example.com')
            git('remote', 'add', 'origin', str(remote))
            (repo / 'source.txt').write_text('source must stay out of the release')
            git('add', '.')
            git('commit', '-m', 'source')
            source = git('rev-parse', 'HEAD')
            out = root / 'build'
            for name in ['index.html', 'service-worker.js', 'data/campsites/index.json', 'data/campsites/agency/index.json']:
                target = out / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text('first')
            def publish():
                return subprocess.run(['node', str(SCRIPT), str(out)], cwd=repo, text=True, capture_output=True)
            first = publish()
            self.assertEqual(first.returncode, 0, first.stderr)
            release = git('rev-parse', 'refs/heads/hostinger', cwd=remote)
            self.assertEqual(json.loads(git('show', f'{release}:release.json', cwd=remote))['source_commit'], source)
            self.assertNotIn('source.txt', git('ls-tree', '--name-only', release, cwd=remote))
            self.assertEqual(publish().returncode, 0)
            self.assertEqual(git('rev-parse', 'refs/heads/hostinger', cwd=remote), release)
            (out / 'index.html').write_text('second')
            self.assertEqual(publish().returncode, 0)
            self.assertEqual(git('rev-parse', 'refs/heads/hostinger^', cwd=remote), release)
            self.assertEqual(git('show', 'hostinger:index.html', cwd=remote), 'second')
            (out / '.env').write_text('must never publish')
            self.assertNotEqual(publish().returncode, 0)
            self.assertNotIn('.env', git('ls-tree', '--name-only', 'hostinger', cwd=remote))
