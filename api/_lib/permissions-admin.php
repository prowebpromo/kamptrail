<?php
declare(strict_types=1);
require_once __DIR__ . '/permissions.php';
function kp_admin_guard(bool $write=false): void {
    if (empty($_SESSION['moderator'])) kp_fail(403,'forbidden','Moderator sign-in is required.');
    if ($write && (($_SERVER['REQUEST_METHOD']??'')!=='POST' || !is_string($_SESSION['csrf']??null) || !is_string($_POST['csrf']??null) || !hash_equals($_SESSION['csrf'],$_POST['csrf']))) kp_fail(403,'csrf','Reload the moderation form.');
}
function kp_admin_number($value): int {
    if (!is_string($value) || !preg_match('/^[1-9][0-9]{0,9}$/D',$value) || (int)$value>2147483647) kp_fail(422,'invalid_integer','Invalid identifier or version.');
    return (int)$value;
}
function kp_admin_action(PDO $pdo,string $moderator): string {
    kp_admin_guard(true);kp_require_db($pdo);
    $action=$_POST['do']??'';
    kp_keys($_POST,['csrf','do','id','version','status','public_note','flag_id','flag_version']);
    $id=kp_admin_number($_POST['id']??null);$version=kp_admin_number($_POST['version']??null);
    kp_lock($pdo);
    try {
        $q=$pdo->prepare('SELECT * FROM permission_reports WHERE id=?');$q->execute([$id]);$row=$q->fetch();
        if (!$row || $row['status']==='deleted') kp_fail(404,'not_found','This report no longer exists.');
        kp_version($row,$version);
        if ($action==='permission_moderate') {
            $to=$_POST['status']??'';
            if (!in_array($to,KP_STATES,true)) kp_fail(422,'invalid_status','Choose a report status.');
            $note=kp_text($_POST['public_note']??'',1000);
            if ($to==='deleted') kp_erase($pdo,$row);
            else {
                $q=$pdo->prepare("UPDATE permission_reports SET status=?,public_note=?,version=version+1,updated_at=? WHERE id=? AND version=? AND status<>'deleted'");$q->execute([$to,$note,kt_now(),$id,$version]);
                if ($q->rowCount()!==1) kp_fail(409,'conflict','This report changed. Reload the queue.');
            }
            kp_audit($pdo,$id,'moderate',$row['status'],$to,$version+1,'moderator');
        } elseif ($action==='permission_flag') {
            $flag=kp_admin_number($_POST['flag_id']??null);$flagVersion=kp_admin_number($_POST['flag_version']??null);
            $q=$pdo->prepare("UPDATE permission_flags SET status='resolved',version=version+1 WHERE id=? AND report_id=? AND version=? AND status='open'");$q->execute([$flag,$id,$flagVersion]);
            if ($q->rowCount()!==1) kp_fail(409,'conflict','This flag changed. Reload the queue.');
            kp_audit($pdo,$id,'resolve_flag',$row['status'],$row['status'],$version,'moderator');
        } else kp_fail(422,'invalid_action','Unknown moderation action.');
        $pdo->commit();return 'Permission report moderation saved.';
    } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack();if ($e instanceof KpError) { http_response_code($e->getCode()); if ($e->getCode()===409) return 'This report changed. Reload the queue before applying a decision.'; } throw $e; }
}
function kp_admin_view(PDO $pdo,string $csrf,string $self): string {
    kp_admin_guard();kp_require_db($pdo);
    $base=$self.'?permissions=1';$states=['pending','published','rejected','flags','all'];$filter=$_GET['state']??'pending';if (!in_array($filter,$states,true)) $filter='pending';
    $body='<h2>Overnight permission reports</h2><p>Firsthand camper reports are separate from star reviews, fees and official evidence. A personal grant is not permission for everyone. Check the activity, observation date and authority role before publishing. Edits return to pending. Deleted reports cannot be restored.</p><nav>';
    foreach ($states as $state) $body.='<a href="'.$base.'&amp;state='.h($state).'">'.h($state).'</a> ';
    $body.='</nav>';$where="r.status<>'deleted'";$args=[];
    if ($filter==='flags') $where.=" AND EXISTS (SELECT 1 FROM permission_flags f WHERE f.report_id=r.id AND f.status='open')";
    elseif ($filter!=='all') {$where.=' AND r.status=?';$args[]=$filter;}
    $before=max(0,(int)($_GET['before']??0));if ($before) {$where.=' AND r.id<?';$args[]=$before;}
    $q=$pdo->prepare('SELECT r.* FROM permission_reports r WHERE '.$where.' ORDER BY r.id DESC LIMIT 21');$q->execute($args);$rows=$q->fetchAll();$more=count($rows)>20;$rows=array_slice($rows,0,20);
    if (!$rows) $body.='<p class="card">No permission reports in this queue.</p>';
    $hidden=fn($action,$row)=>'<input type="hidden" name="csrf" value="'.h($csrf).'"><input type="hidden" name="do" value="'.h($action).'"><input type="hidden" name="id" value="'.h($row['id']).'"><input type="hidden" name="version" value="'.h($row['version']).'">';
    foreach ($rows as $row) {
        $body.='<article class="card"><h3>#'.h($row['id']).' '.h($row['place_name']).'</h3><p>'.h($row['place_key']).' · '.h($row['lat']).', '.h($row['lng']).'</p><p>'.h($row['activity']).' · '.h($row['observation']).' · observed '.h($row['visited_on']).'</p><p>'.h($row['display_name']).' · '.h($row['status']).' · version '.h($row['version']).'</p><p style="white-space:pre-wrap">'.h($row['body']).'</p><p>Authority role: '.h($row['authority_role']).' · office/property: '.h($row['authority_office']).'</p>';
        $body.='<form method="post" action="'.$base.'&amp;state='.h($filter).'">'.$hidden('permission_moderate',$row).'<label>Report status <select name="status">';
        foreach (KP_STATES as $state) $body.='<option'.($state===$row['status']?' selected':'').'>'.h($state).'</option>';
        $body.='</select></label> <label>Note to author <input name="public_note" maxlength="1000" value="'.h($row['public_note']).'"></label> <button>Save permission decision</button></form>';
        $q=$pdo->prepare('SELECT * FROM permission_flags WHERE report_id=? ORDER BY id DESC LIMIT 30');$q->execute([$row['id']]);
        foreach ($q->fetchAll() as $flag) {
            $body.='<section class="card"><strong>Flag #'.h($flag['id']).' · '.h($flag['status']).'</strong><p>'.h($flag['reason']).'</p>';
            if ($flag['status']==='open') $body.='<form method="post" action="'.$base.'&amp;state=flags">'.$hidden('permission_flag',$row).'<input type="hidden" name="flag_id" value="'.h($flag['id']).'"><input type="hidden" name="flag_version" value="'.h($flag['version']).'"><button>Resolve flag</button></form>';
            $body.='</section>';
        }
        $q=$pdo->prepare('SELECT action,from_status,to_status,report_version,actor,created_at FROM permission_audit WHERE report_id=? ORDER BY id DESC LIMIT 20');$q->execute([$row['id']]);$body.='<details><summary>Audit history</summary><ul>';
        foreach ($q->fetchAll() as $log) $body.='<li>'.h($log['created_at']).' UTC · '.h($log['actor']).' · '.h($log['action']).' · '.h($log['from_status']).' → '.h($log['to_status']).' · version '.h($log['report_version']).'</li>';
        $body.='</ul></details></article>';
    }
    if ($more) $body.='<p><a href="'.$base.'&amp;state='.h($filter).'&amp;before='.h(end($rows)['id']).'">Older permission reports</a></p>';
    return $body;
}
