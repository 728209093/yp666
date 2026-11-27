import { z } from 'zod';

export const richTextFontSizes = [12, 14, 16, 18, 20, 24, 28, 32, 36] as const;
export const richTextFontFamilies = ['Arial', 'Georgia', 'Times New Roman', 'Microsoft YaHei', 'sans-serif', 'serif'] as const;

const safeUrl = z.string().max(2000).refine(value => !value || /^https?:\/\//i.test(value) || /^\/(?:assets|uploads)\/[\w./-]+$/.test(value), '请输入 http(s) 链接或本站资源路径');
export const settingsSchema = z.object({
  brandName: z.string().trim().min(1).max(30),
  serviceNameFontSize: z.number().int().min(12).max(18).default(14),
  title: z.string().trim().min(1).max(60),
  subtitle: z.string().max(160),
  avatarUrl: safeUrl,
  backgroundUrl: safeUrl,
  verificationBackgroundUrl: safeUrl.default(''),
  chatBackgroundUrl: safeUrl.default(''),
  pageTitle: z.string().trim().min(1).max(80).default('在线客服'),
  faviconUrl: safeUrl.default(''),
  avatarShape: z.enum(['circle', 'rounded', 'square']).default('rounded'),
  loadingText: z.string().trim().min(1).max(80).default('正在加载，请稍候…'),
  notificationSound: z.boolean().default(true),
  announcement: z.string().max(240),
  announcementSpeed: z.number().int().min(10).max(120).default(24),
  primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  introTitle: z.string().max(80),
  introText: z.string().max(2000),
  welcomeMessage: z.string().max(1000),
  verificationEnabled: z.boolean(),
  verificationTtlMinutes: z.number().int().min(5).max(1440),
  contactHint: z.string().max(160),
});
export const blockSchema = z.object({
  id: z.string().min(1).max(80),
  type: z.enum(['text', 'image', 'video', 'link']),
  title: z.string().max(100),
  content: z.string().max(20000),
  contentFormat: z.enum(['plain', 'richtext']).default('plain'),
  imageUrl: safeUrl,
  videoUrl: safeUrl.default(''),
  buttonText: z.string().max(40),
  url: safeUrl,
  enabled: z.boolean(),
  sortOrder: z.number().int().min(0).max(10000),
}).superRefine((block, context) => {
  if (block.contentFormat === 'plain' && block.content.length > 4000) context.addIssue({code: 'custom', path: ['content'], message: '正文内容最多 4000 个字符'});
});
export const faqSchema = z.object({
  id: z.string().min(1).max(80),
  question: z.string().trim().min(1).max(160),
  answer: z.string().trim().min(1).max(2000),
  enabled: z.boolean(),
});
export const siteDocumentSchema = z.object({settings: settingsSchema, blocks: z.array(blockSchema).max(100), faqs: z.array(faqSchema).max(30)});
export type SiteSettings = z.infer<typeof settingsSchema>;
export type ContentBlock = z.infer<typeof blockSchema>;
export type FaqItem = z.infer<typeof faqSchema>;
export type SiteDocument = z.infer<typeof siteDocumentSchema>;
export interface BootstrapResponse {
  site: Pick<SiteSettings, 'brandName' | 'serviceNameFontSize' | 'title' | 'subtitle' | 'avatarUrl' | 'primaryColor' | 'verificationEnabled' | 'verificationBackgroundUrl' | 'pageTitle' | 'faviconUrl' | 'loadingText' | 'avatarShape'>;
  verificationRequired: boolean;
  verified: boolean;
  captchaProvider: 'local' | 'slider' | 'turnstile';
  turnstileSiteKey?: string;
}
export interface SliderChallenge {id: string; kind: 'slider'; background: string; piece: string; width: number; height: number; pieceSize: number; pieceY: number; expiresAt: string}
export interface VerificationResponse {verified: boolean; expiresAt: string}
export type MessageType = 'text' | 'richtext' | 'image' | 'video';
export interface SendMessageInput {content?: string; type?: MessageType; mediaUrl?: string; fileName?: string}
export interface UploadResponse {url: string; type: 'image' | 'video'; fileName: string}
export interface ChatMessage {id: string; role: 'visitor' | 'assistant' | 'admin'; content: string; type: MessageType; mediaUrl?: string; fileName?: string; createdAt: string}
export interface AdminContentResponse {draft: SiteDocument; published: SiteDocument; publishedAt: string | null}
export interface ConversationSummary {id: string; visitorLabel: string; lastMessage: string; unreadCount: number; updatedAt: string; createdAt: string}
export interface ConversationDetail {conversation: ConversationSummary; messages: ChatMessage[]}
export interface DashboardStats {visitsToday: number; verifiedToday: number; totalConversations: number; unreadConversations: number; recentVisits: {date: string; visits: number; verified: number}[]}
export type VisitDeviceType = 'mobile' | 'tablet' | 'desktop' | 'unknown';
export interface VisitDetail {
  id: string;
  visitorId: string;
  date: string;
  verified: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  ipAddress: string | null;
  deviceType: VisitDeviceType;
  browser: string | null;
  os: string | null;
  userAgent: string | null;
  referrer: string | null;
}
export interface VisitListResponse {items: VisitDetail[]; total: number; page: number; pageSize: number; totalPages: number}
export const defaultDocument: SiteDocument = {
  settings: {
    brandName: '青屿', serviceNameFontSize: 14, title: '让每一次相遇，都更近一点。', subtitle: '一个安静、真诚的在线会客厅。\n关于我们的服务，你想了解的，都可以在这里聊聊。',
    avatarUrl: '/assets/avatar.svg', backgroundUrl: '', announcement: '欢迎来到青屿。请认准本站信息，我们不会索取你的验证码或账户密码。', primaryColor: '#547861',
    verificationBackgroundUrl: '', chatBackgroundUrl: '', pageTitle: '在线客服', faviconUrl: '', avatarShape: 'rounded', loadingText: '正在加载，请稍候…', notificationSound: true, announcementSpeed: 24,
    introTitle: '很高兴，在这里遇见你', introText: '把想了解的事，慢慢说给我们听。\n服务介绍、使用帮助，或只是一个小小的疑问，我们都在这里。',
    welcomeMessage: '你好，欢迎来到青屿 🌿\n我是你的服务助手。你可以先看看下面的介绍，也可以直接留言，我们会认真回复。', verificationEnabled: true, verificationTtlMinutes: 60,
    contactHint: '发送你的问题，开启一段轻松的对话',
  },
  blocks: [
    {id: 'welcome', type: 'text', title: '从一个简单的问候开始', content: '我们相信，好的服务始于倾听。\n在这里了解最新资讯、查看服务介绍，或者直接把问题留给我们。', contentFormat: 'plain', imageUrl: '', videoUrl: '', buttonText: '', url: '', enabled: true, sortOrder: 0},
    {id: 'discover', type: 'image', title: '留一点时间，给美好发生', content: '慢一点，也能遇见生活里的小惊喜。', contentFormat: 'plain', imageUrl: '/assets/landscape.svg', videoUrl: '', buttonText: '', url: '', enabled: true, sortOrder: 1},
    {id: 'guide', type: 'text', title: '开始之前，你可能想知道', content: '01  浏览下方的常见问题，快速找到答案\n02  在输入框里写下你的问题\n03  发送后保留当前页面，等待回复', contentFormat: 'plain', imageUrl: '', videoUrl: '', buttonText: '', url: '', enabled: true, sortOrder: 2},
  ],
  faqs: [
    {id: 'services', question: '这里可以了解哪些服务？', answer: '你可以在这里查看服务介绍、最新资讯和使用帮助。如果有具体需求，直接留言告诉我们就好。', enabled: true},
    {id: 'contact', question: '怎样联系人工客服？', answer: '直接在输入框中发送你的问题，客服可以在后台查看并回复。请保留当前页面，回复会自动更新。', enabled: true},
    {id: 'privacy', question: '我的信息会被公开吗？', answer: '你的留言仅用于本次咨询，不会展示给其他访客。请勿在聊天中提供密码、验证码等敏感信息。', enabled: true},
  ],
};
