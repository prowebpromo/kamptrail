<?php
declare(strict_types=1);
require __DIR__ . '/_lib/permissions.php';
kt_headers();
$pdo=null;
try {
    kt_require_method('POST');
    if ($_GET) kp_fail(422,'invalid_fields','Send permission-report data in the request body.');
    kp_origin();
    if (strtolower(trim(explode(';',$_SERVER['CONTENT_TYPE']??'')[0]))!=='application/json') kp_fail(415,'content_type','Send a JSON request.');
    $in=kt_json_body(24000);
    if (array_is_list($in)) kp_fail(422,'invalid_fields','Send a JSON object.');
    $action=$in['action']??'';
    $fields=['place','activity','observation','visited_on','firsthand','display_name','body','authority_role','authority_office','elapsed_ms','website'];
    $allowed=['read'=>['place','before','activity'],'owner'=>[],'submit'=>$fields,'edit'=>array_merge($fields,['id','version']),'delete'=>['id','version'],'flag'=>['id','reason','elapsed_ms','website']];
    if (!is_string($action) || !isset($allowed[$action])) kp_fail(422,'invalid_action','Choose a valid permission-report action.');
    kp_keys($in,array_merge(['action'],$allowed[$action]));
    if ($action==='read') {
        $place=kp_place($in['place']??null);$key=kp_place_key($place);
        $before=isset($in['before'])?kp_int($in['before'],0):0;
        $activity=$in['activity']??null;
        if ($activity!==null && !in_array($activity,KP_ACTIVITIES,true)) kp_fail(422,'invalid_activity','Choose a supported activity.');
        $result=['ok'=>true,'place_key'=>$key,'place'=>$place,'official'=>kp_official($place,null,$activity??'overnight_occupancy'),'reports_available'=>false,'reports'=>[],'count'=>0,'next_before'=>null,'answers'=>null];
        // Official evidence is independent of community database availability and moderation.
        try {
            $pdo=kt_db();
            if (kp_ready($pdo)) {
                $where="place_key=? AND status='published'";$args=[$key];
                if ($activity!==null) {$where.=' AND activity=?';$args[]=$activity;}
                $q=$pdo->prepare('SELECT COUNT(*) FROM permission_reports WHERE '.$where);$q->execute($args);$result['count']=(int)$q->fetchColumn();
                if ($before) {$where.=' AND id<?';$args[]=$before;}
                $q=$pdo->prepare('SELECT * FROM permission_reports WHERE '.$where.' ORDER BY id DESC LIMIT 11');$q->execute($args);$rows=$q->fetchAll();$more=count($rows)>10;$rows=array_slice($rows,0,10);
                $result['reports']=array_map(fn($row)=>kp_public($row),$rows);$result['next_before']=$more?(int)end($rows)['id']:null;$result['reports_available']=true;
                if ($activity===null || $activity==='overnight_occupancy') $result['answers']=kp_answers($pdo,$key);
            }
        } catch (Throwable $e) { $result['reports']=[];$result['count']=0;$result['next_before']=null;$result['reports_available']=false;$result['answers']=null; }
        kt_json(200,$result);
    }
    // Credentials are checked on every owner operation; a report ID alone grants no access.
    $owner=in_array($action,['owner','edit','delete'],true)?kp_owner():null;
    $pdo=kp_require_db(kt_db());
    if ($action==='owner') kt_json(200,['ok'=>true,'report'=>kp_public(kp_owned($pdo,$owner),true)]);
    if ($action==='submit' || $action==='edit') {$data=kp_validate($in);kp_abuse($in);}
    if ($action==='flag') {kp_abuse($in);$reason=kp_text($in['reason']??'',1000,10);}
    $id=in_array($action,['edit','delete','flag'],true)?kp_int($in['id']??null):null;
    $version=in_array($action,['edit','delete'],true)?kp_int($in['version']??null):null;
    kp_lock($pdo);
    if ($action==='submit') {
        kp_rate($pdo,'permission_submit',5);$token=bin2hex(random_bytes(32));$place=$data['place'];
        if (in_array($data['observation'],KP_ANSWERS,true)) kp_answer_once($pdo,kp_place_key($place));
        $q=$pdo->prepare("INSERT INTO permission_reports (owner_hash,place_key,place_kind,place_id,place_name,lng,lat,activity,observation,visited_on,firsthand,display_name,body,authority_role,authority_office,status,version,public_note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,'pending',1,'',?,?)");
        $values=[hash('sha256',$token,true),kp_place_key($place),$place['kind'],$place['id'],$place['name'],$place['coordinates'][0],$place['coordinates'][1],$data['activity'],$data['observation'],$data['visited_on'],$data['display_name'],$data['body'],$data['authority_role'],$data['authority_office'],kt_now(),kt_now()];
        foreach ($values as $i=>$value) $q->bindValue($i+1,$value,$i===0?PDO::PARAM_LOB:PDO::PARAM_STR);$q->execute();$id=(int)$pdo->lastInsertId();
        kp_audit($pdo,$id,'submit','','pending',1,'owner');$pdo->commit();
        kt_json(201,['ok'=>true,'id'=>$id,'token'=>$token,'version'=>1,'status'=>'pending']);
    }
    if ($action==='flag') {
        kp_rate($pdo,'permission_flag',5);
        $q=$pdo->prepare("SELECT id,version FROM permission_reports WHERE id=? AND status='published'");$q->execute([$id]);$row=$q->fetch();
        if (!$row) kp_fail(404,'not_found','Published report not found.');
        $pdo->prepare("INSERT INTO permission_flags (report_id,reason,status,version,created_at) VALUES (?,?,'open',1,?)")->execute([$id,$reason,kt_now()]);
        kp_audit($pdo,$id,'flag','published','published',(int)$row['version'],'visitor');$pdo->commit();kt_json(201,['ok'=>true]);
    }
    $row=kp_owned($pdo,$owner,$id);kp_version($row,$version);
    kp_rate($pdo,'permission_'.$action,$action==='delete'?20:15);
    if ($action==='delete') {
        kp_erase($pdo,$row);kp_audit($pdo,$id,'delete',$row['status'],'deleted',$version+1,'owner');$pdo->commit();
        kt_json(200,['ok'=>true,'id'=>$id,'version'=>$version+1,'status'=>'deleted']);
    }
    if (kp_place_key($data['place'])!==$row['place_key']) kp_fail(422,'place_changed','A report cannot be moved to another place.');
    // An answer stays an answer and a narrative report stays a report, so edits cannot bypass the duplicate rule.
    if (in_array($data['observation'],KP_ANSWERS,true)!==in_array($row['observation'],KP_ANSWERS,true)) kp_fail(422,'type_changed','Edit an answer as an answer, or share a separate report.');
    $q=$pdo->prepare("UPDATE permission_reports SET activity=?,observation=?,visited_on=?,display_name=?,body=?,authority_role=?,authority_office=?,public_note='',status='pending',version=version+1,updated_at=? WHERE id=? AND owner_hash=? AND version=? AND status<>'deleted'");
    $values=[$data['activity'],$data['observation'],$data['visited_on'],$data['display_name'],$data['body'],$data['authority_role'],$data['authority_office'],kt_now(),$id,$owner,$version];
    foreach ($values as $i=>$value) $q->bindValue($i+1,$value,$i===9?PDO::PARAM_LOB:PDO::PARAM_STR);$q->execute();
    if ($q->rowCount()!==1) kp_fail(409,'conflict','This report changed. Reload it before editing.');
    kp_audit($pdo,$id,'edit',$row['status'],'pending',$version+1,'owner');$pdo->commit();
    kt_json(200,['ok'=>true,'id'=>$id,'version'=>$version+1,'status'=>'pending']);
} catch (KpError $e) {
    if ($pdo && $pdo->inTransaction()) $pdo->rollBack();
    kt_json($e->getCode(),['ok'=>false,'error'=>$e->error,'message'=>$e->getMessage()]);
} catch (Throwable $e) {
    if ($pdo && $pdo->inTransaction()) $pdo->rollBack();
    // Do not log input, locations, credentials, report text or raw database errors.
    kt_json(503,['ok'=>false,'error'=>'unavailable','message'=>'Permission reports are temporarily unavailable. Please try again later.']);
}
