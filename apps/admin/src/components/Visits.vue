<script setup lang="ts">
import {onBeforeUnmount, onMounted, ref} from 'vue';
import {ChevronLeft, ChevronRight, Footprints, Info, Monitor, RefreshCw, Search, Smartphone, Tablet} from 'lucide-vue-next';
import type {VisitDetail, VisitDeviceType, VisitListResponse} from '@yp666/shared';
import {api} from '../api';

type Filters = {dateFrom: string; dateTo: string; deviceType: '' | VisitDeviceType; keyword: string};
const dateFormatter = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'});
const defaults = (): Filters => {const today = dateFormatter.format(new Date()); return {dateFrom: today, dateTo: today, deviceType: '', keyword: ''};};
const filters = ref<Filters>(defaults());
const applied = ref<Filters>(defaults());
const result = ref<VisitListResponse>();
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);
const error = ref('');
const validation = ref('');
const deviceNames: Record<VisitDeviceType, string> = {mobile: '手机', tablet: '平板', desktop: '电脑', unknown: '未识别'};
const deviceIcons = {mobile: Smartphone, tablet: Tablet, desktop: Monitor, unknown: Monitor};
const formatter = new Intl.DateTimeFormat('zh-CN', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'});
let controller: AbortController | undefined;
let sequence = 0;

function time(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未采集' : formatter.format(date);
}
function device(visit: VisitDetail): VisitDeviceType {
  return Object.prototype.hasOwnProperty.call(deviceNames, visit.deviceType) ? visit.deviceType : 'unknown';
}
function dateNumber(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? NaN : date.getTime();
}
function validate() {
  const from = dateNumber(filters.value.dateFrom), to = dateNumber(filters.value.dateTo);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return '请选择完整的开始日期和结束日期。';
  if (from > to) return '开始日期不能晚于结束日期。';
  if ((to - from) / 86400000 >= 90) return '每次最多查询 90 天，请缩小日期范围。';
  return '';
}
async function load() {
  controller?.abort();
  const current = ++sequence;
  controller = new AbortController();
  loading.value = true;
  error.value = '';
  const query = new URLSearchParams({dateFrom: applied.value.dateFrom, dateTo: applied.value.dateTo, page: String(page.value), pageSize: String(pageSize.value)});
  if (applied.value.deviceType) query.set('deviceType', applied.value.deviceType);
  if (applied.value.keyword) query.set('keyword', applied.value.keyword);
  try {
    const response = await api<VisitListResponse>('/admin/visits?' + query, {signal: controller.signal});
    if (current !== sequence) return;
    const lastPage = Math.max(1, response.totalPages);
    if (page.value > lastPage) {page.value = lastPage; await load(); return;}
    result.value = response;
    page.value = response.page;
  } catch (cause) {
    if (current === sequence && !(cause instanceof DOMException && cause.name === 'AbortError')) error.value = (cause as Error).message;
  } finally {
    if (current === sequence) loading.value = false;
  }
}
function search() {
  validation.value = validate();
  if (validation.value) return;
  applied.value = {...filters.value, keyword: filters.value.keyword.trim()};
  page.value = 1;
  void load();
}
function reset() {
  filters.value = defaults();
  validation.value = '';
  applied.value = defaults();
  page.value = 1;
  void load();
}
function changePage(value: number) {
  page.value = value;
  void load();
}
function changePageSize() {page.value = 1; void load();}
onMounted(load);
onBeforeUnmount(() => {sequence++; controller?.abort();});
</script>

<template>
  <section class="visits-page">
    <div class="page-heading"><div><div class="eyebrow">KNOW YOUR VISITORS</div><h1>访问明细<span class="heading-dot">.</span></h1><p>查看每天的访客、访问设备与网络信息。</p></div><el-button :loading="loading" @click="load"><RefreshCw :size="15"/>刷新明细</el-button></div>
    <div class="visit-count-note"><Info :size="17"/><div><strong>按浏览器访客每日去重</strong><p>同一浏览器访客每天计 1 次，反复刷新不会累加。清除 Cookie、换浏览器或设备可能计为新访客；相同 IP 的不同访客分别计数。日期与时间均为北京时间。</p></div></div>

    <form class="panel visit-filters" @submit.prevent="search">
      <div class="visit-date-fields"><label for="visits-date-from">开始日期<input id="visits-date-from" v-model="filters.dateFrom" type="date" required/></label><span class="visit-date-separator">至</span><label for="visits-date-to">结束日期<input id="visits-date-to" v-model="filters.dateTo" type="date" required/></label></div>
      <label for="visits-device">访问设备<select id="visits-device" v-model="filters.deviceType"><option value="">全部设备</option><option value="mobile">手机</option><option value="tablet">平板</option><option value="desktop">电脑</option><option value="unknown">未识别</option></select></label>
      <label for="visits-keyword" class="visit-keyword">IP / 访客编号<input id="visits-keyword" v-model="filters.keyword" type="search" placeholder="输入 IP 或访客编号" maxlength="80"/></label>
      <div class="visit-filter-actions"><el-button type="primary" native-type="submit" :loading="loading"><Search :size="15"/>查询</el-button><el-button :disabled="loading" @click="reset">重置</el-button></div>
      <p v-if="validation" class="visit-validation" role="alert">{{validation}}</p>
      <p class="visit-range-hint">默认查看今天，每次最多查询 90 天。</p>
    </form>

    <div v-if="error" class="error-panel" role="alert"><p>{{error}}</p><el-button @click="load">重新加载</el-button></div>
    <article v-else class="panel visit-results" v-loading="loading" :aria-busy="loading">
      <div class="visit-results-heading"><div><h2>访客访问记录</h2><p>{{applied.dateFrom}} 至 {{applied.dateTo}}<span v-if="result"> · 共 {{result.total}} 条</span></p></div><span class="soft-badge">每天每位访客 1 条</span></div>
      <template v-if="result?.items.length">
        <div class="visit-table-wrap">
          <table class="visit-table">
            <thead><tr><th scope="col">首次 / 最近访问</th><th scope="col">访客编号</th><th scope="col">访问设备</th><th scope="col">浏览器 / 系统</th><th scope="col">IP 地址</th><th scope="col">验证状态</th><th scope="col">访问来源</th></tr></thead>
            <tbody><tr v-for="visit in result.items" :key="visit.id">
              <td class="visit-times"><span>{{time(visit.firstSeenAt)}}</span><small>{{time(visit.lastSeenAt)}}</small></td>
              <td><code class="visit-id" :title="visit.visitorId">{{visit.visitorId}}</code></td>
              <td><span class="visit-device"><component :is="deviceIcons[device(visit)]" :size="15"/>{{deviceNames[device(visit)]}}</span></td>
              <td class="visit-client"><span>{{visit.browser || '未采集'}}</span><small>{{visit.os || '未采集'}}</small></td>
              <td><code class="visit-ip">{{visit.ipAddress || '未采集'}}</code></td>
              <td><span class="visit-verification" :class="{'is-verified': visit.verified}">{{visit.verified ? '已验证' : '未验证'}}</span></td>
              <td><details class="visit-more"><summary>查看详情</summary><dl><dt>来源页面</dt><dd>{{visit.referrer || '直接访问 / 未采集'}}</dd><dt>浏览器标识</dt><dd>{{visit.userAgent || '未采集'}}</dd></dl></details></td>
            </tr></tbody>
          </table>
        </div>
        <div class="visit-cards">
          <article v-for="visit in result.items" :key="visit.id" class="visit-card">
            <header><span class="visit-device"><component :is="deviceIcons[device(visit)]" :size="16"/>{{deviceNames[device(visit)]}}</span><span class="visit-verification" :class="{'is-verified': visit.verified}">{{visit.verified ? '已验证' : '未验证'}}</span></header>
            <dl><dt>访客编号</dt><dd><code>{{visit.visitorId}}</code></dd><dt>IP 地址</dt><dd><code>{{visit.ipAddress || '未采集'}}</code></dd><dt>浏览器 / 系统</dt><dd>{{visit.browser || '未采集'}} / {{visit.os || '未采集'}}</dd><dt>首次访问</dt><dd>{{time(visit.firstSeenAt)}}</dd><dt>最近访问</dt><dd>{{time(visit.lastSeenAt)}}</dd></dl>
            <details class="visit-more"><summary>来源与浏览器标识</summary><dl><dt>来源页面</dt><dd>{{visit.referrer || '直接访问 / 未采集'}}</dd><dt>浏览器标识</dt><dd>{{visit.userAgent || '未采集'}}</dd></dl></details>
          </article>
        </div>
      </template>
      <div v-else-if="!loading" class="empty-state"><Footprints :size="35"/><h3>暂无访问记录</h3><p>此日期范围或筛选条件下还没有访客记录，可以调整条件后再查询。</p></div>
      <div v-else class="visit-initial-loading" aria-live="polite">正在加载访问明细…</div>
      <footer v-if="result?.total" class="visit-pagination"><label for="visits-page-size">每页<select id="visits-page-size" v-model.number="pageSize" :disabled="loading" @change="changePageSize"><option :value="20">20 条</option><option :value="50">50 条</option><option :value="100">100 条</option></select></label><span>第 {{result.page}} / {{result.totalPages}} 页</span><div><button class="icon-btn" aria-label="上一页" :disabled="loading || result.page <= 1" @click="changePage(result.page - 1)"><ChevronLeft :size="18"/></button><button class="icon-btn" aria-label="下一页" :disabled="loading || result.page >= result.totalPages" @click="changePage(result.page + 1)"><ChevronRight :size="18"/></button></div></footer>
    </article>
  </section>
</template>

<style scoped>
.visit-count-note{display:flex;gap:11px;padding:16px 18px;border:1px solid #e0e8d8;border-radius:9px;background:#eef3e8;margin-bottom:20px;color:#6c805f}.visit-count-note>svg{margin-top:2px}.visit-count-note strong{font-size:12px;font-weight:550}.visit-count-note p{font-size:11px;line-height:1.9;margin-top:4px;color:#7d8c70}.visit-filters{padding:19px 21px;display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:22px}.visit-filters label{display:flex;flex-direction:column;gap:6px;font-size:11px;font-weight:500;min-width:0}.visit-filters input,.visit-filters select,.visit-pagination select{color:#52634b;background:#fff;border:1px solid #e0e5dc;border-radius:6px;height:37px;padding:7px 10px;font:inherit;min-width:0}.visit-filters input:focus,.visit-filters select:focus,.visit-pagination select:focus{outline:2px solid #a0b6a7;outline-offset:1px}.visit-date-fields{display:flex;align-items:flex-end;gap:10px}.visit-date-fields input{width:143px}.visit-date-separator{align-self:flex-end;color:#9ba490;font-size:11px;padding-bottom:9px}.visit-filters select{min-width:105px}.visit-keyword{flex:1;min-width:175px!important}.visit-filter-actions{display:flex;align-items:center;gap:8px}.visit-filter-actions .el-button+.el-button{margin-left:0}.visit-range-hint{font-size:10px;color:#99a38f;flex-basis:100%;line-height:1.4;margin-top:-4px}.visit-validation{color:#ba634e;font-size:12px;flex-basis:100%}.visit-results{overflow:hidden}.visit-results-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:20px 22px}.visit-results-heading h2{font-size:14px;font-weight:550}.visit-results-heading p{font-size:10px;color:#99a38f;margin-top:5px}.visit-table-wrap{overflow:auto}.visit-table{width:100%;border-collapse:collapse;text-align:left;font-size:11px;line-height:1.65}.visit-table th{background:#f7f9f3;border-top:1px solid #edf0e6;border-bottom:1px solid #edf0e6;color:#8b987e;font-size:10px;font-weight:500;padding:11px 14px;white-space:nowrap}.visit-table td{padding:16px 14px;vertical-align:top;border-bottom:1px solid #edf0e6;color:#57684e}.visit-table th:first-child,.visit-table td:first-child{padding-left:22px}.visit-table th:last-child,.visit-table td:last-child{padding-right:22px}.visit-table tbody tr:last-child td{border-bottom:0}.visit-times{white-space:nowrap}.visit-times span,.visit-client span{display:block}.visit-times small,.visit-client small{display:block;margin-top:5px;color:#99a38f;font-size:10px}.visit-id{display:block;max-width:104px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.visit-ip{display:block;max-width:155px;overflow-wrap:anywhere}.visit-device{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}.visit-device svg{color:#8b9e7c}.visit-verification{display:inline-block;padding:2px 7px;border-radius:4px;background:#f1f3ed;color:#9aa38e;white-space:nowrap;font-size:10px}.visit-verification.is-verified{background:#edf4e7;color:#6c8858}.visit-more{font-size:10px;color:#8c9b7c;max-width:210px}.visit-more summary{cursor:pointer;white-space:nowrap;color:#708b5d}.visit-more dl{margin:10px 0 0;max-width:100%}.visit-more dt{color:#9eaa91;margin-top:8px}.visit-more dd{margin:4px 0 0;overflow-wrap:anywhere;color:#728567;line-height:1.8}.visit-pagination{display:flex;align-items:center;justify-content:flex-end;gap:19px;border-top:1px solid #edf0e6;padding:15px 22px;color:#94a087;font-size:10px}.visit-pagination label{display:flex;align-items:center;gap:8px;margin-right:auto}.visit-pagination select{height:30px;padding:3px 7px;font-size:10px}.visit-pagination>div{display:flex;gap:5px}.visit-cards{display:none}.visit-initial-loading{min-height:200px;display:flex;align-items:center;justify-content:center;color:#99a38f;font-size:12px}
@media(max-width:1200px){.visit-filters{gap:14px}.visit-filter-actions{margin-left:auto}.visit-keyword{flex-basis:190px}.visit-table{min-width:840px}}
@media(max-width:700px){.page-heading{align-items:flex-start}.page-heading>.el-button{font-size:10px;padding:7px 9px;min-height:32px;margin-top:28px}.visit-count-note{padding:13px 14px;margin-bottom:16px;gap:9px}.visit-count-note strong{font-size:11px}.visit-count-note p{font-size:10px}.visit-filters{padding:16px;gap:12px;margin-bottom:17px}.visit-date-fields{width:100%;gap:8px}.visit-date-fields label{flex:1;min-width:0}.visit-date-fields input{width:100%;height:37px}.visit-date-separator{font-size:10px}.visit-filters>label:not(.visit-keyword){width:100%}.visit-filters select{width:100%}.visit-keyword{flex-basis:100%;min-width:0!important}.visit-filter-actions{margin-left:0;width:100%}.visit-filter-actions .el-button{flex:1}.visit-range-hint{margin-top:0}.visit-results-heading{padding:17px 16px}.visit-results-heading .soft-badge{font-size:8px;padding:3px 6px}.visit-results-heading h2{font-size:13px}.visit-results-heading p{font-size:9px}.visit-table-wrap{display:none}.visit-cards{display:block}.visit-card{padding:17px 16px;border-top:1px solid #edf0e6;font-size:11px}.visit-card header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.visit-card>dl{display:grid;grid-template-columns:85px minmax(0,1fr);gap:9px 12px;margin:0}.visit-card>dl dt{color:#9aa68e;font-size:10px}.visit-card>dl dd{margin:0;color:#607153;overflow-wrap:anywhere;font-size:10px}.visit-card .visit-more{border-top:1px dashed #edf0e6;margin-top:14px;padding-top:11px;max-width:none}.visit-pagination{padding:14px 16px;gap:12px;flex-wrap:wrap}.visit-pagination label{font-size:9px;gap:6px}.visit-pagination>span{font-size:9px}.visit-pagination>div{gap:1px}}
</style>
