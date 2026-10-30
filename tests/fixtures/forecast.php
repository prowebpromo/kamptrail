<?php
/** Synthetic offline fixture; no credentials or network. Helpers loaded by the test. */
function ff_fixture(int $now, string $letter = 'a'): array {
    $id = str_repeat($letter, 24); $date = gmdate('Y-m-d\TH:i:s\Z', $now); $expiry = gmdate('Y-m-d\TH:i:s\Z', $now + 7200);
    $c = ['version'=>1,'sha256'=>str_repeat('1',64),'count'=>1];
    $m = ['version'=>1,'snapshot_id'=>$id,'catalogue_sha256'=>$c['sha256'],'generated_at'=>$date,'expires_at'=>$expiry,
        'source'=>['name'=>'NOAA/NWS NDFD','files'=>[]],'regions'=>[],'states'=>[],'coverage'=>['total'=>1,'grid_known'=>1,'unknown'=>0]];
    foreach (KF_REGIONS as $region) {
        $m['source']['files'][] = ['region'=>$region,'url'=>'https://noaa-ndfd-pds.s3.amazonaws.com/opnl/AR.'.$region.'/VP.001-003/ds.temp.bin','etag'=>'fixture','last_modified'=>$date,'bytes'=>100,'sha256'=>str_repeat('3',64)];
        $m['regions'][$region] = ['times'=>[$date,gmdate('Y-m-d\TH:i:s\Z',$now+3600),gmdate('Y-m-d\TH:i:s\Z',$now+7200)],'grid_sha256'=>str_repeat('2',64),'max_step_seconds'=>10800,'reference_times'=>[$date]];
    }
    $states = []; $compressed = [];
    foreach (KF_STATES as $state) {
        $records = $state === 'CA' ? ['site-one'=>['coordinate_key'=>'37.0000000,-120.0000000','region'=>'conus','status'=>'known','grid_lat'=>37.001,'grid_lng'=>-120.001,'grid_distance_m'=>100,'temperatures_c'=>[0,null,-5.125]]] : (object)[];
        $d = ['version'=>1,'snapshot_id'=>$id,'state'=>$state,'generated_at'=>$date,'expires_at'=>$expiry,'records'=>$records];
        $raw = json_encode($d, JSON_UNESCAPED_SLASHES); $gzip = gzencode($raw); $asset = 'forecast-v1-'.$id.'-'.$state.'.json.gz';
        $m['states'][$state] = ['asset'=>$asset,'sha256'=>hash('sha256',$gzip),'json_sha256'=>hash('sha256',$raw),'bytes'=>strlen($gzip),'json_bytes'=>strlen($raw),'count'=>$state === 'CA' ? 1 : 0];
        $states[$state]=$raw; $compressed[$asset]=$gzip;
    }
    return ['manifest'=>$m,'raw'=>json_encode($m, JSON_UNESCAPED_SLASHES),'catalogue'=>$c,'states'=>$states,'compressed'=>$compressed];
}
function ff_restate(array &$f, string $state, array $data): string {
    $raw=json_encode($data,JSON_UNESCAPED_SLASHES); $gzip=gzencode($raw); $asset=$f['manifest']['states'][$state]['asset'];
    $f['manifest']['states'][$state]=['asset'=>$asset,'sha256'=>hash('sha256',$gzip),'json_sha256'=>hash('sha256',$raw),'bytes'=>strlen($gzip),'json_bytes'=>strlen($raw),'count'=>count($data['records'])];
    $f['raw']=json_encode($f['manifest'],JSON_UNESCAPED_SLASHES); $f['states'][$state]=$raw; $f['compressed'][$asset]=$gzip; return $raw;
}
