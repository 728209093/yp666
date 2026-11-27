import {test} from 'node:test';
import assert from 'node:assert/strict';
import {adminBasePath, generateAdminBasePath, renderAdminRoute} from '../admin-path.mjs';

test('private administrator paths are generated independently with enough random bytes', () => {
  const first = generateAdminBasePath(), second = generateAdminBasePath();
  assert.match(first, /^\/manage-[0-9a-f]{32}\/$/);
  assert.notEqual(first, second);
  assert.equal(adminBasePath(first, {requirePrivate: true}), first);
});

test('path validation rejects nginx injection, reserved endpoints and incomplete paths', () => {
  assert.equal(adminBasePath(), '/admin/');
  assert.equal(adminBasePath('/manage-example42/', {requirePrivate: true}), '/manage-example42/');
  for (const value of ['/', 'admin', '/admin', '//admin/', '/secret/child/', '/secret?query/', '/secret#hash/', '/secret./', '/secret%2f/', '/secret;evil/', '/secret\n/', '/api/', '/uploads/', '/assets/', '/API/']) {
    assert.throws(() => adminBasePath(value));
  }
  for (const value of [undefined, '', '/admin/', '/ADMIN/', '/short/']) assert.throws(() => adminBasePath(value, {requirePrivate: true}));
});

test('nginx snippet serves the configured base and blocks both spellings of retired paths', () => {
  const config = renderAdminRoute('/manage-new-example/', ['/manage-old-example/', '/admin/']);
  assert.match(config, /location = \/manage-new-example \{/);
  assert.match(config, /return 301 \/manage-new-example\//);
  assert.match(config, /location \/manage-new-example\/ \{/);
  assert.match(config, /try_files \$uri \$uri\/ \/manage-new-example\/index\.html;/);
  for (const path of ['admin', 'manage-old-example']) {
    assert.ok(config.includes(`location = /${path} { return 404; }`));
    assert.ok(config.includes(`location ^~ /${path}/ { return 404; }`));
  }
  assert.equal(config.match(/location = \/admin \{/g)?.length, 1);
  assert.match(config, /no-store/);
  assert.match(config, /no-referrer/);
  assert.match(config, /noindex, nofollow, noarchive/);
  assert.match(config, /include \/etc\/nginx\/snippets\/yp666-security-headers\.conf;/);
  assert.throws(() => renderAdminRoute('/admin/'));
});
