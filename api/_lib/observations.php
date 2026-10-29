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
