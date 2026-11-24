import DOMPurify from 'dompurify';

export function safeRichText(value: string): string {
  const clean = DOMPurify.sanitize(value, {
    ALLOWED_TAGS: ['p', 'div', 'br', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'ul', 'ol', 'li', 'a'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'style'],
    ALLOW_DATA_ATTR: false,
  });
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  for (const element of doc.body.querySelectorAll<HTMLElement>('*')) {
    const color = element.style.color;
    element.removeAttribute('style');
    if (color && /^(#[a-f\d]{3,8}|rgba?\([\d\s,.%]+\)|[a-z]+)$/i.test(color)) element.style.color = color;
    if (element.tagName === 'A') {
      if (!/^https?:\/\//i.test(element.getAttribute('href') || '')) element.removeAttribute('href');
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noopener noreferrer');
    }
  }
  return doc.body.innerHTML;
}

export function richTextPlain(value: string): string {
  const element = document.createElement('div');
  element.innerHTML = safeRichText(value);
  return (element.textContent || '').replace(/\u00a0/g, ' ').trim();
}
