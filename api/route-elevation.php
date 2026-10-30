<?php
declare(strict_types=1);
require_once __DIR__ . '/_lib/route-elevation.php';
$raw=file_get_contents('php://input',false,null,0,KRE_BODY_MAX+1);
[$status,$body]=kre_dispatch($_SERVER,$_GET,is_string($raw)?$raw:'',kre_directory(),'kre_http',time());
if($status===405)header('Allow: POST');
if($status===429||$status===503)header('Retry-After: 60');
kt_json($status,$body);
