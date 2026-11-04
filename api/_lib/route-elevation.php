<?php
/** Bounded, unauthenticated USGS 3DEP terrain sampling. No route or rig records. */
declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';
const KRE_SERVICE = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer';
const KRE_SAMPLES = KRE_SERVICE . '/getSamples';
const KRE_BODY_MAX = 8192;
const KRE_RESPONSE_MAX = 524288;
const KRE_CACHE_SLOTS = 512;
const KRE_CLIENT_SLOTS = 128;
const KRE_TTL = 86400;
final class KreException extends RuntimeException {
    public string $reason; public int $status;
    public function __construct(string $reason, int $status = 502) { parent::__construct($reason); $this->reason=$reason; $this->status=$status; }
}
function kre_assert(bool $ok, string $reason='upstream_unavailable', int $status=502): void { if (!$ok) throw new KreException($reason,$status); }
function kre_number($n): bool { return (is_int($n)||is_float($n)) && is_finite((float)$n); }
function kre_key(float $lat, float $lon): string { return sprintf('%.7F,%.7F', $lat == 0 ? 0 : $lat, $lon == 0 ? 0 : $lon); }
/** Reject duplicate object names, including JSON escaped aliases. Input is syntactically checked first. */
function kre_json(string $raw, int $limit=KRE_RESPONSE_MAX): array {
    kre_assert(strlen($raw)<=$limit);
    try { $value=json_decode($raw,true,24,JSON_THROW_ON_ERROR); } catch (Throwable $e) { throw new KreException('upstream_unavailable'); }
    kre_assert(is_array($value)); $stack=[]; $offset=0; $length=strlen($raw);
    while ($offset<$length) {
        $offset+=strcspn($raw,'"{}[]',$offset); if ($offset >= $length) break; $token=$raw[$offset++];
        if ($token==='{'||$token==='[') { $stack[]=[]; continue; }
        if ($token==='}'||$token===']') { array_pop($stack); continue; }
        $start=$offset-1;
        do { $end=strpos($raw,'"',$offset); kre_assert($end!==false); $slashes=0; for($j=$end-1;$j>$start&&$raw[$j]==='\\';$j--) $slashes++; $offset=$end+1; } while($slashes%2===1);
        $next=$offset; while($next<$length&&str_contains(" \r\n\t",$raw[$next])) $next++;
        if($next >= $length||$raw[$next]!==':') continue;
        $index=count($stack)-1; kre_assert($index>=0); $key=':'.json_decode(substr($raw,$start,$offset-$start),true,2,JSON_THROW_ON_ERROR);
        kre_assert(!isset($stack[$index][$key])); $stack[$index][$key]=true;
    }
    return $value;
}
/** Browser POSTs must match the full origin (scheme, hostname and port). Proxy headers are not trusted. */
function kre_request(array $server, array $query, string $raw): array {
    kre_assert(($server['REQUEST_METHOD']??'GET')==='POST','method_not_allowed',405);
    $host=$server['HTTP_HOST']??''; $scheme=(!empty($server['HTTPS'])&&$server['HTTPS']!=='off')?'https':'http';
    kre_assert(is_string($host)&&preg_match('/^[a-zA-Z0-9.-]+(?::[0-9]{1,5})?$/D',$host)===1 && ($server['HTTP_ORIGIN']??'')===$scheme.'://'.$host,'invalid_origin',403);
    kre_assert(!isset($server['HTTP_SEC_FETCH_SITE'])||$server['HTTP_SEC_FETCH_SITE']==='same-origin','invalid_origin',403);
    kre_assert(preg_match('/^application\/json(?:\s*;\s*charset=utf-8)?$/Di',$server['CONTENT_TYPE']??'')===1,'invalid_content_type',415);
    kre_assert(!isset($server['HTTP_CONTENT_ENCODING'])||$server['HTTP_CONTENT_ENCODING']==='identity','invalid_content_type',415);
    kre_assert(!$query,'invalid_query',400);
    kre_assert(strlen($raw)<=KRE_BODY_MAX && (!isset($server['CONTENT_LENGTH']) || (ctype_digit((string)$server['CONTENT_LENGTH'])&&(int)$server['CONTENT_LENGTH']<=KRE_BODY_MAX)),'too_large',413);
    try { $body=kre_json($raw,KRE_BODY_MAX); } catch(KreException $e) { throw new KreException('invalid_json',400); }
    $shape=json_decode($raw);
    kre_assert($shape instanceof stdClass && is_array($shape->samples??null),'invalid_query',400);
    kre_assert(array_keys($body)===['samples']&&is_array($body['samples'])&&array_is_list($body['samples'])&&count($body['samples'])>=1&&count($body['samples'])<=50,'invalid_query',400);
    $out=[]; $ids=[];
    foreach($body['samples'] as $p) {
        kre_assert(is_array($p),'invalid_query',400); $keys=array_keys($p);sort($keys);
        kre_assert($keys===['id','lat','lon']&&is_int($p['id'])&&$p['id']>=0&&$p['id']<200&&!isset($ids[$p['id']])&&kre_number($p['lat'])&&kre_number($p['lon'])&&abs($p['lat'])<=90&&abs($p['lon'])<=180,'invalid_query',400);
        $ids[$p['id']]=true; $out[]=['id'=>$p['id'],'lat'=>(float)$p['lat'],'lon'=>(float)$p['lon']];
    }
    return $out;
}
/** Fixed HTTPS URLs, no redirects, no retry loops, and caps before JSON parsing. */
function kre_http(string $url, array $parameters): array {
    kre_assert(in_array($url,[KRE_SERVICE,KRE_SAMPLES],true)&&function_exists('curl_init'));
    $body=''; $ch=curl_init($url);
    curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>http_build_query($parameters,'','&',PHP_QUERY_RFC3986),
        CURLOPT_FOLLOWLOCATION=>false,CURLOPT_CONNECTTIMEOUT=>4,CURLOPT_TIMEOUT=>12,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,
        CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2,CURLOPT_USERAGENT=>'KampTrail/2.17 (https://kamptrail.com; terrain context)',
        CURLOPT_HTTPHEADER=>['Accept: application/json','Content-Type: application/x-www-form-urlencoded'],
        CURLOPT_WRITEFUNCTION=>static function($handle,string $chunk)use(&$body):int { if(strlen($body)+strlen($chunk)>KRE_RESPONSE_MAX)return 0;$body.=$chunk;return strlen($chunk); }]);
    $ok=curl_exec($ch);$status=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE);curl_close($ch);
    kre_assert($ok!==false&&$status===200); return kre_json($body);
}
function kre_text($v, int $limit=200): ?string {
    if(!is_string($v)||$v===''||strlen($v)>$limit||preg_match('/[\x00-\x1f\x7f]/',$v))return null;return $v;
}
function kre_date($v, bool $epochMillis=false): ?string {
    if(kre_number($v))return $epochMillis&&$v>=0&&$v<=4102444800000?gmdate('c',(int)floor($v/1000)):null;
    if(!is_string($v)||!preg_match('/^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+-]+Z?)?$/D',$v)||strlen($v)>40)return null;
    if(!checkdate((int)substr($v,5,2),(int)substr($v,8,2),(int)substr($v,0,4)))return null;
    try{$date=new DateTimeImmutable($v,new DateTimeZone('UTC'));$errors=DateTimeImmutable::getLastErrors();}
    catch(Throwable $e){return null;}
    if($errors!==false&&($errors['warning_count']||$errors['error_count']))return null;
    return $date->setTimezone(new DateTimeZone('UTC'))->format('c');
}
function kre_source(array $raw, int $now): array {
    kre_assert(!array_key_exists('error',$raw)&&($raw['name']??null)==='3DEPElevation'&&($raw['serviceDataType']??null)==='esriImageServiceDataTypeElevation'&&($raw['bandCount']??null)===1);
    return ['name'=>'USGS 3DEP','url'=>KRE_SERVICE,'sample_url'=>KRE_SAMPLES,'units'=>'meters','interpolation'=>'RSP_BilinearInterpolation','horizontal_crs'=>'EPSG:4326','datum'=>null,'metadata_retrieved_at'=>gmdate('c',$now),'source_updated_at'=>kre_date($raw['editingInfo']['lastEditDate']??null,true)];
}
function kre_parameters(array $points): array {
    return ['f'=>'json','geometry'=>json_encode(['points'=>array_map(static fn($p)=>[$p['lon'],$p['lat']],$points),'spatialReference'=>['wkid'=>4326]]),'geometryType'=>'esriGeometryMultipoint','interpolation'=>'RSP_BilinearInterpolation','returnFirstValueOnly'=>'true','outFields'=>'*'];
}
/** locationId addresses the sent multipoint index, never the client ID or response array position. */
function kre_normalize(array $data, array $points, int $now): array {
    kre_assert(!array_key_exists('error',$data)&&is_array($data['samples']??null)&&array_is_list($data['samples'])&&count($data['samples'])<=2*count($points));
    $group=[];
    foreach($data['samples'] as $r) {
        kre_assert(is_array($r)&&is_int($r['locationId']??null)&&$r['locationId']>=0&&$r['locationId']<count($points));
        $loc=$r['location']??null;$p=$points[$r['locationId']];
        kre_assert(is_array($loc)&&is_array($loc['spatialReference']??null)&&($loc['spatialReference']['latestWkid']??$loc['spatialReference']['wkid']??null)===4326&&kre_number($loc['x']??null)&&kre_number($loc['y']??null)&&kre_key((float)$loc['y'],(float)$loc['x'])===kre_key($p['lat'],$p['lon']));
        $group[$r['locationId']][]=$r;
    }
    $out=[];
    foreach($points as $i=>$p) {
        $matches=$group[$i]??[]; $value=['status'=>'unavailable','elevation_m'=>null,'reason'=>count($matches)>1?'duplicate_location_id':'missing_sample','datum'=>null,'source_updated_at'=>null,'acquisition_metadata'=>null,'retrieved_at'=>gmdate('c',$now)];
        if(count($matches)===1) {
            $r=$matches[0];$v=$r['value']??null;$a=is_array($r['attributes']??null)?$r['attributes']:[];
            $value['datum']=kre_text($a['VerticalDatum']??null);$dates=[];
            // Provider fields mix epoch milliseconds, years and other formats.
            // Keep bounded raw values without inventing dates from their names.
            foreach(['AcquisitionDate','StartDate','EndDate','pubdate','Cdate'] as $name){$date=$a[$name]??null;if((kre_number($date)&&abs($date)<=1e16)||kre_text($date)!==null)$dates[$name]=$date;}
            $value['acquisition_metadata']=$dates?:null;$value['source_updated_at']=kre_date($a['pubdate']??null);
            $value['raster_id']=is_int($r['rasterId']??null)?$r['rasterId']:null;
            $value['resolution']=kre_number($r['resolution']??null)&&$r['resolution']>0?$r['resolution']:null;
            if(array_key_exists('value',$r)&&($v===null||(is_string($v)&&in_array(strtolower(trim($v)),['','nodata','no data','nan'],true)))) {
                $value['status']='no_data';$value['reason']='no_coverage';
            } else {
                if(is_string($v)&&strlen($v)<=40&&preg_match('/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/D',$v))$v=(float)$v;
                if(kre_number($v)&&$v>=-500&&$v<=9000){$value['status']='value';$value['elevation_m']=(float)$v;$value['reason']=null;}
                else $value['reason']='invalid_sample';
            }
        }
        $out[]=$value;
    }
    return $out;
}
/** Path is derived from config location; the config itself is never read. */
function kre_directory(): string { return dirname(kt_config_path()).'/route-elevation-cache'; }
function kre_prepare_directory(string $dir): void {
    $public=realpath(dirname(__DIR__,2));
    kre_assert(!is_link($dir)&&(!is_dir($dir)?@mkdir($dir,0700,true):true),'cache_unavailable',503);
    $real=realpath($dir); kre_assert($real!==false&&$public!==false&&$real!==$public&&!str_starts_with($real,$public.DIRECTORY_SEPARATOR),'cache_unavailable',503);
    @chmod($dir,0700);
    $permissions=@fileperms($dir);kre_assert($permissions!==false&&($permissions&0077)===0,'cache_unavailable',503);
}
function kre_db(string $dir): PDO {
    kre_prepare_directory($dir);
    kre_assert(!is_link($dir.'/cache.sqlite')&&!is_link($dir.'/cache.sqlite-journal'),'cache_unavailable',503);
    $db=new PDO('sqlite:'.$dir.'/cache.sqlite',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_TIMEOUT=>0]);
    @chmod($dir.'/cache.sqlite',0600);$db->exec('PRAGMA page_size=4096');$db->exec('PRAGMA busy_timeout=0');$db->exec('PRAGMA journal_mode=DELETE');$db->exec('PRAGMA max_page_count=1024');
    $db->exec('CREATE TABLE IF NOT EXISTS samples (slot INTEGER PRIMARY KEY, cache_key TEXT NOT NULL, at INTEGER NOT NULL, payload TEXT NOT NULL)');
    $db->exec('CREATE TABLE IF NOT EXISTS budgets (slot INTEGER PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL)');
    $db->exec('CREATE TABLE IF NOT EXISTS metadata (slot INTEGER PRIMARY KEY CHECK(slot=0), at INTEGER NOT NULL, payload TEXT NOT NULL)');
    return $db;
}
function kre_budget(PDO $db,int $slot,int $now,int $limit): void {
    $window=intdiv($now,60);$q=$db->prepare('SELECT window,count FROM budgets WHERE slot=?');$q->execute([$slot]);$r=$q->fetch(PDO::FETCH_ASSOC);
    $count=$r&&(int)$r['window']===$window?(int)$r['count']:0;kre_assert($count<$limit,'rate_limited',429);
    $q=$db->prepare('INSERT OR REPLACE INTO budgets(slot,window,count) VALUES(?,?,?)');$q->execute([$slot,$window,$count+1]);
}
/** Fixed slots cache independent coordinate hashes, never client IDs, route names, geometry or rig data. */
function kre_cached(array $points,string $directory,string $client,callable $http,int $now): array {
    kre_prepare_directory($directory);
    kre_assert(!is_link($directory.'/cache.lock'),'cache_unavailable',503);$lock=@fopen($directory.'/cache.lock','c+');kre_assert($lock!==false,'cache_unavailable',503);@chmod($directory.'/cache.lock',0600);
    if(!flock($lock,LOCK_EX|LOCK_NB)){fclose($lock);throw new KreException('busy',503);}
    try {
        $db=kre_db($directory);
        // Collision sharing is deliberately conservative: no stored client identifier or unbounded IP table.
        kre_budget($db,1+hexdec(substr(hash('sha256',$client),0,6))%KRE_CLIENT_SLOTS,$now,12);
        $values=[];$pending=[];$indexes=[];$read=$db->prepare('SELECT cache_key,at,payload FROM samples WHERE slot=?');
        foreach($points as $i=>$p){
            $key=hash('sha256','3dep-v1|'.kre_key($p['lat'],$p['lon']));$read->execute([hexdec(substr($key,0,6))%KRE_CACHE_SLOTS]);$row=$read->fetch(PDO::FETCH_ASSOC);
            $cached=$row&&$row['cache_key']===$key&&strlen($row['payload'])<=4096?json_decode($row['payload'],true):null;
            $ttl=is_array($cached)&&($cached['status']??'')==='unavailable'?30:KRE_TTL;
            if(is_array($cached)&&in_array($cached['status']??'',['value','no_data','unavailable'],true)&&(int)$row['at']<=$now&&$now-(int)$row['at']<$ttl){$values[$i]=$cached;continue;}
            $pending[]=$p;$indexes[]=$i;
        }
        $row=$db->query('SELECT at,payload FROM metadata WHERE slot=0')->fetch(PDO::FETCH_ASSOC);
        $source=$row&&(int)$row['at']<=$now&&$now-(int)$row['at']<KRE_TTL&&strlen($row['payload'])<=4096?json_decode($row['payload'],true):null;
        if($pending||!is_array($source)) {
            // Persist reservation BEFORE transport; failures and crashes consume the same bounded budget.
            kre_budget($db,0,$now,24);
            if(!is_array($source)){$source=kre_source($http(KRE_SERVICE,['f'=>'json']),$now);$q=$db->prepare('INSERT OR REPLACE INTO metadata(slot,at,payload) VALUES(0,?,?)');$q->execute([$now,json_encode($source)]);}
            if($pending){
                try{$fresh=kre_normalize($http(KRE_SAMPLES,kre_parameters($pending)),$pending,$now);}
                catch(KreException $e){$fresh=array_fill(0,count($pending),['status'=>'unavailable','elevation_m'=>null,'reason'=>'upstream_unavailable','datum'=>null,'source_updated_at'=>null,'acquisition_metadata'=>null,'retrieved_at'=>gmdate('c',$now)]);}
                $write=$db->prepare('INSERT OR REPLACE INTO samples(slot,cache_key,at,payload) VALUES(?,?,?,?)');
                foreach($fresh as $j=>$value){$i=$indexes[$j];$values[$i]=$value;$key=hash('sha256','3dep-v1|'.kre_key($points[$i]['lat'],$points[$i]['lon']));$encoded=json_encode($value);kre_assert(is_string($encoded)&&strlen($encoded)<=4096);$write->execute([hexdec(substr($key,0,6))%KRE_CACHE_SLOTS,$key,$now,$encoded]);}
            }
        }
        $out=[];foreach($points as $i=>$p)$out[]=$p+$values[$i];
        return ['ok'=>true,'version'=>1,'samples'=>$out,'source'=>$source,'retrieved_at'=>gmdate('c',$now)];
    } finally {flock($lock,LOCK_UN);fclose($lock);}
}
/** Shared dispatcher permits fixture transport injection in tests without a production URL override. */
function kre_dispatch(array $server,array $query,string $raw,string $directory,callable $http,int $now): array {
    try{$points=kre_request($server,$query,$raw);$result=kre_cached($points,$directory,(string)($server['REMOTE_ADDR']??''),$http,$now);return [200,$result];}
    catch(KreException $e){return [$e->status,['ok'=>false,'version'=>1,'error'=>$e->reason,'message'=>'Route terrain is unavailable. Try again shortly.']];}
    catch(Throwable $e){return [503,['ok'=>false,'version'=>1,'error'=>'unavailable','message'=>'Route terrain is temporarily unavailable.']];}
}
