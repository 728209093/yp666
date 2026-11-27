import {resolve, join} from 'node:path';
import {mkdir, lstat, readFile, writeFile, rm, chmod} from 'node:fs/promises';
import {decryptArchive, listArchive, sha256File} from './backup-tools.mjs';

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i=0; i<args.length; i+=2) {
    if (!['--input','--output','--certificate','--key','--checksum'].includes(args[i]) || !args[i+1] || Object.hasOwn(options,args[i])) throw new Error('Invalid arguments');
    options[args[i]] = args[i+1];
  }
  for (const key of ['--input','--output','--certificate','--key']) if (!options[key]) throw new Error('Use --input file.cms --output NEW_PRIVATE_DIRECTORY --certificate recipient.pem --key private.pem [--checksum file.cms.sha256]');
  const input = resolve(options['--input']), directory = resolve(options['--output']);
  if (await lstat(directory).catch(() => null)) throw new Error('Recovery output must be a new directory');
  const checksum = resolve(options['--checksum'] || input+'.sha256');
  const expected = (await readFile(checksum,'utf8')).trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/i.test(expected) || await sha256File(input) !== expected.toLowerCase()) throw new Error('Encrypted backup checksum mismatch');
  process.umask(0o077);
  await mkdir(directory, {mode:0o700}); await chmod(directory,0o700);
  const archive = join(directory,'project.tar.gz');
  try {
    await decryptArchive({input, output:archive, certificate:resolve(options['--certificate']), key:resolve(options['--key']), openssl:process.env.OPENSSL_BIN || 'openssl'});
    const listing = await listArchive(archive, process.env.TAR_BIN || 'tar');
    await writeFile(join(directory,'archive-contents.txt'), listing, {mode:0o600,flag:'wx'});
    console.log('Backup authenticated, decrypted, and contents listed in the new private directory. No files were extracted and no database was modified.');
  } catch (error) {await rm(archive, {force:true}); throw error;}
}

main().catch(error => {console.error(`Backup recovery inspection failed: ${error.message}`); process.exitCode=1;});
