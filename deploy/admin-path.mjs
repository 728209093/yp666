import {randomBytes} from 'node:crypto';

const reserved = new Set(['api', 'assets', 'uploads', '.well-known']);

export function adminBasePath(value, {requirePrivate = false} = {}) {
  const path = value === undefined || value === '' ? '/admin/' : value;
  if (typeof path !== 'string' || !/^\/[A-Za-z0-9][A-Za-z0-9_-]{0,79}\/$/.test(path)) {
    throw new Error('ADMIN_BASE_PATH 必须是以 / 开头和结尾的单层路径，仅可包含英文字母、数字、下划线和连字符');
  }
  const segment = path.slice(1, -1).toLowerCase();
  if (reserved.has(segment) || (requirePrivate && (segment === 'admin' || segment.length < 8))) {
    throw new Error('ADMIN_BASE_PATH 不能使用公共接口、资源路径或默认后台路径；正式入口至少需要 8 个字符');
  }
  return path;
}

export function generateAdminBasePath() {
  return `/manage-${randomBytes(16).toString('hex')}/`;
}

export function renderAdminRoute(value, previousPaths = ['/admin/']) {
  const path = adminBasePath(value, {requirePrivate: true});
  const previous = [...new Set(['/admin/', ...previousPaths].map(value => adminBasePath(value)))].filter(value => value !== path);
  const deny = previous.map(value => `    location = ${value.slice(0, -1)} { return 404; }\n    location ^~ ${value} { return 404; }`).join('\n');
  return `# Generated from ADMIN_BASE_PATH. Keep the configured path out of the public repository.
${deny}

    location = ${path.slice(0, -1)} {
        return 301 ${path};
    }

    location ${path} {
        alias /opt/yp666/current/apps/admin/dist/;
        index index.html;
        try_files $uri $uri/ ${path}index.html;
        add_header Cache-Control "no-store" always;
        add_header Referrer-Policy "no-referrer" always;
        add_header X-Robots-Tag "noindex, nofollow, noarchive" always;
        add_header X-Content-Type-Options nosniff always;
        add_header X-Frame-Options SAMEORIGIN always;
        include /etc/nginx/snippets/yp666-security-headers.conf;
    }
`;
}
