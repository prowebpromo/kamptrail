<?php
// Published aggregates only. Never return names, prose, owner codes or photo data.
declare(strict_types=1);
require __DIR__.'/_lib/community.php';
if(($_SERVER['REQUEST_METHOD']??'GET')!=='GET'){header('Allow: GET');kc_error(405,'Method not allowed.');}
$pdo=kc_db();
if(!ko_ready($pdo))kc_error(503,'Camper discovery is temporarily unavailable.');
$after=$_GET['after']??'';
if(!is_string($after)||strlen($after)>200||preg_match('/[\x00-\x1f\x7f]/',$after))kc_error(422,'Invalid discovery page.');
try{
    if(kt_driver($pdo)==='mysql')$pdo->exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    $pdo->beginTransaction();
    $revision=(string)$pdo->query('SELECT revision FROM community_discovery_state WHERE id=1')->fetchColumn();
    if(isset($_GET['revision'])&&(!is_string($_GET['revision'])||$_GET['revision']!==$revision)){$pdo->rollBack();kc_error(409,'Published reviews changed. Refresh camper discovery.');}
    $q=$pdo->prepare("SELECT campsite_id,COUNT(*) AS rating_count,SUM(rating) AS rating_sum,MAX(visited_on) AS latest_visit FROM community_reviews WHERE status='published' AND campsite_id>? GROUP BY campsite_id ORDER BY campsite_id LIMIT 101");$q->execute([$after]);$rows=$q->fetchAll();$more=count($rows)>100;$rows=array_slice($rows,0,100);$sites=[];
    foreach($rows as $r){$id=$r['campsite_id'];$sites[$id]=['rating_count'=>(int)$r['rating_count'],'rating_sum'=>(int)$r['rating_sum'],'latest_visit'=>$r['latest_visit'],'observations'=>[]];}
    if($sites){
        $marks=implode(',',array_fill(0,count($sites),'?'));
        $q=$pdo->prepare("SELECT r.campsite_id,o.details,r.visited_on AS latest_visit FROM community_reviews r JOIN community_observations o ON o.review_id=r.id WHERE r.status='published' AND r.campsite_id IN ($marks) ORDER BY r.campsite_id,r.visited_on DESC,r.id");$q->execute(array_keys($sites));
        try{$groups=ko_discovery_groups($q);}catch(OverflowException $e){$pdo->rollBack();kc_error(503,'This discovery page needs a smaller server batch. No partial result was returned.');}
        foreach($groups as $g){$id=$g['campsite_id'];unset($g['campsite_id']);$sites[$id]['observations'][]=$g;}
    }
    $pdo->commit();
    kt_json(200,['ok'=>true,'version'=>1,'revision'=>$revision,'checked_at'=>gmdate('c'),'sites'=>(object)$sites,'next_after'=>$more?end($rows)['campsite_id']:null]);
}catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();error_log('KampTrail camper discovery: request failed');kt_unavailable();}
