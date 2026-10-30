'use strict';
// CI only: a real mysqldump/restore in the disposable MySQL service, including binary payloads.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{execFileSync}=require('node:child_process');
test('MySQL backup independently restores reviews, photos, permissions, flags and audit history',()=>{
 const container=process.env.KT_MYSQL_CONTAINER;
 assert.ok(container,'Run this only against the disposable CI MySQL container.');
 const php=code=>execFileSync('php',['-r',code],{encoding:'utf8',maxBuffer:2*1024*1024});
 const conn=`$p=new PDO('mysql:host=127.0.0.1;port=3306;dbname=kamptrail_test;charset=utf8mb4','root','test-only',[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);`;
 const bootstrap=JSON.stringify(path.resolve(__dirname,'../api/_lib/bootstrap.php'));
 // Seed every asserted feature independently. The backup gate must also work before API tests,
 // after an API suite cleans up, or when another suite leaves no community rows behind.
 const fixture=JSON.parse(php(conn+`
 require ${bootstrap};kt_migrate($p);$now=gmdate('Y-m-d H:i:s');$nonce=bin2hex(random_bytes(16));
 $q=$p->prepare("INSERT INTO community_reviews (owner_hash,campsite_id,campsite_name,display_name,rating,body,visited_on,rig,status,created_at,updated_at) VALUES (?,?,?,?,4,?,'2020-01-01','','published',?,?)");
 $q->execute([hash('sha256',$nonce),'backup:'.$nonce,'Backup fixture campsite','Backup camper','Independent review fixture for the restore gate.',$now,$now]);$review=(int)$p->lastInsertId();
 $p->prepare('INSERT INTO community_observations (review_id,details) VALUES (?,?)')->execute([$review,'{"noise":"quiet"}']);
 $im=imagecreatetruecolor(16,16);ob_start();imagejpeg($im);$bytes=ob_get_clean();imagedestroy($im);
 $q=$p->prepare("INSERT INTO community_photos (review_id,image_data,byte_size,width,height,status,created_at) VALUES (?,?,?,16,16,'published',?)");
 $q->bindValue(1,$review,PDO::PARAM_INT);$q->bindValue(2,$bytes,PDO::PARAM_LOB);$q->bindValue(3,strlen($bytes),PDO::PARAM_INT);$q->bindValue(4,$now);$q->execute();$photo=(int)$p->lastInsertId();
 $p->prepare('UPDATE community_storage SET used_bytes=used_bytes+? WHERE id=1')->execute([strlen($bytes)]);
 // Deliberately non-UTF-8 bytes exercise binary-safe snapshot encoding, not just ASCII hashes.
 $owner=chr(255).random_bytes(31);
 $q=$p->prepare("INSERT INTO permission_reports (owner_hash,place_key,place_kind,place_id,place_name,lng,lat,activity,observation,visited_on,firsthand,display_name,body,authority_role,authority_office,status,version,public_note,created_at,updated_at) VALUES (?,'spot:40.00000,-110.00000','spot','spot:40.00000,-110.00000','Backup fixture spot',-110,40,'overnight_occupancy','granted_to_me','2020-01-01',1,'Backup camper','Independent permission report fixture for the restore gate.','Duty manager','Site office','published',2,'Reviewed for backup fixture',?,?)");
 $q->bindValue(1,$owner,PDO::PARAM_LOB);$q->bindValue(2,$now);$q->bindValue(3,$now);$q->execute();$report=(int)$p->lastInsertId();
 $p->prepare("INSERT INTO permission_flags (report_id,reason,status,version,created_at) VALUES (?,'Fixture flag preserved by backup','open',1,?)")->execute([$report,$now]);
 $q=$p->prepare('INSERT INTO permission_audit (report_id,action,from_status,to_status,report_version,actor,created_at) VALUES (?,?,?,?,?,?,?)');
 $q->execute([$report,'submit','','pending',1,'owner',$now]);$q->execute([$report,'moderate','pending','published',2,'moderator',$now]);
 $p->prepare("INSERT INTO permission_events (client_hash,kind,created_at) VALUES (?,'permission_submit',?)")->execute([hash('sha256','backup-client-'.$nonce),$now]);
 $p->exec('UPDATE permission_state SET revision=revision+1 WHERE id=1');
 echo json_encode(['review'=>$review,'photo'=>$photo,'report'=>$report,'owner_hex'=>bin2hex($owner),'photo_sha256'=>hash('sha256',$bytes)],JSON_THROW_ON_ERROR);
 `));
 const dump=execFileSync('docker',['exec',container,'mysqldump','-uroot','-ptest-only','--single-transaction','--hex-blob','--no-tablespaces','kamptrail_test'],{maxBuffer:4*1024*1024,stdio:['ignore','pipe','ignore']});
 execFileSync('docker',['exec',container,'mysql','-uroot','-ptest-only','-e','DROP DATABASE IF EXISTS kamptrail_restore; CREATE DATABASE kamptrail_restore CHARACTER SET utf8mb4'],{stdio:'ignore'});
 execFileSync('docker',['exec','-i',container,'mysql','-uroot','-ptest-only','kamptrail_restore'],{input:dump,stdio:['pipe','ignore','ignore']});
 const summary=php(conn+`$result=[];foreach(['kamptrail_test','kamptrail_restore'] as $db){$p->exec('USE '.$db);$tables=$p->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);sort($tables);$summary=[];foreach($tables as $table){$rows=$p->query('SELECT * FROM '.$table.' ORDER BY 1')->fetchAll(PDO::FETCH_ASSOC);foreach($rows as &$r){foreach(['image_data','owner_hash'] as $binary)if(isset($r[$binary]))$r[$binary]=base64_encode($r[$binary]);}unset($r);$summary[$table]=['count'=>count($rows),'hash'=>hash('sha256',json_encode($rows,JSON_THROW_ON_ERROR))];}$result[$db]=$summary;}echo json_encode($result,JSON_THROW_ON_ERROR);`);
 const d=JSON.parse(summary);assert.deepEqual(d.kamptrail_restore,d.kamptrail_test);
 for(const table of ['community_reviews','community_photos','community_observations','community_storage','permission_reports','permission_flags','permission_audit','permission_events','permission_state'])assert.ok(d.kamptrail_test[table]?.count>0,table+' contains restored rows');
 const restored=JSON.parse(php(conn+`$p->exec('USE kamptrail_restore');$q=$p->prepare('SELECT owner_hash,status,version FROM permission_reports WHERE id=?');$q->execute([${fixture.report}]);$r=$q->fetch(PDO::FETCH_ASSOC);$q=$p->prepare('SELECT image_data FROM community_photos WHERE id=?');$q->execute([${fixture.photo}]);echo json_encode(['owner_hex'=>bin2hex($r['owner_hash']),'status'=>$r['status'],'version'=>(int)$r['version'],'photo_sha256'=>hash('sha256',$q->fetchColumn())],JSON_THROW_ON_ERROR);`));
 assert.equal(restored.owner_hex,fixture.owner_hex);assert.equal(restored.owner_hex.length,64);assert.equal(restored.status,'published');assert.equal(restored.version,2);assert.equal(restored.photo_sha256,fixture.photo_sha256);
});
