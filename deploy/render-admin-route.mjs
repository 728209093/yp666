import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {adminBasePath, generateAdminBasePath, renderAdminRoute} from './admin-path.mjs';

const {values} = parseArgs({options: {
  generate: {type: 'boolean'}, check: {type: 'boolean'},
  output: {type: 'string'}, 'previous-path': {type: 'string', multiple: true},
}});

if (values.generate) {
  if (values.output || values.check || values['previous-path']) throw new Error('--generate 不能与其他选项一起使用');
  process.stdout.write(generateAdminBasePath() + '\n');
} else {
  const {default: dotenv} = await import('dotenv');
  const root = fileURLToPath(new URL('../', import.meta.url));
  dotenv.config({path: resolve(root, '.env.local'), quiet: true});
  dotenv.config({path: resolve(root, '.env'), quiet: true});
  const path = adminBasePath(process.env.ADMIN_BASE_PATH, {requirePrivate: true});
  if (values.check) {
    if (values.output) throw new Error('--check 不写入配置文件');
    process.stdout.write('ADMIN_BASE_PATH 格式有效\n');
  } else {
    const config = renderAdminRoute(path, values['previous-path']);
    if (values.output) await writeFile(resolve(values.output), config, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
    else process.stdout.write(config);
  }
}
