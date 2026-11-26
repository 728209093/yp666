import { siteDocumentSchema, type SiteDocument } from '@yp666/shared';
import { cleanRichText } from './chat-content.js';
import { parse } from './security.js';

export function normalizeSiteDocument(value: unknown): SiteDocument {
  const document = parse(siteDocumentSchema, value);
  for (const block of document.blocks) {
    if (block.contentFormat === 'richtext') block.content = cleanRichText(block.content);
  }
  return document;
}
