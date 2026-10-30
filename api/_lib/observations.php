<?php
declare(strict_types=1);
const KO_VERSION='004_observations';
const KO_AXES=[
    'access'=>['easy','moderate','difficult'],
    'noise'=>['quiet','mixed','noisy'],
    'shade'=>['none','partial','full'],
    'crowding'=>['sparse','moderate','crowded'],
    'comfort'=>['comfortable','concerns'],
];
const KO_CARRIERS=['att','verizon','tmobile','other'];
const KO_SIGNAL=['none','weak','usable','strong'];
const KO_ENVIRONMENTS=['unspecified','outdoors','inside_rv','other_vehicle'];
function ko_ready(PDO $pdo): bool {return in_array(KO_VERSION,kt_applied_migrations($pdo),true);}
function ko_validate($raw): array {
    if ($raw==='') return [];
    if (!is_string($raw) || strlen($raw)>4096) kc_error(422,'Invalid camper observations.');
    try {$in=json_decode($raw,true,16,JSON_THROW_ON_ERROR);}catch(Throwable $e){kc_error(422,'Invalid camper observations.');}
    if (!is_array($in) || array_is_list($in) && $in!==[]) kc_error(422,'Invalid camper observations.');
    if (array_diff(array_keys($in),array_merge(array_keys(KO_AXES),['signals']))) kc_error(422,'Unknown camper observation field.');
    $out=[];
    foreach(KO_AXES as $key=>$allowed){
        $value=$in[$key]??'';
        if($value==='')continue;
        if(!is_string($value)||!in_array($value,$allowed,true))kc_error(422,'Choose a listed camper observation.');
        $out[$key]=$value;
    }
    $signals=$in['signals']??[];
    if(!is_array($signals)||!array_is_list($signals)||count($signals)>4)kc_error(422,'Report each carrier at most once.');
    $seen=[];$outSignals=[];
    foreach($signals as $row){
        if(!is_array($row)||array_diff(array_keys($row),['carrier','signal','environment']))kc_error(422,'Invalid carrier observation.');
        $carrier=$row['carrier']??'';$signal=$row['signal']??'';$environment=$row['environment']??'unspecified';
        if(!in_array($carrier,KO_CARRIERS,true)||isset($seen[$carrier])||!in_array($signal,KO_SIGNAL,true)||!in_array($environment,KO_ENVIRONMENTS,true))kc_error(422,'Choose a listed carrier, signal and setting.');
        $seen[$carrier]=true;$outSignals[]=['carrier'=>$carrier,'signal'=>$signal,'environment'=>$environment];
    }
    usort($outSignals,fn($a,$b)=>strcmp($a['carrier'],$b['carrier']));
    if($outSignals)$out['signals']=$outSignals;
    return $out;
}
function ko_read(PDO $pdo,int $id): array {
    if(!ko_ready($pdo))return [];
    $q=$pdo->prepare('SELECT details FROM community_observations WHERE review_id=?');$q->execute([$id]);$raw=$q->fetchColumn();
    return $raw===false?[]:(json_decode($raw,true)?:[]);
}
function ko_save(PDO $pdo,int $id,array $details): void {
    if(!ko_ready($pdo))return;
    $pdo->prepare('DELETE FROM community_observations WHERE review_id=?')->execute([$id]);
    if($details)$pdo->prepare('INSERT INTO community_observations (review_id,details) VALUES (?,?)')->execute([$id,json_encode($details,JSON_THROW_ON_ERROR)]);
}
function ko_changed(PDO $pdo): void {
    if(ko_ready($pdo))$pdo->exec('UPDATE community_discovery_state SET revision=revision+1 WHERE id=1');
}
/* Calendar visit-month counts, never numeric subscores or a current-condition claim. */
function ko_monthly_groups(array $groups, ?string $today=null): array {
    if(count($groups)>10000)return ['version'=>1,'available'=>false,'reason'=>'limit'];
    $today=$today??gmdate('Y-m-d');
    $out=['version'=>1,'available'=>true,'checked_at'=>gmdate('c'),'basis'=>'calendar_visit_month_all_years','published_reviews'=>0,'condition_reports'=>0,'unreported_reviews'=>0,'excluded_dates'=>0,'invalid_observations'=>0,'months'=>(object)[]];
    $months=[];
    foreach($groups as $row){
        $n=(int)$row['samples'];
        if($n<1||$out['published_reviews']+$n>1000000)return ['version'=>1,'available'=>false,'reason'=>'limit'];
        $out['published_reviews']+=$n;
        $details=$row['details']===null?[]:json_decode($row['details'],true);
        if(!is_array($details)||array_diff(array_keys($details),array_merge(array_keys(KO_AXES),['signals']))){$out['invalid_observations']+=$n;continue;}
        $values=[];$valid=true;
        foreach(KO_AXES as $axis=>$allowed){
            if(!array_key_exists($axis,$details))continue;
            if(!is_string($details[$axis])||!in_array($details[$axis],$allowed,true)){$valid=false;break;}
            $values[$axis]=$details[$axis];
        }
        if(!$valid){$out['invalid_observations']+=$n;continue;}
        // Carrier-only reports and reviews without condition fields add no condition counts.
        if(!$values){$out['unreported_reviews']+=$n;continue;}
        $date=$row['visited_on'];$parsed=is_string($date)?DateTimeImmutable::createFromFormat('!Y-m-d',$date):false;
        if(!$parsed||$parsed->format('Y-m-d')!==$date||$date<'1900-01-01'||$date>$today){$out['excluded_dates']+=$n;continue;}
        $month=substr($date,5,2);
        if(!isset($months[$month]))$months[$month]=['reports'=>0,'first_visit'=>$date,'latest_visit'=>$date,'axes'=>array_fill_keys(array_keys(KO_AXES),[])];
        $entry=&$months[$month];$entry['reports']+=$n;
        $entry['first_visit']=min($entry['first_visit'],$date);$entry['latest_visit']=max($entry['latest_visit'],$date);
        foreach($values as $axis=>$value)$entry['axes'][$axis][$value]=($entry['axes'][$axis][$value]??0)+$n;
        unset($entry);$out['condition_reports']+=$n;
    }
    ksort($months);
    foreach($months as &$entry){foreach($entry['axes'] as &$counts){ksort($counts);$counts=(object)$counts;}unset($counts);$entry['axes']=(object)$entry['axes'];}unset($entry);
    $out['months']=(object)$months;
    return $out;
}
function ko_monthly(PDO $pdo,string $site): array {
    if(!ko_ready($pdo))return ['version'=>1,'available'=>false,'reason'=>'unavailable'];
    // All published rows for this exact identity, independent of the ten-review page.
    $q=$pdo->prepare("SELECT r.visited_on,o.details,COUNT(*) AS samples FROM community_reviews r LEFT JOIN community_observations o ON o.review_id=r.id WHERE r.status='published' AND r.campsite_id=? GROUP BY r.visited_on,o.details LIMIT 10001");
    $q->execute([$site]);$groups=$q->fetchAll();
    if(count($groups)>10000)return ['version'=>1,'available'=>false,'reason'=>'limit'];
    return ko_monthly_groups($groups);
}
