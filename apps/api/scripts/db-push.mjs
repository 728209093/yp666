import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import mariadb from 'mariadb';
import { databaseOptions, databaseUrl } from './config.mjs';

const require = createRequire(import.meta.url);
process.env.DATABASE_URL ||= databaseUrl();
const diff = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/schema.prisma', '--script'], {encoding: 'utf8', env: process.env});
if (diff.status !== 0) {
  process.stderr.write(diff.stderr || '无法生成数据库结构\n');
  process.exit(1);
}
const connection = await mariadb.createConnection(databaseOptions());
try {
  const tables = await connection.query('SHOW TABLES');
  if (tables.length) {
    const required = ['Site','Admin','AdminSession','Visitor','Visit','Challenge','Conversation','Message','MediaUpload'];
    const names = new Set(tables.map(row => Object.values(row)[0]));
    if (required.every(name => names.has(name))) {
      const columns = await connection.query('SHOW COLUMNS FROM `Message`');
      const fieldNames = new Set(columns.map(row => row.Field));
      if (!['type','mediaUrl','fileName'].every(name => fieldNames.has(name))) {
        throw new Error('项目数据库需要执行经过审核的聊天媒体迁移；初始化命令不会改动已有结构。');
      }
      console.log('项目数据表已经存在，保留现有数据；后续结构更新请使用审核过的迁移。');
    } else {
      throw new Error('数据库中已有其它表或不完整的项目结构，已停止。旧版项目请执行 deploy/migrations 中经过审核的迁移；此命令只初始化空库，不会重置或删除数据。');
    }
  } else {
    const statements = diff.stdout.split(';').map(s => s.trim()).filter(Boolean);
    for (const sql of statements) await connection.query(sql);
    console.log('项目数据库结构初始化完成，未修改其它数据库。');
  }
} finally {
  await connection.end();
}
