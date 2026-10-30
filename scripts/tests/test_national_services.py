import copy
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import import_services as services
from services_regions import URLS, REGISTRY, validate_resolved_url
from services_parse_budget import bounded_process
from stage_services import validate_checkpoint, stage_one, digest, checked_regions
from aggregate_services import aggregate


class Response(io.BytesIO):
    def __init__(self, raw, length):
        super().__init__(raw)
        self.headers = {'Content-Length': str(length)}
    def geturl(self):
        return URLS['RI'].replace('latest', '250101')


class Clock:
    def __init__(self):
        self.now = 100
        self.pauses = []
    def monotonic(self):
        return self.now
    def sleep(self, seconds):
        self.pauses.append(seconds)
        self.now += seconds


class NationalServicesTests(unittest.TestCase):
    def setUp(self):
        # These staging/handoff fixtures are deliberately older than live data.
        # Give them an explicit accepted-source baseline so accepting more states
        # cannot silently turn a resume test into a production-date comparison.
        temporary = tempfile.TemporaryDirectory(prefix='national-test-checkout-')
        self.addCleanup(temporary.cleanup)
        checkout = Path(temporary.name)
        (checkout / 'scripts').symlink_to(SCRIPTS, target_is_directory=True)
        sources = checkout / 'data/sources/services'
        sources.mkdir(parents=True)
        source = {'kind':'geofabrik', 'url':URLS['UT'],
                  'extract_timestamp':'2025-01-01T00:00:00Z', 'retrieved_at':'2025-03-01T00:00:00Z',
                  'sha256':'a'*64, 'license':'ODbL-1.0', 'categories':list(services.CATEGORIES)}
        point = {'id':'osm:node:9001', 'osm_type':'node', 'osm_id':'9001', 'osm_version':1,
                 'edited_at':'2025-01-01T00:00:00Z', 'coordinates':[-111.9,40.8],
                 'name':'Fixture fuel', 'categories':['fuel'], 'tags':{'amenity':'fuel'},
                 'states':['UT'], 'source_region':'UT'}
        (sources / 'UT.json').write_text(json.dumps({'version':2,'region':'UT','source':source,'items':[point]}))
        legacy = {'kind':'legacy', 'url':'https://www.openstreetmap.org', 'extract_timestamp':None,
                  'retrieved_at':None, 'sha256':'b'*64, 'license':'ODbL-1.0', 'categories':['dump','water','lpg']}
        legacy_point = {**point, 'id':'osm:node:9002', 'osm_id':'9002', 'coordinates':[-117,33],
                        'name':'Fixture dump', 'categories':['dump'], 'tags':{},
                        'states':['CA'], 'source_region':'legacy', 'retrieved_at':'2025-03-01T00:00:00Z'}
        (sources / 'legacy.json').write_text(json.dumps({'version':2,'region':'legacy','source':legacy,'items':[legacy_point]}))
        for target in ('stage_services.ROOT', 'aggregate_services.ROOT'):
            override = patch(target, checkout)
            override.start()
            self.addCleanup(override.stop)

    def test_official_exact_fifty_state_projection(self):
        self.assertEqual(len(URLS), 50)
        self.assertEqual(set(URLS), services.STATES)
        self.assertEqual(REGISTRY['index_url'], 'https://download.geofabrik.de/index-v1.json')
        self.assertEqual(URLS['MD'], 'https://download.geofabrik.de/north-america/us/maryland-latest.osm.pbf')
        for state, row in REGISTRY['regions'].items():
            self.assertEqual(row['iso3166_2'], 'US-' + state)
        for values in ['UT UT', 'DC', 'RI --allow-anywhere', '']:
            with self.assertRaises(ValueError): checked_regions(values)

    def test_same_requested_region_redirect_binding(self):
        handler = services.FixedRedirect('RI')
        good = URLS['RI'].replace('latest', '250101')
        request = urllib.request.Request(URLS['RI'])
        self.assertEqual(handler.redirect_request(request, None, 302, '', {}, good).full_url, good)
        for bad in [URLS['UT'], good.replace('https:', 'http:'), good.replace('download.', 'osm-internal.download.'), good + '?key=x', good.replace('250101', '250230'), good.replace('250101', '681231'), good.replace('rhode-island', 'rhode-island/../utah')]:
            with self.assertRaises(ValueError): validate_resolved_url('RI', bad)
        with self.assertRaises(ValueError):
            handler.redirect_request(urllib.request.Request(URLS['UT']), None, 302, '', {}, good)

    def test_truncated_download_retains_last_good(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'RI.osm.pbf'
            p.write_bytes(b'last-good')
            opener = unittest.mock.Mock()
            opener.open.return_value = Response(b'short', 100)
            with patch('urllib.request.build_opener', return_value=opener):
                with self.assertRaisesRegex(ValueError, 'Truncated'):
                    services.download('RI', p)
            self.assertEqual(p.read_bytes(), b'last-good')
            self.assertFalse(p.with_suffix('.part').exists())

    def test_initial_response_timeout_retries_same_state_then_succeeds(self):
        for failure in [TimeoutError('initial status timeout'), urllib.error.URLError(TimeoutError('initial status timeout'))]:
            with self.subTest(failure=type(failure).__name__), tempfile.TemporaryDirectory() as tmp:
                path=Path(tmp)/'RI.osm.pbf'; path.write_bytes(b'last-good')
                clock=Clock(); opener=unittest.mock.Mock()
                opener.open.side_effect=[failure,Response(b'complete',8)]
                with patch('urllib.request.build_opener',return_value=opener) as build, patch('import_services.time.monotonic',clock.monotonic), patch('import_services.time.sleep',clock.sleep):
                    receipt=services.download('RI',path)
                self.assertEqual(path.read_bytes(),b'complete')
                self.assertEqual(receipt['sha256'],hashlib.sha256(b'complete').hexdigest())
                self.assertEqual(receipt['download_seconds'],1)
                self.assertEqual(clock.pauses,[1])
                self.assertEqual(opener.open.call_count,2)
                self.assertTrue(all(call.args[0].full_url==URLS['RI'] for call in opener.open.call_args_list))
                self.assertEqual([call.args[0].region for call in build.call_args_list],['RI','RI'])
                self.assertIsNot(build.call_args_list[0].args[0],build.call_args_list[1].args[0])
                self.assertFalse(path.with_suffix('.part').exists())

    def test_three_initial_timeouts_exhaust_without_replacing_last_good(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'RI.osm.pbf';path.write_bytes(b'last-good')
            path.with_suffix('.part').write_bytes(b'interrupted-old-partial')
            clock=Clock();opener=unittest.mock.Mock()
            opener.open.side_effect=TimeoutError('initial status timeout')
            with patch('urllib.request.build_opener',return_value=opener), patch('import_services.time.monotonic',clock.monotonic), patch('import_services.time.sleep',clock.sleep):
                with self.assertRaises(TimeoutError):services.download('RI',path)
            self.assertEqual(opener.open.call_count,3)
            self.assertEqual(clock.pauses,[1,3])
            self.assertEqual(path.read_bytes(),b'last-good')
            self.assertFalse(path.with_suffix('.part').exists())

    def test_startup_retry_shares_original_deadline_and_bounds_backoff(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'RI.osm.pbf';path.write_bytes(b'last-good')
            clock=Clock();opener=unittest.mock.Mock()
            def timeout(request,timeout):
                clock.now+=services.MAX_SECONDS-.5
                raise TimeoutError('initial status timeout')
            opener.open.side_effect=timeout
            with patch('urllib.request.build_opener',return_value=opener), patch('import_services.time.monotonic',clock.monotonic), patch('import_services.time.sleep',clock.sleep):
                with self.assertRaisesRegex(ValueError,'download budget'):services.download('RI',path)
            self.assertEqual(opener.open.call_count,1)
            self.assertEqual(clock.pauses,[.5])
            self.assertEqual(clock.now,100+services.MAX_SECONDS)
            self.assertEqual(path.read_bytes(),b'last-good')
            self.assertFalse(path.with_suffix('.part').exists())

    def test_startup_retries_do_not_extend_body_deadline(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'RI.osm.pbf';path.write_bytes(b'last-good')
            clock=Clock();opener=unittest.mock.Mock()
            response=Response(b'complete',8)
            def opened(request,timeout):
                if opener.open.call_count==1:
                    clock.now+=services.MAX_SECONDS-40
                    raise TimeoutError('initial status timeout')
                self.assertEqual(timeout,39)
                return response
            chunks=iter([b'complete',b''])
            def read(size):
                chunk=next(chunks)
                if not chunk:clock.now+=40
                return chunk
            response.read=read;opener.open.side_effect=opened
            with patch('urllib.request.build_opener',return_value=opener), patch('import_services.time.monotonic',clock.monotonic), patch('import_services.time.sleep',clock.sleep):
                with self.assertRaisesRegex(ValueError,'download budget'):services.download('RI',path)
            self.assertEqual(opener.open.call_count,2)
            self.assertEqual(path.read_bytes(),b'last-good')
            self.assertFalse(path.with_suffix('.part').exists())

    def test_http_auth_redirect_and_partial_body_errors_are_not_retried(self):
        failures=[urllib.error.HTTPError(URLS['RI'],code,'refused',{},None) for code in (401,403,404)]
        failures.extend([urllib.error.URLError('not a timeout'),ValueError('invalid redirect')])
        for failure in failures:
            with self.subTest(failure=str(failure)), tempfile.TemporaryDirectory() as tmp:
                path=Path(tmp)/'RI.osm.pbf';path.write_bytes(b'last-good')
                opener=unittest.mock.Mock();opener.open.side_effect=failure
                with patch('urllib.request.build_opener',return_value=opener), patch('import_services.time.sleep') as sleep:
                    with self.assertRaises(type(failure)):services.download('RI',path)
                self.assertEqual(opener.open.call_count,1)
                sleep.assert_not_called()
                self.assertEqual(path.read_bytes(),b'last-good')
                self.assertFalse(path.with_suffix('.part').exists())
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'RI.osm.pbf';path.write_bytes(b'last-good')
            response=Response(b'',8);response.read=unittest.mock.Mock(side_effect=[b'part',TimeoutError('body timeout')])
            opener=unittest.mock.Mock();opener.open.return_value=response
            with patch('urllib.request.build_opener',return_value=opener), patch('import_services.time.sleep') as sleep:
                with self.assertRaises(TimeoutError):services.download('RI',path)
            self.assertEqual(opener.open.call_count,1)
            sleep.assert_not_called()
            self.assertEqual(path.read_bytes(),b'last-good')
            self.assertFalse(path.with_suffix('.part').exists())

    def test_parse_walltime_and_disk_failure_never_touch_accepted_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            accepted = directory / 'UT.json'; accepted.write_bytes(b'accepted')
            with self.assertRaisesRegex(ValueError, 'walltime'):
                bounded_process([sys.executable, '-c', 'import time; time.sleep(30)'], directory, seconds=.15)
            self.assertEqual(accepted.read_bytes(), b'accepted')
            with self.assertRaisesRegex(ValueError, 'disk budget'):
                bounded_process([sys.executable, '-c', "import pathlib,time; pathlib.Path('" + str(directory / 'large') + "').write_bytes(b'x'*4096); time.sleep(30)"], directory, disk_bytes=2048)
            self.assertEqual(accepted.read_bytes(), b'accepted')
            with self.assertRaisesRegex(ValueError, 'MemoryError'):
                bounded_process([sys.executable, '-c', 'bytearray(5 * 1024**3)'], directory)
            self.assertEqual(accepted.read_bytes(), b'accepted')

    def checkpoint(self, root, region='RI', batch='test', count=1, extract='2025-01-01T00:00:00Z'):
        p = root / region; p.mkdir()
        record = {'id':'osm:node:1', 'osm_type':'node', 'osm_id':'1', 'osm_version':1, 'edited_at':'2025-01-01T00:00:00Z', 'coordinates':[-71.4,41.8], 'name':'Station', 'categories':['fuel'], 'tags':{'amenity':'fuel'}, 'states':[region], 'source_region':region}
        source = {'kind':'geofabrik','url':URLS[region], 'extract_timestamp':extract, 'retrieved_at':'2025-03-01T00:00:00Z', 'sha256':'a'*64, 'license':'ODbL-1.0', 'categories':list(services.CATEGORIES)}
        (p/'source.json').write_text(json.dumps({'version':2,'region':region,'source':source,'items':[{**record,'id':f'osm:node:{i}','osm_id':str(i)} for i in range(1,count+1)]}))
        (p/'report.json').write_text(json.dumps({'source':source,'statistics':{'accepted':count,'parser_version':'4.3.2','sha256':source['sha256'],'url':source['url'],'resolved_url':source['url'].replace('latest',extract[2:10].replace('-','')),'retrieved_at':source['retrieved_at'],'bytes':100,'quarantined':0},'quarantine':[]}))
        receipt={'version':1,'region':region,'batch':batch,'registry_sha256':digest(SCRIPTS/'services-regions.json'),'accepted':count,'hashes':{name:digest(p/name) for name in ('source.json','report.json')}}
        (p/'receipt.json').write_text(json.dumps(receipt))
        return p

    def test_resume_checks_content_and_batch_without_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); stage=root/'stage'; stage.mkdir(); p=self.checkpoint(stage)
            with patch('stage_services.subprocess.run', wraps=__import__('subprocess').run) as run:
                self.assertEqual(stage_one('RI',stage,root/'raw','test'),'resumed')
                self.assertEqual(len(run.call_args_list),1) # schema check only
            (p/'source.json').write_text('{}')
            with self.assertRaisesRegex(ValueError,'hash-mismatched'):validate_checkpoint(p,'RI','test')
            with self.assertRaisesRegex(ValueError,'binding'):validate_checkpoint(p,'RI','other')

    def test_failed_refresh_and_interrupted_checkpoint_replacement_retain_last_good(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); stage=root/'stage';stage.mkdir();p=self.checkpoint(stage)
            before=(p/'source.json').read_bytes()
            # Crash after previous checkpoint rename is recovered before resume.
            p.rename(stage/'.RI-previous')
            self.assertEqual(stage_one('RI',stage,root/'raw','test'),'resumed')
            self.assertEqual((p/'source.json').read_bytes(),before)
            # Import/download/parse failure before checkpoint leaves accepted bytes.
            with patch('stage_services.run_import', side_effect=ValueError('simulated parse budget failure')):
                with self.assertRaisesRegex(ValueError,'parse budget'):
                    stage_one('RI',stage,root/'raw','test',resume=False)
            self.assertEqual((p/'source.json').read_bytes(),before)
            failure=json.loads((stage/'RI-failure.json').read_bytes())
            self.assertTrue(failure['last_good_retained'])
            validate_checkpoint(p,'RI','test')

    def test_refresh_obeys_both_accepted_and_checkpoint_regression_and_loss_guards(self):
        # An older checkpoint cannot authorize regression or shrink versus accepted
        # evidence; its own larger count also keeps its loss guard binding.
        cases = [('date',1,10,'2025-01-15T00:00:00Z',10,'date regression'),
                 ('accepted_loss',1,10,'2025-02-02T00:00:00Z',1,'shrink'),
                 ('checkpoint_loss',10,5,'2025-02-02T00:00:00Z',5,'shrink')]
        for name, checkpoint_count, accepted_count, candidate_date, candidate_count, reason in cases:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp); stage=root/'stage'; stage.mkdir()
                checkpoint=self.checkpoint(stage,count=checkpoint_count)
                checkout=root/'checkout'; checkout.mkdir()
                (checkout/'scripts').symlink_to(SCRIPTS,target_is_directory=True)
                accepted_dir=checkout/'data/sources/services'; accepted_dir.mkdir(parents=True)
                accepted=copy.deepcopy(json.loads((checkpoint/'source.json').read_bytes()))
                accepted['source']['extract_timestamp']='2025-02-01T00:00:00Z'
                template=accepted['items'][0]
                accepted['items']=[{**template,'id':f'osm:node:{i}','osm_id':str(i)} for i in range(1,accepted_count+1)]
                accepted_path=accepted_dir/'RI.json'; accepted_path.write_text(json.dumps(accepted))
                candidate=copy.deepcopy(accepted)
                candidate['source']['extract_timestamp']=candidate_date
                candidate['items']=[{**template,'id':f'osm:node:{i}','osm_id':str(i)} for i in range(1,candidate_count+1)]
                before={p:p.read_bytes() for p in [accepted_path,*checkpoint.iterdir()] if p.is_file()}
                def imported(command):
                    self.assertIn('--reuse-download',command)
                    output=Path(command[command.index('--output-dir')+1])/'RI.json'
                    services.write_source(output,candidate)
                    report=json.loads((checkpoint/'report.json').read_bytes())
                    report['source']=candidate['source']
                    report['statistics'].update({'accepted':candidate_count,'resolved_url':URLS['RI'].replace('latest',candidate_date[2:10].replace('-',''))})
                    (root/'raw/RI-report.json').write_text(json.dumps(report))
                with patch('stage_services.ROOT',checkout), patch('stage_services.run_import',side_effect=imported):
                    with self.assertRaisesRegex(ValueError,reason):
                        stage_one('RI',stage,root/'raw','test',resume=False,reuse_download=True)
                for path, raw in before.items():
                    self.assertEqual(path.read_bytes(),raw)
                self.assertFalse((stage/'.RI-previous').exists())

    def test_resume_and_aggregation_recheck_current_accepted_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); stage=root/'stage';stage.mkdir(); checkpoint=self.checkpoint(stage)
            checkout=root/'checkout';checkout.mkdir();(checkout/'scripts').symlink_to(SCRIPTS,target_is_directory=True)
            sources=checkout/'data/sources/services';sources.mkdir(parents=True)
            accepted=json.loads((checkpoint/'source.json').read_bytes())
            accepted['source']['extract_timestamp']='2025-02-01T00:00:00Z'
            accepted_path=sources/'RI.json';accepted_path.write_text(json.dumps(accepted))
            destination=root/'assets';destination.mkdir();(destination/'index.json').write_bytes(b'last-good')
            before={p:p.read_bytes() for p in [accepted_path,*checkpoint.iterdir()] if p.is_file()}
            with patch('stage_services.ROOT',checkout), patch('aggregate_services.ROOT',checkout):
                with self.assertRaisesRegex(ValueError,'date regression'):
                    stage_one('RI',stage,root/'raw','test')
                with self.assertRaisesRegex(ValueError,'date regression'):
                    aggregate(stage,destination,'test',['RI'])
            self.assertEqual((destination/'index.json').read_bytes(),b'last-good')
            for path,raw in before.items():self.assertEqual(path.read_bytes(),raw)

    def test_incomplete_aggregate_preserves_last_good_and_regional_proof_is_explicit(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); stage=root/'stage';stage.mkdir();self.checkpoint(stage)
            dest=root/'assets'; dest.mkdir(); (dest/'index.json').write_text('last-good')
            with self.assertRaises(FileNotFoundError):aggregate(stage,dest,'test')
            self.assertEqual((dest/'index.json').read_text(),'last-good')
            (dest/'index.json').unlink()
            receipt=aggregate(stage,dest,'test',['RI'])
            self.assertFalse(receipt['national_complete'])
            manifest=json.loads((dest/'index.json').read_bytes())
            self.assertLessEqual((dest/'index.json').stat().st_size,1024*1024)
            self.assertLessEqual(len(manifest['shards']),4096)
            self.assertLessEqual(manifest['total'],1000000)
            for shard in manifest['shards']:
                raw=(dest/shard['url']).read_bytes()
                self.assertEqual(hashlib.sha256(raw).hexdigest(),shard['sha256'])
                self.assertLessEqual(len(raw),512*1024)
                self.assertLessEqual(shard['count'],1500)

    def test_candidate_handoff_rebuilds_exact_assets_without_original_checkpoints(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); stage=root/'stage';stage.mkdir(); checkpoint=self.checkpoint(stage)
            expected={name:(checkpoint/name).read_bytes() for name in ('source.json','report.json','receipt.json')}
            destination=root/'candidate'
            receipt=aggregate(stage,destination,'test',['RI'])
            self.assertEqual((destination/'sources/RI.json').read_bytes(),expected['source.json'])
            for name in ('report.json','receipt.json'):
                self.assertEqual((destination/'checkpoints/RI'/name).read_bytes(),expected[name])
            # Regional candidates also retain the exact accepted UT and legacy
            # wrappers used by the builder, rather than just refreshed states.
            self.assertEqual(set(receipt['source_files']),{'sources/RI.json','sources/UT.json','sources/legacy.json'})
            for relative, sha256 in receipt['source_files'].items():
                self.assertEqual(digest(destination/relative),sha256)
            state_receipt=json.loads((destination/'checkpoints/RI/receipt.json').read_bytes())
            self.assertEqual(state_receipt,receipt['state_receipts']['RI'])
            self.assertEqual(digest(destination/'sources/RI.json'),state_receipt['hashes']['source.json'])
            self.assertEqual(digest(destination/'checkpoints/RI/report.json'),state_receipt['hashes']['report.json'])
            # Only packaged inputs remain available to this independent rebuild.
            shutil.rmtree(stage)
            rebuilt=root/'rebuilt'
            subprocess.run(['node',str(SCRIPTS/'build-services.js'),str(destination/'sources'),str(rebuilt)],check=True,capture_output=True)
            self.assertEqual((rebuilt/'index.json').read_bytes(),(destination/'index.json').read_bytes())
            self.assertEqual((rebuilt/'services.json').read_bytes(),(destination/'services.json').read_bytes())
            manifest=json.loads((rebuilt/'index.json').read_bytes())
            for shard in manifest['shards']:
                self.assertEqual((rebuilt/shard['url']).read_bytes(),(destination/shard['url']).read_bytes())

    def test_aggregate_rejects_unbound_source_before_destination_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);stage=root/'stage';stage.mkdir();checkpoint=self.checkpoint(stage)
            destination=root/'candidate';destination.mkdir();(destination/'index.json').write_bytes(b'last-good')
            # Source bytes must remain bound to the checkpoint proof at handoff.
            (checkpoint/'source.json').write_bytes(b'{}')
            with self.assertRaisesRegex(ValueError,'hash-mismatched'):
                aggregate(stage,destination,'test',['RI'])
            self.assertEqual(list(destination.iterdir()),[destination/'index.json'])
            self.assertEqual((destination/'index.json').read_bytes(),b'last-good')
            checkout=root/'checkout';sources=checkout/'data/sources/services';sources.mkdir(parents=True)
            # A misnamed retained wrapper must not silently acquire another
            # state's normalized promotion path or duplicate its source region.
            (sources/'UT.json').write_text(json.dumps({'region':'RI'}))
            with patch('aggregate_services.ROOT',checkout):
                with self.assertRaisesRegex(ValueError,'filename/region'):
                    aggregate(stage,destination,'test',['RI'])
            self.assertEqual((destination/'index.json').read_bytes(),b'last-good')


if __name__ == '__main__': unittest.main()
