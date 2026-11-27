import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {mkdir, mkdtemp, chmod, open, readFile, writeFile, cp, rm, rename, readdir, lstat} from 'node:fs/promises';
import {encryptArchive, sha256File, sqlLiteral} from './backup-tools.mjs';
import {databaseOptions} from '../apps/api/scripts/config.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const tables = ['Site','Admin','AdminSession','Visitor','Visit','Challenge','Conversation','Message','MediaUpload'];
const backupName = /^yp666-backup-\d{8}T\d{6}Z-[a-f0-9]{12}\.cms$/;

export async function dumpDatabase(connection, output) {
  const file = await open(output, 'wx', 0o600);
  const counts = {};
  let transaction = false;
  try {
    const existing = await connection.query('SHOW TABLES');
    const names = existing.map(row => Object.values(row)[0]);
    if (names.length !== tables.length || !tables.every(table => names.includes(table))) throw new Error('Project table set changed; review backup coverage before proceeding');
    await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    transaction = true;
    await file.write('-- YP666 consistent database snapshot. Restore into an empty, reviewed database only.\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n');
    for (const table of tables) {
      const [definition] = await connection.query(`SHOW CREATE TABLE \`${table}\``);
      await file.write(definition['Create Table'] + ';\n');
      let count = 0;
      for await (const row of connection.queryStream(`SELECT * FROM \`${table}\``)) {
        const fields = Object.keys(row);
        await file.write(`INSERT INTO \`${table}\` (${fields.map(field => '`'+field.replaceAll('`','``')+'`').join(',')}) VALUES (${fields.map(field => sqlLiteral(row[field])).join(',')});\n`);
        count++;
      }
      counts[table] = count;
    }
    await connection.commit(); transaction = false;
    await file.write('SET FOREIGN_KEY_CHECKS=1;\n');
    await file.sync();
    return counts;
  } finally {
    if (transaction) await connection.rollback().catch(() => {});
    await file.close();
  }
}

export async function retainBackups(directory, keep) {
  const names = [];
  for (const name of await readdir(directory)) if (backupName.test(name) && (await lstat(join(directory,name))).isFile()) names.push(name);
  names.sort().reverse();
  for (const name of names.slice(keep)) {
    await rm(join(directory,name), {force:true});
    const checksum = join(directory,name+'.sha256');
    if ((await lstat(checksum).catch(() => null))?.isFile()) await rm(checksum);
  }
}

export async function backupProject() {
  process.umask(0o077);
  const shared = resolve(process.env.BACKUP_SHARED_DIR || '/opt/yp666/shared');
  const directory = resolve(process.env.BACKUP_OUTPUT_DIR || '/opt/yp666/backups/encrypted');
  const certificate = resolve(process.env.BACKUP_RECIPIENT_CERT || '/etc/yp666/backup-recipient.pem');
  const keep = Number(process.env.BACKUP_RETENTION_COUNT || 30);
  if (!Number.isInteger(keep) || keep < 2 || keep > 365) throw new Error('BACKUP_RETENTION_COUNT must be an integer from 2 to 365');
  if (!(await lstat(certificate)).isFile()) throw new Error('Backup recipient certificate must be a regular file');
  const outputRelative = relative(shared, directory);
  if (!outputRelative || (!isAbsolute(outputRelative) && outputRelative !== '..' && !outputRelative.startsWith('..'+sep))) throw new Error('Backup output cannot be inside the shared source directory');
  await mkdir(directory, {recursive:true,mode:0o700});
  if (!(await lstat(directory)).isDirectory() || (await lstat(directory)).isSymbolicLink()) throw new Error('Backup output must be a real directory');
  await chmod(directory, 0o700);
  const temporaryRoot = resolve(tmpdir());
  const temporary = await mkdtemp(join(temporaryRoot, 'yp666-backup-'));
  await chmod(temporary, 0o700);
  const stamp = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  const name = `yp666-backup-${stamp}-${randomBytes(6).toString('hex')}.cms`;
  const partial = join(directory, name+'.partial');
  let connection;
  try {
    connection = await require('mariadb').createConnection({...databaseOptions(),dateStrings:true});
    const counts = await dumpDatabase(connection, join(temporary,'database.sql'));
    await connection.end(); connection = undefined;
    const snapshot = join(temporary,'shared');
    await mkdir(snapshot, {mode:0o700});
    // Uploads use immutable UUID names and are written before their database rows.
    // Copying after the DB snapshot includes every referenced file in that snapshot.
    for (const name of ['.env.local','certs','data']) await cp(join(shared,name), join(snapshot,name), {
      recursive:true,dereference:false,errorOnExist:true,force:false,
      filter: async source => {
        if ((await lstat(source)).isSymbolicLink()) throw new Error('Shared backup source contains a symlink; review before backup');
        return true;
      },
    });
    const revision = (await readFile(join(projectRoot,'REVISION'),'utf8').catch(() => 'unreleased')).trim();
    await writeFile(join(temporary,'metadata.json'), JSON.stringify({format:'yp666-cms-backup-v1',createdAt:new Date().toISOString(),revision,tables:counts,encryption:'CMS AuthEnvelopedData AES-256-GCM; RSA-OAEP SHA-256'},null,2), {mode:0o600,flag:'wx'});
    await encryptArchive({directory:temporary, output:partial, certificate, openssl:process.env.OPENSSL_BIN || 'openssl', tar:process.env.TAR_BIN || 'tar'});
    const digest = await sha256File(partial);
    await rename(partial, join(directory,name));
    await writeFile(join(directory,name+'.sha256'), `${digest}  ${name}\n`, {mode:0o600,flag:'wx'});
    await retainBackups(directory, keep);
    console.log(`Encrypted project backup completed: ${name}`);
    return join(directory,name);
  } finally {
    await connection?.end().catch(() => {});
    await rm(partial, {force:true});
    if (dirname(temporary) !== temporaryRoot || !basename(temporary).startsWith('yp666-backup-')) throw new Error('Unsafe temporary cleanup target');
    await rm(temporary, {recursive:true,force:true});
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  backupProject().catch(error => {console.error(`Project backup failed (${error.code || error.name || 'ERROR'}).`); process.exitCode=1;});
}
