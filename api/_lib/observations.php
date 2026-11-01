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
// Optional 1-5 visit scores. quietness, noise_day, noise_night, shade, cleanliness and comfort: 5 is the
// better experience. crowds (perceived crowding) and fullness (share of camping spaces occupied): 5 is more
// crowded or fuller. None is derived from the categorical noise, crowding or shade fields.
const KO_SCORE_AXES=['quietness','shade','comfort','noise_day','noise_night','cleanliness','crowds','fullness'];
const KO_SEASONS=['winter','spring','summer','fall'];
const KO_SCORE_MINIMUM=3;
const KO_CARRIERS=['att','verizon','tmobile','other'];
const KO_SIGNAL=['none','weak','usable','strong'];
const KO_ENVIRONMENTS=['unspecified','outdoors','inside_rv','other_vehicle'];
const KO_RADIOS=['unspecified','lte','5g'];
function ko_ready(PDO $pdo): bool {return in_array(KO_VERSION,kt_applied_migrations($pdo),true);}
function ko_validate($raw): array {
    if ($raw==='') return [];
    if (!is_string($raw) || strlen($raw)>4096) kc_error(422,'Invalid camper observations.');
    try {$in=json_decode($raw,true,16,JSON_THROW_ON_ERROR);}catch(Throwable $e){kc_error(422,'Invalid camper observations.');}
    if (!is_array($in) || array_is_list($in) && $in!==[]) kc_error(422,'Invalid camper observations.');
    if (array_diff(array_keys($in),array_merge(array_keys(KO_AXES),['signals','scores','season']))) kc_error(422,'Unknown camper observation field.');
    $out=[];
    foreach(KO_AXES as $key=>$allowed){
        $value=$in[$key]??'';
        if($value==='')continue;
        if(!is_string($value)||!in_array($value,$allowed,true))kc_error(422,'Choose a listed camper observation.');
        $out[$key]=$value;
    }
    if(array_key_exists('scores',$in)){
        $scores=$in['scores'];$shape=json_decode($raw);
        if(!is_object($shape->scores??null)||!is_array($scores)||(array_is_list($scores)&&$scores!==[])||array_diff(array_keys($scores),KO_SCORE_AXES))kc_error(422,'Invalid camper sub-ratings.');
        $clean=[];
        foreach(KO_SCORE_AXES as $axis)if(array_key_exists($axis,$scores)){
            if(!is_int($scores[$axis])||$scores[$axis]<1||$scores[$axis]>5)kc_error(422,'Sub-ratings must be whole numbers from 1 to 5.');
            $clean[$axis]=$scores[$axis];
        }
        if($clean)$out['scores']=$clean;
    }
    // The rated season is checked against the visit date by ko_bind_season.
    if(array_key_exists('season',$in)&&$in['season']!==''){
        if(!is_string($in['season'])||!in_array($in['season'],KO_SEASONS,true))kc_error(422,'Choose a listed season.');
        $out['season']=$in['season'];
    }
    $signals=$in['signals']??[];
    if(!is_array($signals)||!array_is_list($signals)||count($signals)>4)kc_error(422,'Report each carrier at most once.');
    $seen=[];$outSignals=[];
    foreach($signals as $row){
        if(!is_array($row)||array_diff(array_keys($row),['carrier','signal','environment','radio']))kc_error(422,'Invalid carrier observation.');
        $carrier=$row['carrier']??'';$signal=$row['signal']??'';$environment=$row['environment']??'unspecified';$radio=array_key_exists('radio',$row)?$row['radio']:'unspecified';
        if(!in_array($carrier,KO_CARRIERS,true)||isset($seen[$carrier])||!in_array($signal,KO_SIGNAL,true)||!in_array($environment,KO_ENVIRONMENTS,true)||!in_array($radio,KO_RADIOS,true))kc_error(422,'Choose a listed carrier, signal, setting and technology.');
        $seen[$carrier]=true;$entry=['carrier'=>$carrier,'signal'=>$signal,'environment'=>$environment];
        if($radio!=='unspecified')$entry['radio']=$radio;
        $outSignals[]=$entry;
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
        if(is_array($details))$details=ko_monthly_conditions($details);
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
function ko_monthly(PDO $pdo,string|array $site): array {
    $ids=is_array($site)?array_values($site):[$site];$in=implode(',',array_fill(0,count($ids),'?'));
    if(!ko_ready($pdo))return ['version'=>1,'available'=>false,'reason'=>'unavailable'];
    // All published rows for every published id of this listing, independent of the ten-review page.
    $q=$pdo->prepare("SELECT r.visited_on,o.details FROM community_reviews r LEFT JOIN community_observations o ON o.review_id=r.id WHERE r.status='published' AND r.campsite_id IN ($in)");
    $q->execute($ids);$groups=[];
    foreach($q as $row){
        $details=$row['details']===null?null:json_decode($row['details'],true);
        if(is_array($details))$row['details']=json_encode(ko_monthly_conditions($details),JSON_THROW_ON_ERROR);
        $key=json_encode([$row['visited_on'],$row['details']],JSON_THROW_ON_ERROR);
        if(!isset($groups[$key])){if(count($groups)>=10000)return ['version'=>1,'available'=>false,'reason'=>'limit'];$groups[$key]=$row+['samples'=>0];}
        $groups[$key]['samples']++;
    }
    return ko_monthly_groups(array_values($groups));
}

// Calendar visit seasons for US listings, across years; never infer climate or scores.
// Keep identical to season() and allowedSeasons() in community-discovery.js (parity test in tests/discovery.test.js).
function ko_valid_date($date): bool {
    if(!is_string($date)||!preg_match('/^\d{4}-\d{2}-\d{2}$/D',$date)||$date<'1900-01-01')return false;
    $parsed=DateTimeImmutable::createFromFormat('!Y-m-d',$date);
    return $parsed!==false&&$parsed->format('Y-m-d')===$date;
}
function ko_season($date): ?string {
    if(!ko_valid_date($date))return null;
    $month=(int)substr($date,5,2);
    return $month===12||$month<=2?'winter':($month<=5?'spring':($month<=8?'summer':'fall'));
}
// The visit date's season first, then the adjacent seasons a stay may have crossed into.
function ko_allowed_seasons($date): array {
    $season=ko_season($date);if($season===null)return [];
    $i=array_search($season,KO_SEASONS,true);
    return [$season,KO_SEASONS[($i+3)%4],KO_SEASONS[($i+1)%4]];
}
// Season a group's scores describe: the visitor-confirmed season, or the visit date's. No date, no season.
function ko_rated_season(array $values,$date): ?string {
    $allowed=ko_allowed_seasons($date);if(!$allowed)return null;
    $chosen=$values['season']??null;
    return is_string($chosen)&&in_array($chosen,$allowed,true)?$chosen:$allowed[0];
}
// A season is kept only with numeric scores and only when it is the visit date's season or adjacent to it.
// Strict mode rejects a submitted mismatch; otherwise (stored observations after a date edit) it is dropped.
function ko_bind_season(array $observations,$date,bool $strict): array {
    if(!array_key_exists('season',$observations))return $observations;
    $allowed=ko_allowed_seasons($date);
    if(!in_array($observations['season'],$allowed,true)){
        if($strict)kc_error(422,'Choose the season of your visit date or the adjacent season your stay crossed into.');
        unset($observations['season']);
    }
    // The visit date's own season is implied, so it is not stored and follows later date edits.
    if(empty($observations['scores'])||($observations['season']??null)===($allowed[0]??null))unset($observations['season']);
    return $observations;
}
function ko_seasonal(iterable $groups): array {
    $out=[];
    foreach($groups as $g){
        $date=$g['latest_visit'];$season=ko_rated_season($g['values'],$date);$count=(int)$g['count'];
        if($season===null)continue;
        foreach(KO_SCORE_AXES as $axis){
            $value=$g['values']['scores'][$axis]??null;
            if(!is_int($value)||$value<1||$value>5||$count<1)continue;
            $r=$out[$season][$axis]??['count'=>0,'sum'=>0,'first_visit'=>$date,'latest_visit'=>$date];
            $r['count']+=$count;$r['sum']+=$value*$count;
            $r['first_visit']=min($r['first_visit'],$date);$r['latest_visit']=max($r['latest_visit'],$date);
            $out[$season][$axis]=$r;
        }
    }
    return $out;
}
function ko_site_seasonal(PDO $pdo,string|array $site): array {
    if(!ko_ready($pdo))return [];
    $ids=is_array($site)?array_values($site):[$site];$in=implode(',',array_fill(0,count($ids),'?'));
    $q=$pdo->prepare("SELECT o.details,r.visited_on FROM community_reviews r JOIN community_observations o ON o.review_id=r.id WHERE r.campsite_id IN ($in) AND r.status='published'");$q->execute($ids);
    $groups=(function()use($q){foreach($q as $r)yield ['values'=>ko_conditions(json_decode($r['details'],true)?:[]),'count'=>1,'latest_visit'=>$r['visited_on']];})();
    return ko_seasonal($groups);
}
// Whole-site averages per axis. An average is published only from KO_SCORE_MINIMUM explicit ratings; below that
// only the count is returned. Ratings without a usable visit date still count here but never in a season.
function ko_site_scores(iterable $groups): array {
    $acc=[];
    foreach($groups as $g){
        $count=(int)$g['count'];$date=$g['latest_visit'];if($count<1)continue;
        foreach(KO_SCORE_AXES as $axis){
            $value=$g['values']['scores'][$axis]??null;
            if(!is_int($value)||$value<1||$value>5)continue;
            $r=$acc[$axis]??['count'=>0,'sum'=>0,'first_visit'=>null,'latest_visit'=>null];
            $r['count']+=$count;$r['sum']+=$value*$count;
            if(ko_valid_date($date)){$r['first_visit']=$r['first_visit']===null?$date:min($r['first_visit'],$date);$r['latest_visit']=$r['latest_visit']===null?$date:max($r['latest_visit'],$date);}
            $acc[$axis]=$r;
        }
    }
    $out=[];
    foreach(KO_SCORE_AXES as $axis)if(isset($acc[$axis])){
        $r=$acc[$axis];
        $out[$axis]=['count'=>$r['count'],'average'=>$r['count']>=KO_SCORE_MINIMUM?round($r['sum']/$r['count'],1):null,'first_visit'=>$r['first_visit'],'latest_visit'=>$r['latest_visit']];
    }
    return $out;
}
function ko_site_score_summary(PDO $pdo,string|array $site): array {
    if(!ko_ready($pdo))return [];
    $ids=is_array($site)?array_values($site):[$site];$in=implode(',',array_fill(0,count($ids),'?'));
    $q=$pdo->prepare("SELECT o.details,r.visited_on FROM community_reviews r JOIN community_observations o ON o.review_id=r.id WHERE r.campsite_id IN ($in) AND r.status='published'");$q->execute($ids);
    $groups=(function()use($q){foreach($q as $r)yield ['values'=>ko_conditions(json_decode($r['details'],true)?:[]),'count'=>1,'latest_visit'=>$r['visited_on']];})();
    return ko_site_scores($groups);
}

// External media is metadata only. Never fetch or accept an arbitrary embed URL.
function ko_video_id($raw): string {
    if(!is_string($raw)||strlen($raw)>200)kc_error(422,'Use a YouTube video ID or canonical YouTube watch URL.');
    if($raw==='')return '';
    if(preg_match('/^[A-Za-z0-9_-]{11}$/D',$raw))return $raw;
    if(preg_match('~^https://(?:www\.)?youtube\.com/watch\?v=([A-Za-z0-9_-]{11})$~D',$raw,$m)||preg_match('~^https://youtu\.be/([A-Za-z0-9_-]{11})$~D',$raw,$m))return $m[1];
    kc_error(422,'Use a YouTube video ID or canonical YouTube watch URL.');
}
function ko_video(array $details): ?array {
    $id=$details['video_id']??null;
    return is_string($id)&&preg_match('/^[A-Za-z0-9_-]{11}$/D',$id)?['provider'=>'youtube','id'=>$id,'url'=>'https://www.youtube.com/watch?v='.$id]:null;
}
function ko_conditions(array $details): array {
    $out=[];
    foreach(KO_AXES as $axis=>$allowed)if(is_string($details[$axis]??null)&&in_array($details[$axis],$allowed,true))$out[$axis]=$details[$axis];
    $scores=[];$storedScores=is_array($details['scores']??null)?$details['scores']:[];
    foreach(KO_SCORE_AXES as $axis){$n=$storedScores[$axis]??null;if(is_int($n)&&$n>=1&&$n<=5)$scores[$axis]=$n;}
    if($scores){$out['scores']=$scores;if(in_array($details['season']??null,KO_SEASONS,true))$out['season']=$details['season'];}
    $signals=[];
    foreach(is_array($details['signals']??null)?$details['signals']:[] as $row){
        if(!is_array($row))continue;
        $carrier=$row['carrier']??null;$signal=$row['signal']??null;$environment=$row['environment']??'unspecified';$radio=array_key_exists('radio',$row)?$row['radio']:'unspecified';
        if(!in_array($carrier,KO_CARRIERS,true)||isset($signals[$carrier])||!in_array($signal,KO_SIGNAL,true)||!in_array($environment,KO_ENVIRONMENTS,true)||!in_array($radio,KO_RADIOS,true))continue;
        $signals[$carrier]=['carrier'=>$carrier,'signal'=>$signal,'environment'=>$environment];
        if($radio!=='unspecified')$signals[$carrier]['radio']=$radio;
    }
    if($signals){ksort($signals);$out['signals']=array_values($signals);}
    return $out;
}
// Monthly counts intentionally retain categorical fields only. Invalid known values
// are counted as invalid by ko_monthly_groups; unrelated metadata cannot fragment cohorts.
function ko_monthly_conditions(array $details): array {$out=[];foreach(KO_AXES as $axis=>$_)if(array_key_exists($axis,$details))$out[$axis]=$details[$axis];return $out;}
// Project before grouping: a media ID must never create an observation cohort.
function ko_discovery_groups(iterable $rows,int $maximum=10000): array {
    $groups=[];
    foreach($rows as $r){
        $decoded=json_decode($r['details'],true);$values=ko_conditions(is_array($decoded)?$decoded:[]);
        if(!$values)continue;
        $key=json_encode([$r['campsite_id'],$r['latest_visit'],$values],JSON_THROW_ON_ERROR);
        if(!isset($groups[$key])){
            if(count($groups)>=$maximum)throw new OverflowException('observation groups');
            $groups[$key]=['campsite_id'=>$r['campsite_id'],'values'=>$values,'count'=>0,'latest_visit'=>$r['latest_visit']];
        }
        $groups[$key]['count']+=(int)($r['samples']??1);
    }
    return array_values($groups);
}
// Includes actual content, not just second-resolution timestamps.
function kc_review_snapshot_hash(array $r,array $details,array $photos): string {
    $content=[];
    foreach(['id','campsite_id','campsite_name','display_name','rating','body','visited_on','rig','status','public_note','updated_at'] as $key)$content[$key]=(string)($r[$key]??'');
    return hash('sha256',json_encode([$content,$details,$photos],JSON_THROW_ON_ERROR));
}

function kc_review_hash(PDO $pdo,array $r): string {
    return kc_review_snapshot_hash($r,ko_read($pdo,(int)$r['id']),kc_photo_rows($pdo,(int)$r['id'],false));
}
