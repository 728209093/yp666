import DOMPurify from 'dompurify';
import {richTextFontFamilies, richTextFontSizes} from '@yp666/shared';

export function safeRichText(value: string): string {
  const clean = DOMPurify.sanitize(value, {
    ALLOWED_TAGS: ['p', 'div', 'br', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'ul', 'ol', 'li', 'a', 'font', 'blockquote', 'code'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'style', 'color', 'face', 'size'],
    ALLOW_DATA_ATTR: false,
  });
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  for (const font of doc.body.querySelectorAll('font')) {
    const span = doc.createElement('span');
    span.style.cssText = font.getAttribute('style') || '';
    if (font.getAttribute('color')) span.style.color = font.getAttribute('color')!;
    if (font.getAttribute('face')) span.style.fontFamily = font.getAttribute('face')!;
    const size = ({'1':12,'2':14,'3':16,'4':18,'5':24,'6':32,'7':36} as Record<string, number>)[font.getAttribute('size') || ''];
    if (size) span.style.fontSize = `${size}px`;
    span.replaceChildren(...font.childNodes); font.replaceWith(span);
  }
  for (const element of doc.body.querySelectorAll<HTMLElement>('*')) {
    const color = element.style.color;
    const background = element.style.backgroundColor;
    const size = element.style.fontSize;
    const family = element.style.fontFamily.replace(/^["']|["']$/g, '');
    const align = element.style.textAlign;
    element.removeAttribute('style');
    if (color && /^(#[a-f\d]{3,8}|rgba?\([\d\s,.%]+\)|[a-z]+)$/i.test(color)) element.style.color = color;
    if (background && /^(#[a-f\d]{3,8}|rgba?\([\d\s,.%]+\)|[a-z]+)$/i.test(background)) element.style.backgroundColor = background;
    if (richTextFontSizes.some(value => size === `${value}px`)) element.style.fontSize = size;
    if (richTextFontFamilies.some(value => value.toLowerCase() === family.toLowerCase())) element.style.fontFamily = family;
    if (['left', 'center', 'right'].includes(align)) element.style.textAlign = align;
    for (const attribute of ['color', 'face', 'size']) element.removeAttribute(attribute);
    if (element.tagName === 'A') {
      if (!/^https?:\/\//i.test(element.getAttribute('href') || '')) element.removeAttribute('href');
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noopener noreferrer');
    }
  }
  return doc.body.innerHTML;
}

export function plainToRichText(value: string): string {
  const element = document.createElement('div');
  element.textContent = value;
  return element.innerHTML.replace(/\r?\n/g, '<br>');
}

export function richTextPlain(value: string): string {
  const element = document.createElement('div');
  element.innerHTML = safeRichText(value);
  return (element.textContent || '').replace(/\u00a0/g, ' ').trim();
}
