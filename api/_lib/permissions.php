<?php
declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/permission-evidence.php';
const KP_VERSION = '005_permissions';
const KP_ACTIVITIES = ['overnight_occupancy', 'unoccupied_vehicle_parking'];
const KP_OBSERVATIONS = ['granted_to_me', 'refused_to_me', 'prohibition_sign_seen', 'stayed_without_asking'];
const KP_STATES = ['pending', 'published', 'rejected', 'deleted'];
final class KpError extends RuntimeException {
    public string $error;
    public function __construct(int $status, string $error, string $message) { parent::__construct($message, $status); $this->error=$error; }
}
function kp_fail(int $status, string $error, string $message): never { throw new KpError($status,$error,$message); }
function kp_keys(array $in, array $allowed): void {
    if (array_diff(array_keys($in), $allowed)) kp_fail(422,'invalid_fields','Unexpected fields were supplied.');
}
function kp_text($value, int $max, int $min=0): string {
    if (!is_string($value) || !preg_match('//u',$value) || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u',$value)) kp_fail(422,'invalid_text','Use valid plain text.');
    $value=trim($value);
    if (mb_strlen($value,'UTF-8')>$max || mb_strlen($value,'UTF-8')<$min) kp_fail(422,'invalid_text','A text field is missing or exceeds its character limit.');
    return $value;
}
function kp_int($value, int $min=1): int {
    if (!is_int($value) || $value<$min || $value>2147483647) kp_fail(422,'invalid_integer','Use a valid integer identifier or version.');
    return $value;
}
function kp_origin(): void {
    $origin=$_SERVER['HTTP_ORIGIN']??'';
    $scheme=(!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS']!=='off')?'https':'http';
    $expected=$scheme.'://'.strtolower((string)($_SERVER['HTTP_HOST']??''));
    $normalize=static function(string $url): ?string {
        $p=parse_url($url);
        if (!$p || !isset($p['scheme'],$p['host']) || !in_array($p['scheme'],['http','https'],true) || isset($p['user']) || isset($p['pass']) || isset($p['path']) || isset($p['query']) || isset($p['fragment'])) return null;
        return strtolower($p['scheme']).'://'.strtolower($p['host']).':'.($p['port']??($p['scheme']==='https'?443:80));
    };
    if (($origin!=='' && ($normalize($origin)===null || $normalize($origin)!==$normalize($expected))) || ($_SERVER['HTTP_SEC_FETCH_SITE']??'')==='cross-site') kp_fail(403,'origin','Use the form on KampTrail.');
}
function kp_ready(?PDO $pdo): bool { return $pdo && in_array(KP_VERSION,kt_applied_migrations($pdo),true); }
function kp_require_db(?PDO $pdo): PDO {
    if (!kp_ready($pdo)) kp_fail(503,'unavailable','Permission reports are temporarily unavailable. Official information may still be available.');
    return $pdo;
}
function kp_place($input): array {
    if (!is_array($input) || array_is_list($input)) kp_fail(422,'invalid_place','Choose a place first.');
    kp_keys($input,['kind','id','name','coordinates']);
    foreach (['kind'=>16,'id'=>200,'name'=>200] as $key=>$max) kp_text($input[$key]??null,$max,1);
    $coords=$input['coordinates']??null;
    if (!is_array($coords) || !array_is_list($coords) || count($coords)!==2 || !is_numeric($coords[0]) || !is_numeric($coords[1]) || is_string($coords[0]) || is_string($coords[1]) || !is_finite((float)$coords[0]) || !is_finite((float)$coords[1]) || abs($coords[0])>180 || abs($coords[1])>90) kp_fail(422,'invalid_place','Choose valid map coordinates.');
    $place=kp_resolve_place($input);
    if (!$place) kp_fail(422,'invalid_place','This place could not be verified. Reopen it from the map.');
    return $place;
}
function kp_validate(array $in): array {
    $out=['place'=>kp_place($in['place']??null)];
    foreach (['activity'=>KP_ACTIVITIES,'observation'=>KP_OBSERVATIONS] as $key=>$allowed) {
        if (!is_string($in[$key]??null) || !in_array($in[$key],$allowed,true)) kp_fail(422,'invalid_'.$key,'Choose a supported activity and observation.');
        $out[$key]=$in[$key];
    }
    foreach (['display_name'=>[60,2],'body'=>[3000,20],'authority_role'=>[120,0],'authority_office'=>[120,0]] as $key=>$limits) $out[$key]=kp_text($in[$key]??'',$limits[0],$limits[1]);
    if (in_array($out['observation'],['granted_to_me','refused_to_me'],true) && (mb_strlen($out['authority_role'])<2 || mb_strlen($out['authority_office'])<2)) kp_fail(422,'authority_required','For a grant or refusal, give the person’s role and the office or property they represented. Do not include private contact details.');
    $out['visited_on']=kp_text($in['visited_on']??' ',10,10);
    $date=DateTimeImmutable::createFromFormat('!Y-m-d',$out['visited_on']);
    if (!$date || $date->format('Y-m-d')!==$out['visited_on'] || $out['visited_on']>gmdate('Y-m-d') || $out['visited_on']<'1900-01-01') kp_fail(422,'invalid_date','Enter the date of your own observation, today or earlier.');
    if (($in['firsthand']??null)!==true) kp_fail(422,'firsthand_required','Confirm this is your own firsthand observation.');
    return $out;
}
function kp_abuse(array $in): void {
    if (kp_text($in['website']??'',200)!=='') kp_fail(422,'invalid_submission','Unable to accept this submission.');
    if (kp_int($in['elapsed_ms']??null,0)<3000) kp_fail(422,'too_fast','Take a moment to review your submission, then send it again.');
}
function kp_owner(): string {
    $header=(string)($_SERVER['HTTP_AUTHORIZATION']??'');
    if (!preg_match('/^Bearer ([a-f0-9]{64})$/D',$header,$m)) kp_fail(401,'authorization_required','Enter your report management code.');
    return hash('sha256',$m[1],true);
}
function kp_owned(PDO $pdo,string $hash,?int $id=null): array {
    $q=$pdo->prepare('SELECT * FROM permission_reports WHERE owner_hash=?'.($id!==null?' AND id=?':''));
    $q->bindValue(1,$hash,PDO::PARAM_LOB);if ($id!==null) $q->bindValue(2,$id,PDO::PARAM_INT);$q->execute();
    $row=$q->fetch();if (!$row || $row['status']==='deleted') kp_fail(404,'not_found','Report management code not found.');
    return $row;
}
function kp_lock(PDO $pdo): void { $pdo->beginTransaction();$pdo->exec('UPDATE permission_state SET revision=revision+1 WHERE id=1'); }
function kp_rate(PDO $pdo,string $kind,int $limit): void {
    $q=$pdo->prepare('SELECT COUNT(*) FROM permission_events WHERE client_hash=? AND kind=? AND created_at>=?');
    $q->execute([kt_client_hash(),$kind,gmdate('Y-m-d H:i:s',time()-3600)]);
    if ((int)$q->fetchColumn()>=$limit) kp_fail(429,'rate_limit','Too many permission-report requests. Try again in an hour.');
    $pdo->prepare('INSERT INTO permission_events (client_hash,kind,created_at) VALUES (?,?,?)')->execute([kt_client_hash(),$kind,kt_now()]);
    $pdo->prepare('DELETE FROM permission_events WHERE created_at<?')->execute([gmdate('Y-m-d H:i:s',time()-86400)]);
}
function kp_audit(PDO $pdo,int $id,string $action,string $from,string $to,int $version,string $actor): void {
    $pdo->prepare('INSERT INTO permission_audit (report_id,action,from_status,to_status,report_version,actor,created_at) VALUES (?,?,?,?,?,?,?)')->execute([$id,$action,$from,$to,$version,$actor,kt_now()]);
}
function kp_public(array $row,bool $owner=false): array {
    $keys=['id','activity','observation','visited_on','display_name','body','authority_role','authority_office','created_at','updated_at'];
    if ($owner) $keys=array_merge($keys,['status','version','public_note']);
    $out=array_intersect_key($row,array_flip($keys));$out['id']=(int)$out['id'];
    if ($owner) {$out['version']=(int)$out['version'];$out['firsthand']=true;$out['place']=['kind'=>$row['place_kind'],'id'=>$row['place_id'],'name'=>$row['place_name'],'coordinates'=>[(float)$row['lng'],(float)$row['lat']]];}
    return $out;
}
function kp_version(array $row,int $version): void { if ((int)$row['version']!==$version) kp_fail(409,'conflict','This report changed. Reload it before making another change.'); }
/** Must run inside a write transaction. Erase author data, location and flag text; keep a minimal audit tombstone. */
function kp_erase(PDO $pdo,array $row): void {
    $q=$pdo->prepare("UPDATE permission_reports SET owner_hash=NULL,place_key='',place_kind='',place_id='',place_name='',lng=NULL,lat=NULL,activity='',observation='',visited_on='',firsthand=0,display_name='',body='',authority_role='',authority_office='',public_note='',status='deleted',version=version+1,updated_at=? WHERE id=? AND version=? AND status<>'deleted'");
    $q->execute([kt_now(),$row['id'],$row['version']]);
    if ($q->rowCount()!==1) kp_fail(409,'conflict','This report changed. Reload it before making another change.');
    $pdo->prepare("UPDATE permission_flags SET reason='',status='resolved',version=version+1 WHERE report_id=?")->execute([$row['id']]);
}
