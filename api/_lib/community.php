<?php
declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';
const KT_COMMUNITY_VERSION = '002_community';
const KT_PHOTO_LIMIT = 3;
const KT_PHOTO_INPUT_LIMIT = 6291456;
const KT_PHOTO_PIXEL_LIMIT = 16000000;
const KT_PHOTO_STORAGE_LIMIT = 268435456;
const KT_COMMUNITY_STATES = ['pending', 'published', 'rejected', 'hidden'];

// Encoded images live in the database, not in an executable uploads directory.
function kc_db(): PDO {
    $pdo = kt_db();
    if (!$pdo || !in_array(KT_COMMUNITY_VERSION, kt_applied_migrations($pdo), true)) kt_unavailable();
    return $pdo;
}
function kc_error(int $code, string $message): never { kt_json($code, ['ok'=>false, 'message'=>$message]); }
function kc_string($value, int $limit): string { return is_scalar($value) ? kt_text($value, $limit) : ''; }
// Every published id of one listing (canonical first, then legacy ids), from identity-hosts.json.
// Reviews are stored under the id the camper's browser sent; reading them by every published id keeps
// a review keyed to a legacy id attached to the same listing. Stored ids are never rewritten.
function kc_site_ids(string $site, ?string $file = null): array {
    static $maps = [];
    $file = $file ?? dirname(__DIR__, 2) . '/data/campsites/identity-hosts.json';
    if (!array_key_exists($file, $maps)) {
        $maps[$file] = null;
        $raw = is_file($file) && filesize($file) <= 4000000 ? @file_get_contents($file) : false;
        $data = is_string($raw) ? json_decode($raw, true) : null;
        if (is_array($data) && ($data['version'] ?? null) === 1 && is_array($data['hosts'] ?? null)) {
            $hosts = [];
            foreach ($data['hosts'] as $id => $aliases) if (is_string($id) && is_array($aliases)) foreach ($aliases as $alias) if (is_string($alias)) $hosts[$alias] = $id;
            $maps[$file] = ['hosts' => $hosts, 'aliases' => $data['hosts']];
        }
    }
    $map = $maps[$file];
    if (!$map) return [$site];
    $host = $map['hosts'][$site] ?? $site;
    $ids = [$host];
    foreach ($map['aliases'][$host] ?? [] as $alias) if (is_string($alias)) $ids[] = $alias;
    if (!in_array($site, $ids, true)) $ids[] = $site;
    return array_values(array_unique($ids));
}
function kc_in(array $ids): string { return implode(',', array_fill(0, count($ids), '?')); }
function kc_owner(): string {
    $header = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? '');
    return preg_match('/^Bearer ([a-f0-9]{64})$/D', $header, $m) ? hash('sha256', $m[1]) : '';
}
function kc_origin(): void {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $host = $_SERVER['HTTP_HOST'] ?? '';
    if ($origin !== '' && parse_url($origin, PHP_URL_HOST) !== explode(':', $host)[0]) kc_error(403, 'Use the form on KampTrail.');
}
function kc_lock(PDO $pdo): void {
    $pdo->beginTransaction();
    // One row serializes quota checks, mutations and rate-limit accounting on MySQL and SQLite.
    $pdo->exec('UPDATE community_storage SET used_bytes = used_bytes WHERE id = 1');
}
function kc_rate(PDO $pdo, string $kind, int $limit): void {
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM community_events WHERE client_hash = ? AND kind = ? AND created_at >= ?');
    $stmt->execute([kt_client_hash(), $kind, gmdate('Y-m-d H:i:s', time()-3600)]);
    if ((int)$stmt->fetchColumn() >= $limit) { $pdo->rollBack(); kc_error(429, 'Too many requests from this connection. Please try again in an hour.'); }
    $pdo->prepare('INSERT INTO community_events (client_hash, kind, created_at) VALUES (?, ?, ?)')->execute([kt_client_hash(), $kind, kt_now()]);
    $pdo->prepare('DELETE FROM community_events WHERE created_at < ?')->execute([gmdate('Y-m-d H:i:s', time()-86400)]);
}
function kc_audit(PDO $pdo, int $id, string $action, string $from, string $to, string $actor): void {
    $pdo->prepare('INSERT INTO community_audit (review_id, action, from_status, to_status, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)')->execute([$id,$action,$from,$to,$actor,kt_now()]);
}
function kc_validate(array $in): array {
    $out = [];
    foreach (['campsite_id'=>200,'campsite_name'=>200,'display_name'=>60,'body'=>3000,'rig'=>100] as $key=>$max) $out[$key] = kc_string($in[$key] ?? '', $max);
    if ($out['campsite_id']==='' || $out['campsite_name']==='') kc_error(422, 'Choose a campsite first.');
    if (mb_strlen($out['display_name'])<2 || mb_strlen($out['body'])<20) kc_error(422, 'Enter a public name and a review of at least 20 characters.');
    $rating = filter_var($in['rating'] ?? '', FILTER_VALIDATE_INT);
    if ($rating===false || $rating<1 || $rating>5) kc_error(422, 'Choose a rating from 1 to 5.');
    $out['rating']=$rating;
    $out['visited_on']=kc_string($in['visited_on']??'',10);
    $date=DateTimeImmutable::createFromFormat('!Y-m-d',$out['visited_on']);
    if (!$date || $date->format('Y-m-d')!==$out['visited_on'] || $out['visited_on']>gmdate('Y-m-d') || $out['visited_on']<'1900-01-01') kc_error(422, 'Enter the date you visited, today or earlier.');
    if (($in['firsthand']??'')!=='1') kc_error(422, 'Confirm this is your own review and you have permission to share the photos and any attached video.');
    if ((int)($in['elapsed_ms']??0)<3000) kc_error(422, 'Please take a moment to review your submission, then send it again.');
    return $out;
}
/** Validate before decoding, then produce fresh JPEG pixels without original metadata or appended content. */
function kc_photos(): array {
    if (empty($_FILES['photos'])) return [];
    $files=$_FILES['photos'];
    if (!is_array($files['error']??null)) kc_error(422,'Choose photo files.');
    $active=array_filter($files['error'], fn($e)=>$e!==UPLOAD_ERR_NO_FILE);
    if (count($active)>KT_PHOTO_LIMIT) kc_error(422,'Attach at most three photos.');
    if (!$active) return [];
    if (!extension_loaded('gd') || !class_exists('finfo')) kc_error(503,'Photo processing is temporarily unavailable. You can send your review without photos.');
    $out=[];
    foreach ($active as $i=>$error) {
        if ($error!==UPLOAD_ERR_OK) kc_error(413,'A photo could not be uploaded. Each photo must be 6 MB or smaller.');
        $tmp=$files['tmp_name'][$i]??'';
        if (!is_string($tmp) || !is_uploaded_file($tmp) || filesize($tmp)>KT_PHOTO_INPUT_LIMIT) kc_error(413,'Each photo must be 6 MB or smaller.');
        $info=@getimagesize($tmp);
        $mime=(new finfo(FILEINFO_MIME_TYPE))->file($tmp);
        if (!$info || !in_array($mime,['image/jpeg','image/png','image/webp'],true) || $info['mime']!==$mime) kc_error(422,'Use a valid JPEG, PNG or WebP photo. SVG, GIF and HEIC are not supported.');
        [$w,$h]=$info;
        if ($w<1 || $h<1 || $w*$h>KT_PHOTO_PIXEL_LIMIT || max($w,$h)>10000) kc_error(422,'Photos must be 16 megapixels or smaller.');
        $memory=ini_get('memory_limit');
        if (is_string($memory) && $memory!=='-1') {
            $units=['g'=>1073741824,'m'=>1048576,'k'=>1024];$last=strtolower(substr($memory,-1));
            $budget=(int)$memory*($units[$last]??1);
            if ($w*$h*10+memory_get_usage(true)+16777216>$budget) kc_error(422,'This photo needs too much memory. Resize it before uploading.');
        }
        $src=@imagecreatefromstring(file_get_contents($tmp));
        if (!$src) kc_error(422,'This photo could not be decoded. Choose another image.');
        // Honor camera orientation when EXIF support is installed, before stripping metadata.
        if ($mime==='image/jpeg' && function_exists('exif_read_data')) {
            $exif=@exif_read_data($tmp); $o=(int)($exif['Orientation']??1);
            if (in_array($o,[2,4,5,7],true)) imageflip($src,IMG_FLIP_HORIZONTAL);
            $angle=[3=>180,4=>180,5=>90,6=>-90,7=>-90,8=>90][$o]??0;
            if ($angle) { $rotated=imagerotate($src,$angle,0); if ($rotated) {imagedestroy($src);$src=$rotated;} }
        }
        $w=imagesx($src);$h=imagesy($src);$scale=min(1,1600/max($w,$h));$nw=max(1,(int)round($w*$scale));$nh=max(1,(int)round($h*$scale));
        $dst=imagecreatetruecolor($nw,$nh);imagefill($dst,0,0,imagecolorallocate($dst,255,255,255));imagecopyresampled($dst,$src,0,0,0,0,$nw,$nh,$w,$h);
        ob_start();imagejpeg($dst,null,82);$jpeg=ob_get_clean();imagedestroy($src);imagedestroy($dst);
        if (!is_string($jpeg) || strlen($jpeg)>2097152) kc_error(422,'This image could not be reduced enough. Choose a smaller photo.');
        $out[]=['data'=>$jpeg,'bytes'=>strlen($jpeg),'width'=>$nw,'height'=>$nh];
    }
    return $out;
}
function kc_row(PDO $pdo,int $id): ?array {
    $q=$pdo->prepare('SELECT * FROM community_reviews WHERE id = ?');$q->execute([$id]);return $q->fetch()?:null;
}
function kc_delete_photo(PDO $pdo,int $id,int $review): void {
    $q=$pdo->prepare('SELECT byte_size FROM community_photos WHERE id=? AND review_id=?');$q->execute([$id,$review]);$bytes=$q->fetchColumn();
    if ($bytes===false) return;
    $pdo->prepare("UPDATE community_photos SET image_data=NULL, byte_size=0, status='deleted' WHERE id=? AND review_id=?")->execute([$id,$review]);
    $pdo->prepare('UPDATE community_storage SET used_bytes=used_bytes-? WHERE id=1')->execute([(int)$bytes]);
}
function kc_save_photos(PDO $pdo,int $id,array $photos): void {
    $size=array_sum(array_column($photos,'bytes'));$used=(int)$pdo->query('SELECT used_bytes FROM community_storage WHERE id=1')->fetchColumn();
    $cap=min(KT_PHOTO_STORAGE_LIMIT,max(0,(int)(kt_config()['community_storage_bytes']??KT_PHOTO_STORAGE_LIMIT)));
    if ($used+$size>$cap) { $pdo->rollBack();kc_error(507,'Photo storage is full. Remove the attachments and send your review, or try again later.'); }
    foreach ($photos as $p) {
        $q=$pdo->prepare("INSERT INTO community_photos (review_id, image_data, byte_size, width, height, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)");
        $q->bindValue(1,$id,PDO::PARAM_INT);$q->bindValue(2,$p['data'],PDO::PARAM_LOB);$q->bindValue(3,$p['bytes'],PDO::PARAM_INT);$q->bindValue(4,$p['width'],PDO::PARAM_INT);$q->bindValue(5,$p['height'],PDO::PARAM_INT);$q->bindValue(6,kt_now());$q->execute();
    }
    $pdo->prepare('UPDATE community_storage SET used_bytes=used_bytes+? WHERE id=1')->execute([$size]);
}
function kc_photo_rows(PDO $pdo,int $id,bool $public=true): array {
    $q=$pdo->prepare("SELECT id,width,height,status FROM community_photos WHERE review_id=? AND status ".($public?"= 'published'":"<> 'deleted'").' ORDER BY id');$q->execute([$id]);
    return array_map(function($p){$p['id']=(int)$p['id'];$p['width']=(int)$p['width'];$p['height']=(int)$p['height'];return $p;},$q->fetchAll());
}

require_once __DIR__ . '/observations.php';
