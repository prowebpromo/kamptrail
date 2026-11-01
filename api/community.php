<?php
declare(strict_types=1);
require __DIR__ . '/_lib/community.php';
$method=$_SERVER['REQUEST_METHOD']??'GET';
if (!in_array($method,['GET','POST'],true)) {header('Allow: GET, POST');kc_error(405,'Method not allowed.');}
$pdo=kc_db();
try {
    if ($method==='GET') {
        $owner=kc_owner();
        if ($owner!=='') {
            $q=$pdo->prepare('SELECT id,campsite_id,campsite_name,display_name,rating,body,visited_on,rig,status,public_note,updated_at FROM community_reviews WHERE owner_hash=?');$q->execute([$owner]);$row=$q->fetch();
            if (!$row) kc_error(404,'Management code not found.');
            $details=ko_read($pdo,(int)$row['id']);$row['video']=ko_video($details);$row['observations']=ko_conditions($details);
            $row['photos']=kc_photo_rows($pdo,(int)$row['id'],false);
            kt_json(200,['ok'=>true,'review'=>$row]);
        }
        $site=kc_string($_GET['site']??'',200);
        if ($site==='') kc_error(422,'Choose a campsite.');
        $ids=kc_site_ids($site);$in=kc_in($ids);
        if(array_key_exists('review_id',$_GET)){
            $id=filter_var($_GET['review_id'],FILTER_VALIDATE_INT,['options'=>['min_range'=>1]]);
            if($id===false)kc_error(422,'Choose a published review.');
            if(!ko_ready($pdo))kc_error(404,'Video is no longer available.');
            $q=$pdo->prepare("SELECT r.id,o.details FROM community_reviews r LEFT JOIN community_observations o ON o.review_id=r.id WHERE r.id=? AND r.campsite_id IN ($in) AND r.status='published'");
            $q->execute(array_merge([$id],$ids));$r=$q->fetch();
            $video=$r?ko_video(json_decode($r['details']??'[]',true)?:[]):null;
            if(!$video)kc_error(404,'Video is no longer available.');
            kt_json(200,['ok'=>true,'review_id'=>(int)$r['id'],'video'=>$video]);
        }
        $before=max(0,(int)($_GET['before']??0));
        $q=$pdo->prepare("SELECT COUNT(*) AS count, AVG(rating) AS average FROM community_reviews WHERE campsite_id IN ($in) AND status='published'");$q->execute($ids);$stats=$q->fetch();
        $hasObservations=ko_ready($pdo);
        $q=$pdo->prepare("SELECT r.id,r.display_name,r.rating,r.body,r.visited_on,r.rig,r.created_at,r.updated_at,".($hasObservations?"o.details":"NULL")." AS observation_details FROM community_reviews r ".($hasObservations?"LEFT JOIN community_observations o ON o.review_id=r.id ":"")."WHERE r.campsite_id IN ($in) AND r.status='published'".($before?' AND r.id < ?':'').' ORDER BY r.id DESC LIMIT 11');$q->execute($before?array_merge($ids,[$before]):$ids);$rows=$q->fetchAll();$more=count($rows)>10;$rows=array_slice($rows,0,10);
        foreach ($rows as &$r) {$r['id']=(int)$r['id'];$r['rating']=(int)$r['rating'];$r['observations']=$r['observation_details']?(json_decode($r['observation_details'],true)?:[]):[];$r['video']=ko_video($r['observations']);$r['observations']=ko_conditions($r['observations']);unset($r['observation_details']);$r['photos']=kc_photo_rows($pdo,$r['id']);}unset($r);
        kt_json(200,['ok'=>true,'count'=>(int)$stats['count'],'average'=>$stats['average']===null?null:round((float)$stats['average'],1),'scores_available'=>$hasObservations,'seasonal_scores'=>(object)ko_site_seasonal($pdo,$ids),'site_scores'=>(object)ko_site_score_summary($pdo,$ids),'score_minimum'=>KO_SCORE_MINIMUM,'reviews'=>$rows,'next_before'=>$more?(int)end($rows)['id']:null,'monthly'=>ko_monthly($pdo,$ids),'photos_available'=>extension_loaded('gd') && class_exists('finfo'),'limits'=>['photos'=>3,'bytes_per_photo'=>KT_PHOTO_INPUT_LIMIT,'pixels_per_photo'=>KT_PHOTO_PIXEL_LIMIT]]);
    }
    kc_origin();
    if ((int)($_SERVER['CONTENT_LENGTH']??0)>20000000) kc_error(413,'This upload is too large. Attach at most three photos, 6 MB each.');
    if ((int)($_SERVER['CONTENT_LENGTH']??0)>0 && !$_POST && !$_FILES) kc_error(413,'This upload exceeds the server limit. Try fewer or smaller photos.');
    $in=$_POST;$action=kc_string($in['action']??'submit',20);
    if (kc_string($in['website']??'',200)!=='') kc_error(422,'Unable to accept this submission.');
    if ($action==='report') {
        $review=(int)($in['review_id']??0);$photo=(int)($in['photo_id']??0);$reason=kc_string($in['reason']??'',1000);
        if (mb_strlen($reason)<10) kc_error(422,'Describe the problem in at least 10 characters.');
        kc_lock($pdo);kc_rate($pdo,'report',5);
        $r=kc_row($pdo,$review);if (!$r || $r['status']!=='published') {$pdo->rollBack();kc_error(404,'Review not found.');}
        if ($photo) {$q=$pdo->prepare("SELECT id FROM community_photos WHERE id=? AND review_id=? AND status='published'");$q->execute([$photo,$review]);if (!$q->fetchColumn()) {$pdo->rollBack();kc_error(404,'Photo not found.');}}
        $pdo->prepare('INSERT INTO community_reports (review_id,photo_id,reason,status,created_at) VALUES (?,?,?,\'open\',?)')->execute([$review,$photo?:null,$reason,kt_now()]);$pdo->commit();kt_json(201,['ok'=>true,'message'=>'Report received. A moderator will review it.']);
    }
    if (!in_array($action,['submit','edit','delete'],true)) kc_error(422,'Unknown action.');
    $owner=kc_owner();$old=null;
    if ($action!=='submit') {
        if ($owner==='') kc_error(401,'A private management code is required.');
        $q=$pdo->prepare('SELECT * FROM community_reviews WHERE owner_hash=?');$q->execute([$owner]);$old=$q->fetch();
        if (!$old || $old['status']==='deleted') kc_error(404,'Review not found.');
    }
    if ($action==='delete') {
        kc_lock($pdo);kc_rate($pdo,'manage',20);$id=(int)$old['id'];
        foreach (kc_photo_rows($pdo,$id,false) as $p) kc_delete_photo($pdo,$p['id'],$id);
        $pdo->prepare("UPDATE community_reviews SET status='deleted',body='',display_name='',rig='',visited_on='',public_note=NULL,updated_at=? WHERE id=?")->execute([kt_now(),$id]);
        ko_save($pdo,$id,[]);ko_changed($pdo);kc_audit($pdo,$id,'author_delete',$old['status'],'deleted','author');$pdo->commit();kt_json(200,['ok'=>true,'status'=>'deleted']);
    }
    $v=kc_validate($in);$observations=ko_validate($in['observations']??'',$present);
    // Reject a submitted season that is neither the visit date's nor adjacent. Final binding follows the edit merge.
    if(isset($observations['season']))ko_bind_season($observations,$v['visited_on'],true);
    $video=array_key_exists('youtube_video',$in)?ko_video_id($in['youtube_video']):null;
    if($video!==null&&$video!=='')$observations['video_id']=$video;
    if ($observations && !ko_ready($pdo)) kc_error(503,'Camper observations are temporarily unavailable. Please try again later.');
    if ($old && $v['campsite_id']!==$old['campsite_id']) kc_error(422,'An existing review cannot be moved to another campsite.');
    // Reject excess photos before decoding any image.
    $removeRaw=$in['remove_photos']??[];
    $remove=is_array($removeRaw)?array_map('intval',array_slice($removeRaw,0,3)):[];
    $existing=$old?kc_photo_rows($pdo,(int)$old['id'],false):[];
    $kept=array_filter($existing,fn($p)=>!in_array($p['id'],$remove,true));
    $incoming=$_FILES['photos']['error']??[];
    if (!is_array($incoming) || count($kept)+count(array_filter($incoming,fn($e)=>$e!==UPLOAD_ERR_NO_FILE))>3) kc_error(422,'A review can have at most three photos. Remove an existing photo before adding another.');
    if (array_filter($incoming,fn($e)=>$e!==UPLOAD_ERR_NO_FILE)) {
        // Charge upload attempts before image decoding, even when validation later rejects the file.
        kc_lock($pdo);kc_rate($pdo,'upload',10);$pdo->commit();
    }
    $photos=kc_photos();
    kc_lock($pdo);kc_rate($pdo,$old?'manage':'submit',$old?20:5);
    if($old){$fresh=kc_row($pdo,(int)$old['id']);if(!$fresh||$fresh['status']==='deleted'){$pdo->rollBack();kc_error(409,'This review changed. Reload it before editing.');}$old=$fresh;if(!array_key_exists('observations',$in))$observations=ko_read($pdo,(int)$old['id']);else $observations=ko_merge_edit($observations,ko_read($pdo,(int)$old['id']),$present);}
    // Older clients omit the video field: preserve it even if they replace observations. Empty explicitly removes it.
    if($old&&$video===null){$prior=ko_read($pdo,(int)$old['id']);if(isset($prior['video_id']))$observations['video_id']=$prior['video_id'];}
    if($video!==null){unset($observations['video_id']);if($video!=='')$observations['video_id']=$video;}
    $token=null;$now=kt_now();
    if (!$old) {
        $token=bin2hex(random_bytes(32));
        $q=$pdo->prepare("INSERT INTO community_reviews (owner_hash,campsite_id,campsite_name,display_name,rating,body,visited_on,rig,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'pending',?,?)");$q->execute([hash('sha256',$token),$v['campsite_id'],$v['campsite_name'],$v['display_name'],$v['rating'],$v['body'],$v['visited_on'],$v['rig'],$now,$now]);$id=(int)$pdo->lastInsertId();
    } else {
        $id=(int)$old['id'];
        $q=$pdo->prepare("UPDATE community_reviews SET display_name=?,rating=?,body=?,visited_on=?,rig=?,status='pending',public_note=NULL,updated_at=? WHERE id=? AND status<>'deleted'");$q->execute([$v['display_name'],$v['rating'],$v['body'],$v['visited_on'],$v['rig'],$now,$id]);
        foreach ($remove as $photo) kc_delete_photo($pdo,$photo,$id);
        $pdo->prepare("UPDATE community_photos SET status='pending' WHERE review_id=? AND status<>'deleted'")->execute([$id]);
    }
    $observations=ko_bind_season($observations,$v['visited_on'],false);
    ko_save($pdo,$id,$observations);kc_save_photos($pdo,$id,$photos);kc_audit($pdo,$id,$old?'author_edit':'submit',$old?$old['status']:'new','pending','author');ko_changed($pdo);$pdo->commit();
    kt_json($old?200:201,['ok'=>true,'id'=>$id,'token'=>$token,'status'=>'pending']);
} catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    error_log('KampTrail community: request failed');kt_unavailable();
}
