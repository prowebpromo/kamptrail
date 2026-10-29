'use strict';
// CI only: a real mysqldump/restore in the disposable MySQL service, including encoded photo bytes.
const test=require('node:test'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
test('MySQL backup restores reviews, photo bytes, moderation states and storage accounting',()=>{
 const container=process.env.KT_MYSQL_CONTAINER;
 assert.ok(container,'Run this only against the disposable CI MySQL container.');
 const php=code=>execFileSync('php',['-r',code],{encoding:'utf8',maxBuffer:2*1024*1024});
 const conn=`$p=new PDO('mysql:host=127.0.0.1;port=3306;dbname=kamptrail_test;charset=utf8mb4','root','test-only',[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);`;
 // Keep a real photo in the snapshot. API behavior is covered separately by community.test.js.
 php(conn+`$id=$p->query('SELECT id FROM community_reviews ORDER BY id LIMIT 1')->fetchColumn();$im=imagecreatetruecolor(16,16);ob_start();imagejpeg($im);$bytes=ob_get_clean();$q=$p->prepare("INSERT INTO community_photos (review_id,image_data,byte_size,width,height,status,created_at) VALUES (?,?,?,16,16,'published',?)");$q->bindValue(1,$id);$q->bindValue(2,$bytes,PDO::PARAM_LOB);$q->bindValue(3,strlen($bytes));$q->bindValue(4,gmdate('Y-m-d H:i:s'));$q->execute();$p->exec("UPDATE community_reviews SET status='published' WHERE id=".(int)$id);$p->exec('UPDATE community_storage SET used_bytes=used_bytes+'.strlen($bytes).' WHERE id=1');`);
 const dump=execFileSync('docker',['exec',container,'mysqldump','-uroot','-ptest-only','--single-transaction','--hex-blob','--no-tablespaces','kamptrail_test'],{maxBuffer:4*1024*1024,stdio:['ignore','pipe','ignore']});
 execFileSync('docker',['exec',container,'mysql','-uroot','-ptest-only','-e','CREATE DATABASE kamptrail_restore CHARACTER SET utf8mb4'],{stdio:'ignore'});
 execFileSync('docker',['exec','-i',container,'mysql','-uroot','-ptest-only','kamptrail_restore'],{input:dump,stdio:['pipe','ignore','ignore']});
 const summary=php(conn+`$result=[];foreach(['kamptrail_test','kamptrail_restore'] as $db){$p->exec('USE '.$db);$tables=$p->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);sort($tables);$summary=[];foreach($tables as $table){$rows=$p->query('SELECT * FROM '.$table.' ORDER BY 1')->fetchAll(PDO::FETCH_ASSOC);foreach($rows as &$r)if(isset($r['image_data']))$r['image_data']=base64_encode($r['image_data']);unset($r);$summary[$table]=['count'=>count($rows),'hash'=>hash('sha256',json_encode($rows,JSON_THROW_ON_ERROR))];}$result[$db]=$summary;}echo json_encode($result,JSON_THROW_ON_ERROR);`);
 const d=JSON.parse(summary);assert.deepEqual(d.kamptrail_restore,d.kamptrail_test);assert.ok(d.kamptrail_test.community_photos.count>0);
});
