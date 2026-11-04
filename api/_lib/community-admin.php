<?php
// Included only after admin authentication and CSRF validation.
declare(strict_types=1);
require_once __DIR__ . '/community.php';
function kc_moderate(PDO $pdo,string $moderator): string {
    $id=(int)($_POST['review_id']??0);$action=kc_string($_POST['do']??'',30);
    kc_lock($pdo);$r=kc_row($pdo,$id);
    if (!$r || $r['status']==='deleted') {if($action==='community_review')throw new UnexpectedValueException('review_changed');throw new InvalidArgumentException('review');}
    if ($action==='community_review') {
        if(!hash_equals(kc_review_hash($pdo,$r),(string)($_POST['expected_hash']??'')))throw new UnexpectedValueException('review_changed');
        $to=kc_string($_POST['status']??'',20);
        if (!in_array($to,KT_COMMUNITY_STATES,true)) throw new InvalidArgumentException('status');
        $note=kc_string($_POST['public_note']??'',1000);
        if($to==='published'&&ko_video(ko_read($pdo,$id))&&($_POST['video_reviewed']??'')!=='1')throw new UnexpectedValueException('video_review_required');
        $pdo->prepare('UPDATE community_reviews SET status=?,public_note=?,updated_at=? WHERE id=?')->execute([$to,$note,kt_now(),$id]);
        ko_changed($pdo);kc_audit($pdo,$id,'moderate_review',$r['status'],$to,$moderator);
    } elseif ($action==='community_photo') {
        $photo=(int)($_POST['photo_id']??0);$to=kc_string($_POST['status']??'',20);
        if (!in_array($to,KT_COMMUNITY_STATES,true)) throw new InvalidArgumentException('status');
        $q=$pdo->prepare("SELECT status FROM community_photos WHERE id=? AND review_id=? AND status<>'deleted'");$q->execute([$photo,$id]);$from=$q->fetchColumn();if ($from===false) throw new InvalidArgumentException('photo');
        $pdo->prepare('UPDATE community_photos SET status=? WHERE id=? AND review_id=?')->execute([$to,$photo,$id]);
        kc_audit($pdo,$id,'photo_'.$photo,(string)$from,$to,$moderator);
    } elseif ($action==='community_report') {
        $report=(int)($_POST['report_id']??0);
        $pdo->prepare("UPDATE community_reports SET status='resolved' WHERE id=? AND review_id=?")->execute([$report,$id]);
        kc_audit($pdo,$id,'report_'.$report,'open','resolved',$moderator);
    } else throw new InvalidArgumentException('action');
    $pdo->commit();return 'Community moderation saved.';
}
function kc_admin_body(PDO $pdo,string $csrf,string $self): string {
    $base=$self.'?community=1';
    $filter=in_array($_GET['state']??'pending',array_merge(KT_COMMUNITY_STATES,['reports','all']),true)?($_GET['state']??'pending'):'pending';
    $body='<h2>Reviews and photos</h2><p>Review campsite identity, visit date and firsthand content. Approve the whole review, observations and attached video together; approve each photo separately. Watch an attached video and check its campsite relevance and permission before publishing. External video content can change later. Hidden content can be restored by publishing it again. Author-deleted content cannot be restored.</p><nav>';
    foreach (array_merge(KT_COMMUNITY_STATES,['reports','all']) as $s) $body.='<a href="'.$base.'&amp;state='.h($s).'">'.($s===$filter?'<strong>'.h($s).'</strong>':h($s)).'</a>';
    $used=(int)$pdo->query('SELECT used_bytes FROM community_storage WHERE id=1')->fetchColumn();
    $cap=min(KT_PHOTO_STORAGE_LIMIT,max(0,(int)(kt_config()['community_storage_bytes']??KT_PHOTO_STORAGE_LIMIT)));
    $body.='</nav><p class="meta">Encoded photos: '.h(round($used/1048576,2)).' / '.h(round($cap/1048576)).' MB. Database backups must include the photo tables.</p>';
    $before=max(0,(int)($_GET['before']??0));
    $where="r.status<>'deleted'";$args=[];
    if ($filter==='reports') $where.=" AND EXISTS (SELECT 1 FROM community_reports f WHERE f.review_id=r.id AND f.status='open')";
    elseif ($filter==='pending') $where.=" AND (r.status='pending' OR EXISTS (SELECT 1 FROM community_photos p WHERE p.review_id=r.id AND p.status='pending'))";
    elseif ($filter!=='all') {$where.=' AND r.status=?';$args[]=$filter;}
    if ($before) {$where.=' AND r.id<?';$args[]=$before;}
    $q=$pdo->prepare('SELECT r.* FROM community_reviews r WHERE '.$where.' ORDER BY r.id DESC LIMIT 21');$q->execute($args);$rows=$q->fetchAll();$more=count($rows)>20;$rows=array_slice($rows,0,20);
    if (!$rows) $body.='<p class="card">No reviews in this queue.</p>';
    $hidden=fn($do,$r)=>'<input type="hidden" name="csrf" value="'.h($csrf).'"><input type="hidden" name="do" value="'.h($do).'"><input type="hidden" name="review_id" value="'.h($r['id']).'">';
    $options=fn($state)=>implode('',array_map(fn($s)=>'<option'.($s===$state?' selected':'').'>'.h($s).'</option>',KT_COMMUNITY_STATES));
    foreach ($rows as $r) {
        $body.='<article class="card"><h3>#'.h($r['id']).' '.h($r['campsite_name']).'</h3><p><a href="../#site='.rawurlencode($r['campsite_id']).'" target="_blank" rel="noopener noreferrer">Check listing on map</a> · '.h($r['campsite_id']).'</p><p class="meta">'.h($r['display_name']).' · '.h($r['rating']).'/5 · visited '.h($r['visited_on']).' · '.h($r['rig']).' · '.h($r['status']).'</p><p style="white-space:pre-wrap">'.h($r['body']).'</p>';
        $observed=ko_read($pdo,(int)$r['id']);$photos=kc_photo_rows($pdo,(int)$r['id'],false);$expected=kc_review_snapshot_hash($r,$observed,$photos);$video=ko_video($observed);$observed=ko_conditions($observed);if($observed)$body.='<details open><summary>Camper observations (approve with review)</summary><pre style="white-space:pre-wrap">'.h(json_encode($observed,JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES)).'</pre><p>Self-reported visit conditions, not current access, safety or coverage guarantees.</p></details>';
        if($video)$body.='<div class="card"><strong>Attached YouTube video — included in whole-review approval</strong><p><a href="'.h($video['url']).'" target="_blank" rel="noopener noreferrer">View submitted video on YouTube</a></p><p>'.h($video['url']).'</p><p>Video posted and recorded dates are unknown. The visit date is the review author’s report. No player or thumbnail loads here.</p></div>';
        $body.='<form method="post" action="'.$base.'&amp;state='.h($filter).'">'.$hidden('community_review',$r).'<input type="hidden" name="expected_hash" value="'.h($expected).'"><label>Whole-review status <select name="status">'.$options($r['status']).'</select></label> <label>Note to author <input name="public_note" maxlength="1000" value="'.h($r['public_note']??'').'"></label> '.($video?'<label><input type="checkbox" name="video_reviewed" value="1"> I watched this attached video and checked its campsite relevance and permission to share before publishing.</label> ':'').'<button>Save review decision</button></form>';
        foreach ($photos as $p) {
            $body.='<div class="card"><img src="photo.php?id='.h($p['id']).'&amp;preview=1" alt="Submitted photo '.h($p['id']).'" style="max-width:100%;max-height:260px"><form method="post" action="'.$base.'&amp;state='.h($filter).'">'.$hidden('community_photo',$r).'<input type="hidden" name="photo_id" value="'.h($p['id']).'"><label>Photo '.h($p['id']).' status <select name="status">'.$options($p['status']).'</select></label> <button>Save photo decision</button></form></div>';
        }
        $q=$pdo->prepare('SELECT * FROM community_reports WHERE review_id=? ORDER BY id DESC LIMIT 30');$q->execute([$r['id']]);
        foreach ($q->fetchAll() as $f) {
            $body.='<div class="card"><strong>Report #'.h($f['id']).($f['photo_id']?' on photo #'.h($f['photo_id']):' on review').' · '.h($f['status']).'</strong><p>'.h($f['reason']).'</p>';
            if ($f['status']==='open') $body.='<form method="post" action="'.$base.'&amp;state=reports">'.$hidden('community_report',$r).'<input type="hidden" name="report_id" value="'.h($f['id']).'"><button>Mark report resolved</button></form>';
            $body.='</div>';
        }
        $q=$pdo->prepare('SELECT action,from_status,to_status,actor,created_at FROM community_audit WHERE review_id=? ORDER BY id DESC LIMIT 20');$q->execute([$r['id']]);
        $body.='<details><summary>Recent audit history</summary><ul>';
        foreach ($q->fetchAll() as $l) $body.='<li>'.h($l['created_at']).' UTC · '.h($l['actor']).' · '.h($l['action']).' · '.h($l['from_status']).' → '.h($l['to_status']).'</li>';
        $body.='</ul></details></article>';
    }
    if ($more) $body.='<p><a href="'.$base.'&amp;state='.h($filter).'&amp;before='.h(end($rows)['id']).'">Older reviews</a></p>';
    return $body;
}
