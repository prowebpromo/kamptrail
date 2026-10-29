<?php
// No upload paths or original bytes are exposed. Only decoded/re-encoded JPEG data is served.
declare(strict_types=1);
require __DIR__ . '/_lib/community.php';
kt_require_method('GET');$pdo=kc_db();
try {
    $id=(int)($_GET['id']??0);
    $q=$pdo->prepare('SELECT p.image_data,p.status,r.status AS review_status FROM community_photos p JOIN community_reviews r ON r.id=p.review_id WHERE p.id=?');$q->execute([$id]);$p=$q->fetch();
    $allowed=$p && $p['status']==='published' && $p['review_status']==='published';
    if (!$allowed && isset($_GET['preview']) && !empty($_COOKIE['kt_mod'])) {
        session_name('kt_mod');session_start(['read_and_close'=>true]);$allowed=$p && !empty($_SESSION['moderator']) && $p['status']!=='deleted' && $p['review_status']!=='deleted';
    }
    if (!$allowed || empty($p['image_data'])) kc_error(404,'Photo not found.');
    kt_headers('image/jpeg');header("Content-Security-Policy: sandbox; default-src 'none'");header('Cross-Origin-Resource-Policy: same-origin');header('Content-Disposition: inline; filename="camp-photo.jpg"');
    echo is_resource($p['image_data'])?stream_get_contents($p['image_data']):$p['image_data'];
} catch (Throwable $e) {error_log('KampTrail community: photo lookup failed');kt_unavailable();}
