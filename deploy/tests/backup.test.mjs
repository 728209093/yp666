import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {encryptArchive, decryptArchive, sha256File, sqlLiteral, listArchive} from '../backup-tools.mjs';
import {dumpDatabase, retainBackups} from '../backup-project.mjs';

const openssl = process.env.OPENSSL_BIN || ['C:/Program Files/Git/usr/bin/openssl.exe','/usr/bin/openssl'].find(existsSync) || 'openssl';
const available = spawnSync(openssl,['version'],{windowsHide:true}).status === 0;

test('SQL snapshot values preserve JSON, Unicode and quote characters without relying on backslash modes', () => {
  const original = {message:"中文 ' \\ \u0000", nested:['a',true]};
  const result = sqlLiteral(original);
  const hex = result.match(/^CONVERT\(X'([a-f0-9]+)' USING utf8mb4\)$/)?.[1];
  assert.ok(hex);
  assert.deepEqual(JSON.parse(Buffer.from(hex,'hex').toString('utf8')), original);
  assert.equal(sqlLiteral(null), 'NULL');
  assert.equal(sqlLiteral(123n), '123');
  assert.equal(sqlLiteral(Buffer.from([0,255])), "X'00ff'");
  assert.throws(() => sqlLiteral(Infinity));
});

test('database export streams all project tables in a read-only snapshot and retains JSON values', async () => {
  const root = resolve(tmpdir()), folder = await mkdtemp(join(root,'yp666-backup-test-'));
  const tables = ['Site','Admin','AdminSession','Visitor','Visit','Challenge','Conversation','Message','MediaUpload'];
  const calls = [];
  const connection = {
    async query(sql) {
      calls.push(sql);
      if (sql === 'SHOW TABLES') return tables.map(name=>({name}));
      if (sql.startsWith('SHOW CREATE TABLE')) return [{'Create Table':'CREATE TABLE `'+sql.split('`')[1]+'` (`id` VARCHAR(32))'}];
      return [];
    },
    async *queryStream(sql) {if(sql === 'SELECT * FROM `Site`')yield {id:1,draft:{text:'中文'},published:{ok:true}};},
    async commit() {calls.push('COMMIT');},
    async rollback() {calls.push('ROLLBACK');},
  };
  try {
    const file=join(folder,'database.sql');
    const counts=await dumpDatabase(connection,file);
    assert.equal(counts.Site,1);assert.equal(Object.keys(counts).length,9);
    assert.ok(calls.includes('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY'));
    assert.equal(calls.at(-1),'COMMIT');
    const sql=await readFile(file,'utf8');
    assert.equal((sql.match(/CREATE TABLE/g)||[]).length,9);
    assert.ok(sql.includes(sqlLiteral({text:'中文'})));
    assert.ok(!calls.some(sql=>/^(?:CREATE|INSERT|UPDATE|DELETE|DROP|ALTER) /.test(sql)));
  } finally {assert.equal(dirname(folder),root);await rm(folder,{recursive:true,force:true});}
});

test('retention removes only this tool backup names and their checksum pairs', async () => {
  const root=resolve(tmpdir()),folder=await mkdtemp(join(root,'yp666-backup-test-'));
  const names=[1,2,3].map(day=>`yp666-backup-2026112${day}T031500Z-123456abcdef.cms`);
  try {
    for(const name of names){await writeFile(join(folder,name),'encrypted');await writeFile(join(folder,name+'.sha256'),'checksum');}
    const manual=join(folder,'manual-database.sql');await writeFile(manual,'fixture');
    await retainBackups(folder,2);
    assert.equal(existsSync(join(folder,names[0])),false);assert.equal(existsSync(join(folder,names[0]+'.sha256')),false);
    assert.equal(existsSync(join(folder,names[1])),true);assert.equal(existsSync(join(folder,names[2])),true);assert.equal(existsSync(manual),true);
  } finally {assert.equal(dirname(folder),root);await rm(folder,{recursive:true,force:true});}
});

test('standard CMS GCM backup decrypts correctly, is encrypted at rest, and rejects corruption', {skip:!available}, async () => {
  const root = resolve(tmpdir());
  const folder = await mkdtemp(join(root,'yp666-backup-test-'));
  try {
    const source = join(folder,'source'); await mkdir(join(source,'shared'),{recursive:true});
    const privateText = 'private-fixture-content-do-not-store-in-cleartext';
    await writeFile(join(source,'database.sql'), privateText);
    await writeFile(join(source,'metadata.json'), '{}');
    await writeFile(join(source,'shared','.env.local'), 'MYSQL_PASSWORD=fixture-only');
    const {privateKey} = generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
    const key = join(folder,'private.pem'), certificate = join(folder,'recipient.pem');
    await writeFile(key,privateKey,{mode:0o600});
    const req = spawnSync(openssl,['req','-x509','-new','-key',key,'-out',certificate,'-days','1','-subj','/CN=YP666 backup fixture'],{windowsHide:true,env:{...process.env,MSYS_NO_PATHCONV:'1'}});
    assert.equal(req.status,0);
    const input = join(folder,'backup.cms');
    await encryptArchive({directory:source,output:input,certificate,openssl});
    const structure = spawnSync(openssl,['cms','-cmsout','-print','-inform','DER','-in',input],{windowsHide:true,encoding:'utf8'});
    assert.equal(structure.status,0);
    assert.match(structure.stdout,/id-smime-ct-authEnvelopedData/);
    assert.match(structure.stdout,/aes-256-gcm/);
    assert.match(structure.stdout,/rsaesOaep/);
    const ciphertext = await readFile(input);
    assert.equal(ciphertext.includes(Buffer.from(privateText)), false);
    assert.match(await sha256File(input), /^[a-f0-9]{64}$/);
    const output = join(folder,'restored.tar.gz');
    await decryptArchive({input,output,certificate,key,openssl,interactive:false});
    const listing = await listArchive(output);
    assert.match(listing,/database\.sql/); assert.match(listing,/shared\/\.env\.local/);
    const extracted = spawnSync('tar',['-xOzf',output,'database.sql'],{windowsHide:true});
    assert.equal(extracted.status,0); assert.equal(extracted.stdout.toString(),privateText);
    ciphertext[ciphertext.length-12] ^= 1;
    const damaged = join(folder,'damaged.cms');await writeFile(damaged,ciphertext);
    await assert.rejects(decryptArchive({input:damaged,output:join(folder,'damaged.tar.gz'),certificate,key,openssl,interactive:false}));
    await assert.rejects(encryptArchive({directory:source,output:input,certificate,openssl}),{code:'EEXIST'});
  } finally {
    assert.equal(dirname(folder),root);
    await rm(folder,{recursive:true,force:true});
  }
});
