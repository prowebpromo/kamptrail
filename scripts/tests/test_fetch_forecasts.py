"""Producer failures must preserve unknown values and the last complete snapshot."""
import io
import json
import sys
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fetch_forecasts as f
try:
    import numpy as np
    from pyproj import Proj
    import scipy
    NATIVE = True
except ImportError:
    NATIVE = False

NOW = f.utc('2026-10-29T23:24:07Z')


class ProducerTests(unittest.TestCase):
    def files(self):
        return [dict(region=r, url=f.URLS[r], etag='"test"', bytes=4,
                     last_modified=f.stamp(NOW-timedelta(minutes=30)), sha256=f.digest(b'GRIB'))
                for r in f.REGIONS]

    def test_kelvin_conversion_keeps_zero_negative_and_null(self):
        self.assertEqual([f.temperature(v) for v in (273.15, 263.15, 280.15, None, float('nan'), 999)],
                         [0, -10, 7, None, None, None])

    def test_period_gaps_duplicates_and_invalid_dates_fail(self):
        for times in (['2026-10-30T00:00:00Z']*2,
                      ['2026-10-30T00:00:00Z','2026-10-30T04:00:00Z'],
                      ['2026-02-30T00:00:00Z','2026-03-01T00:00:00Z']):
            with self.assertRaises(f.ForecastError): f.inventory(times)
        with self.assertRaises(f.ForecastError): f.utc('2026-10-29T23:00:00+00:00')

    def test_full_24_and_48_hour_windows_require_all_published_values(self):
        times = [f.stamp(NOW+timedelta(hours=n)) for n in range(49)]
        values = [0]*49
        self.assertTrue(f.complete_window(times, values, NOW, 48))
        values[40] = None
        self.assertTrue(f.complete_window(times, values, NOW, 24))
        self.assertFalse(f.complete_window(times, values, NOW, 48))
        self.assertFalse(f.complete_window(times[:25], values[:25], NOW, 48))
        values[4] = float('nan')
        self.assertFalse(f.complete_window(times, values, NOW, 24))

    def test_expiry_uses_oldest_object_and_never_generation_to_refresh_it(self):
        files = self.files()
        files[0]['last_modified'] = f.stamp(NOW-timedelta(hours=2))
        self.assertEqual(f.expiry(files, NOW), NOW+timedelta(hours=1))
        with self.assertRaises(f.ForecastError): f.expiry(files, NOW+timedelta(hours=1))
        files[0]['last_modified'] = f.stamp(NOW+timedelta(hours=1))
        with self.assertRaises(f.ForecastError): f.expiry(files, NOW)
        with self.assertRaises(f.ForecastError): f.expiry(files[:2], NOW)

    def test_conditional_304_keeps_source_hash_and_old_meteorological_age(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory)
            meta = self.files()[0]
            (p/'conus.bin').write_bytes(b'GRIB')
            (p/'conus.json').write_bytes(f.encoded(meta))
            def not_modified(*args, **kwargs): raise HTTPError(f.URLS['conus'],304,'Not modified',{},None)
            self.assertEqual(f.fetch_source(p,'conus',f.Budget(p),opener=not_modified),meta)
            (p/'conus.bin').write_bytes(b'FAIL')
            with self.assertRaises(f.ForecastError): f.fetch_source(p,'conus',f.Budget(p),offline=True)

    def test_download_hashes_actual_body_and_truncated_download_preserves_cache(self):
        class Response(io.BytesIO):
            status = 200
            headers = {'Last-Modified':'Thu, 29 Oct 2026 23:00:00 GMT','ETag':'"new"','Content-Length':'4'}
            def geturl(self): return f.URLS['conus']
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory)
            result = f.fetch_source(p,'conus',f.Budget(p),opener=lambda *a,**k:Response(b'GRIB'))
            self.assertEqual(result['sha256'], f.digest(b'GRIB'))
            with self.assertRaises(f.ForecastError):
                f.fetch_source(p,'conus',f.Budget(p),opener=lambda *a,**k:Response(b'BAD'))
            self.assertEqual(f.cached_source(p,'conus'),result)

    def test_budget_rejects_download_and_cache_overflow(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(f.ForecastError): f.Budget(d).add(f.MAX_SOURCE_BYTES+1)
            with patch.object(f,'MAX_CACHE_BYTES',3):
                with self.assertRaises(f.ForecastError): f.Budget(d).add(4)

    def test_oversized_generation_cannot_replace_existing_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory); (p/'manifest.json').write_bytes(b'previous')
            with patch.object(f,'MAX_RAW_BYTES',1):
                with self.assertRaises(f.ForecastError):
                    f.package([], 'a'*64, self.files(), {}, {}, p, NOW)
            self.assertEqual((p/'manifest.json').read_bytes(),b'previous')


