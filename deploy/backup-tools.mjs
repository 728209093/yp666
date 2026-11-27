import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {open, chmod} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';

export function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite database value');
    return String(value);
  }
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Hex literals are independent of NO_BACKSLASH_ESCAPES and preserve Unicode/JSON.
  return `CONVERT(X'${Buffer.from(text, 'utf8').toString('hex')}' USING utf8mb4)`;
}

function completed(child) {
  return new Promise((resolve, reject) => {
    let errorText = '';
    child.stderr?.on('data', data => {if (errorText.length < 4096) errorText += data.toString();});
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(Object.assign(new Error('Backup tool failed'), {code:'BACKUP_TOOL_FAILED'})));
  });
}

export async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function encryptArchive({directory, output, certificate, openssl = 'openssl', tar = 'tar'}) {
  const file = await open(output, 'wx', 0o600);
  const archive = spawn(tar, ['--format=ustar', '-czf', '-', '-C', directory, 'database.sql', 'metadata.json', 'shared'], {stdio:['ignore','pipe','pipe'], windowsHide:true});
  const encrypt = spawn(openssl, ['cms','-encrypt','-binary','-aes-256-gcm','-stream','-outform','DER','-recip',certificate,'-keyopt','rsa_padding_mode:oaep','-keyopt','rsa_oaep_md:sha256'], {stdio:['pipe',file.fd,'pipe'], windowsHide:true});
  try {
    await Promise.all([completed(archive), completed(encrypt), pipeline(archive.stdout, encrypt.stdin)]);
    await file.sync();
  } catch (error) {
    archive.kill(); encrypt.kill(); throw error;
  } finally {await file.close();}
  await chmod(output, 0o600);
}

export async function decryptArchive({input, output, certificate, key, openssl = 'openssl', interactive = true}) {
  const file = await open(output, 'wx', 0o600);
  const decrypt = spawn(openssl, ['cms','-decrypt','-binary','-inform','DER','-in',input,'-recip',certificate,'-inkey',key], {stdio:[interactive?'inherit':'ignore',file.fd,interactive?'inherit':'pipe'], windowsHide:true});
  try {await completed(decrypt); await file.sync();}
  finally {await file.close();}
  await chmod(output, 0o600);
}

export async function listArchive(input, tar = 'tar') {
  const child = spawn(tar, ['-tzf',input], {stdio:['ignore','pipe','pipe'], windowsHide:true});
  let listing = '';
  const read = (async () => {
    for await (const chunk of child.stdout) {
      listing += chunk.toString();
      if (listing.length > 8 * 1024 * 1024) {child.kill(); throw new Error('Archive listing is too large');}
    }
  })();
  await Promise.all([completed(child), read]);
  const paths = listing.split(/\r?\n/).filter(Boolean);
  if (!paths.includes('database.sql') || !paths.includes('metadata.json')) throw new Error('Backup manifest or database dump missing');
  for (const path of paths) {
    if (/^[\\/]|[:\u0000-\u001f]/.test(path) || path.includes('\\') || path.split('/').includes('..') || !/^(?:database\.sql|metadata\.json|shared(?:\/|$))/.test(path)) throw new Error('Unexpected archive entry');
  }
  return listing;
}