@unittest.skipUnless(NATIVE, 'Pinned native forecast environment required')
class DecoderTests(unittest.TestCase):
    def grid(self):
        projection = {'proj':'merc','a':6371200,'b':6371200,'lat_ts':20,'lon_0':-157}
        x,y = np.meshgrid(np.arange(3)*2500.,np.arange(3)*2500.)
        lon,lat = Proj(projection)(x,y,inverse=True)
        return lat,lon,projection

    def message(self, hours=1, **changes):
        lat,lon,projection = self.grid()
        message = SimpleNamespace(shortName='TMP',units='K',productDefinitionTemplateNumber=SimpleNamespace(value=0),
            typeOfFirstFixedSurface=SimpleNamespace(value=103),valueOfFirstFixedSurface=2,
            section3=np.array([1,2,3]), nx=3,ny=3,grid=lambda:(lat,lon),projParameters=projection,
            validDate=NOW+timedelta(hours=hours),refDate=NOW, data=np.full((3,3),273.15),flush_data=lambda:None)
        for key,value in changes.items():setattr(message,key,value)
        return message

    def decode(self,messages):
        class Stream(list):
            def __enter__(self):return self
            def __exit__(self,*args):pass
        fake = SimpleNamespace(__version__='2.8.2',open=lambda path:Stream(messages))
        lat,lon,_ = self.grid()
        key = f'{lat[1,1]:.7f},{lon[1,1]:.7f}'
        with patch.dict(sys.modules,{'grib2io':fake}): return f.decode_region('unused',[key])

    def test_projection_scan_reversal_and_outside_domain_fail_closed(self):
        lat,lon,projection = self.grid()
        self.assertIsNone(f.nearest_grid(lat,lon,projection,[(70,-90)])[0])
        lon[1,:] = lon[1,::-1]
        with self.assertRaises(f.ForecastError): f.nearest_grid(lat,lon,projection,[(0,-157)])

    def test_distance_gate_rejects_remote_grid_cell_even_inside_domain(self):
        projection = {'proj':'merc','a':6371200,'b':6371200,'lon_0':-157}
        x,y = np.meshgrid(np.arange(3)*100000.,np.arange(3)*100000.)
        lon,lat = Proj(projection)(x,y,inverse=True)
        qlon,qlat = Proj(projection)(50000.,50000.,inverse=True)
        self.assertIsNone(f.nearest_grid(lat,lon,projection,[(qlat,qlon)])[0])

    def test_missing_nearest_cell_is_not_replaced_and_values_sort_with_times(self):
        first,second = self.message(1),self.message(2)
        first.data[1,1] = np.nan
        second.data[1,1] = 263.15
        meta,records = self.decode([second,first])
        self.assertEqual(meta['reference_times'],[f.stamp(NOW)])
        self.assertEqual(next(iter(records.values()))['temperatures_c'],[None,-10])

    def test_masked_grib_bitmap_stays_unknown(self):
        first = self.message(1,data=np.ma.array(np.full((3,3),273.15),mask=np.eye(3,dtype=bool)))
        _,records=self.decode([first,self.message(2)])
        self.assertEqual(next(iter(records.values()))['temperatures_c'],[None,0])

    def test_wrong_field_surface_units_grid_lead_and_duplicates_rejected(self):
        variants = [dict(shortName='TMAX'),dict(units='C'),dict(valueOfFirstFixedSurface=0),
                    dict(productDefinitionTemplateNumber=SimpleNamespace(value=8)),
                    dict(typeOfFirstFixedSurface=SimpleNamespace(value=1)),
                    dict(section3=np.array([2,3,4])),dict(validDate=NOW-timedelta(hours=1)),
                    dict(validDate=NOW+timedelta(days=5)),dict(validDate=NOW+timedelta(hours=1))]
        for changes in variants:
            with self.subTest(changes=changes):
                with self.assertRaises(f.ForecastError):self.decode([self.message(1),self.message(2,**changes)])

    def test_more_than_100_messages_rejected(self):
        with self.assertRaises(f.ForecastError):self.decode([self.message(n) for n in range(101)])


if __name__ == '__main__': unittest.main()
