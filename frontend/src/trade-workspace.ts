import './theme-keduoduo.css';
import { playMarketsIntro, playViewEnter, resetMotionState } from './trade-motion';
import './theme-keduoduo-admin.css';
import { refreshAdminDeck } from './admin-deck';
import { publishTimetable, type TimetableTodo } from './trade-timetable';

/** View-only navigation and data presentation controller; core business actions remain in prototype-api.ts. */
const root = document.documentElement;
root.dataset.ui = 'trade';
const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector);
const $$ = <T extends Element = HTMLElement>(selector: string) => Array.from(document.querySelectorAll<T>(selector));

const menuButton = $<HTMLButtonElement>('#tradeMenuToggle');
const scrim = $<HTMLButtonElement>('#tradeNavigationScrim');
const sidebar = $<HTMLElement>('.sidebar');
const mobileQuery = window.matchMedia('(max-width: 900px)');
function setNavigation(open: boolean, returnFocus = false) {
  document.body.classList.toggle('trade-navigation-open', open && mobileQuery.matches);
  menuButton?.setAttribute('aria-expanded', String(open && mobileQuery.matches));
  menuButton?.setAttribute('aria-label', open ? '关闭导航' : '展开导航');
  if (sidebar) sidebar.inert = mobileQuery.matches && !open;
  if (returnFocus && !open) menuButton?.focus();
}
setNavigation(false);
menuButton?.addEventListener('click', () => setNavigation(!document.body.classList.contains('trade-navigation-open')));
scrim?.addEventListener('click', () => setNavigation(false, true));
mobileQuery.addEventListener('change', () => setNavigation(false));
sidebar?.addEventListener('click', event => {
  if ((event.target as Element).closest('button[data-view]') && mobileQuery.matches) setNavigation(false, true);
});
const breadcrumb = $('#tradeBreadcrumbCurrent');
const crumb = $('.trade-crumb');
if (crumb) crumb.setAttribute('aria-live','polite');
document.addEventListener('click',event=>{if((event.target as Element).closest('button[data-view]'))queueMicrotask(updateChrome);});
function labelForActiveView(): string {
  const active = $('.workspace > .view.active') || $('.main > .view.active');
  const heading = active?.querySelector<HTMLElement>('h1,h2');
  if (active?.id === 'customers') return $('#customerPageTitle')?.textContent?.trim() || heading?.textContent?.trim() || '客户';
  if(active?.id==='dashboard') return '工作台';
  return heading?.textContent?.trim() || active?.querySelector<HTMLElement>('.pc-h1,.sh-h1')?.textContent?.trim() || active?.id || '工作台';
}
let lastActiveViewId = '';
function updateChrome() {
  const active = $('.workspace > .view.active') || $('.main > .view.active');
  const activeLabel=labelForActiveView();
  if (breadcrumb && breadcrumb.textContent !== activeLabel) breadcrumb.textContent = activeLabel;
  // 切换页面时让页首标题落位（只回答用户动作，240ms）。
  if (active && active.id !== lastActiveViewId) {
    lastActiveViewId = active.id;
    playViewEnter(active);
    refreshAdminDeck();
  }
  if (active && document.body.classList.contains('is-authenticated')) {
    document.title = `${activeLabel} · 客多多`;
  } else if (!document.body.classList.contains('is-authenticated')) {
    document.title = '客多多 · 外贸客户经营台';
  }
}
$$('.view').forEach(view => new MutationObserver(updateChrome).observe(view,{attributes:true,attributeFilter:['class']}));
if (breadcrumb) new MutationObserver(updateChrome).observe(breadcrumb,{childList:true,characterData:true,subtree:true});
// 登录态变化后重新同步文档标题与面包屑。
new MutationObserver(updateChrome).observe(document.body,{attributes:true,attributeFilter:['class']});
updateChrome();

// The waypoint display is driven only by CRM-visible customers; it never fabricates shipments.
const hero = $<HTMLElement>('#tradeRouteHero');
interface MarketRoute { code:string; name:string; count:number; lon:number; lat:number }
let currentMarkets: MarketRoute[] = [];
let currentCustomerCount = 0;
const coordinateAliases: Record<string,{code:string;name:string;lon:number;lat:number}> = {
 '美国':{code:'US',name:'美国',lon:-98,lat:39}, '美利坚合众国':{code:'US',name:'美国',lon:-98,lat:39}, us:{code:'US',name:'美国',lon:-98,lat:39}, usa:{code:'US',name:'美国',lon:-98,lat:39}, unitedstates:{code:'US',name:'美国',lon:-98,lat:39}, unitedstatesofamerica:{code:'US',name:'美国',lon:-98,lat:39},
 '英国':{code:'GB',name:'英国',lon:-2,lat:54}, gb:{code:'GB',name:'英国',lon:-2,lat:54}, uk:{code:'GB',name:'英国',lon:-2,lat:54}, unitedkingdom:{code:'GB',name:'英国',lon:-2,lat:54},
 '德国':{code:'DE',name:'德国',lon:10,lat:51}, de:{code:'DE',name:'德国',lon:10,lat:51}, germany:{code:'DE',name:'德国',lon:10,lat:51},
 '法国':{code:'FR',name:'法国',lon:2,lat:47}, fr:{code:'FR',name:'法国',lon:2,lat:47}, france:{code:'FR',name:'法国',lon:2,lat:47},
 '日本':{code:'JP',name:'日本',lon:138,lat:37}, jp:{code:'JP',name:'日本',lon:138,lat:37}, japan:{code:'JP',name:'日本',lon:138,lat:37},
 '韩国':{code:'KR',name:'韩国',lon:128,lat:36}, kr:{code:'KR',name:'韩国',lon:128,lat:36}, southkorea:{code:'KR',name:'韩国',lon:128,lat:36},
 '新加坡':{code:'SG',name:'新加坡',lon:104,lat:1}, sg:{code:'SG',name:'新加坡',lon:104,lat:1}, singapore:{code:'SG',name:'新加坡',lon:104,lat:1},
 '澳大利亚':{code:'AU',name:'澳大利亚',lon:134,lat:-25}, au:{code:'AU',name:'澳大利亚',lon:134,lat:-25}, australia:{code:'AU',name:'澳大利亚',lon:134,lat:-25},
 '加拿大':{code:'CA',name:'加拿大',lon:-106,lat:57}, ca:{code:'CA',name:'加拿大',lon:-106,lat:57}, canada:{code:'CA',name:'加拿大',lon:-106,lat:57},
 '荷兰':{code:'NL',name:'荷兰',lon:5,lat:52}, nl:{code:'NL',name:'荷兰',lon:5,lat:52}, netherlands:{code:'NL',name:'荷兰',lon:5,lat:52},
 '西班牙':{code:'ES',name:'西班牙',lon:-4,lat:40}, es:{code:'ES',name:'西班牙',lon:-4,lat:40}, spain:{code:'ES',name:'西班牙',lon:-4,lat:40},
 '意大利':{code:'IT',name:'意大利',lon:12,lat:42}, it:{code:'IT',name:'意大利',lon:12,lat:42}, italy:{code:'IT',name:'意大利',lon:12,lat:42},
 '印度':{code:'IN',name:'印度',lon:78,lat:22}, in:{code:'IN',name:'印度',lon:78,lat:22}, india:{code:'IN',name:'印度',lon:78,lat:22},
 '巴西':{code:'BR',name:'巴西',lon:-52,lat:-10}, br:{code:'BR',name:'巴西',lon:-52,lat:-10}, brazil:{code:'BR',name:'巴西',lon:-52,lat:-10},
 '中国':{code:'CN',name:'中国',lon:105,lat:35}, cn:{code:'CN',name:'中国',lon:105,lat:35}, china:{code:'CN',name:'中国',lon:105,lat:35},
 '墨西哥':{code:'MX',name:'墨西哥',lon:-102,lat:23}, mx:{code:'MX',name:'墨西哥',lon:-102,lat:23}, mexico:{code:'MX',name:'墨西哥',lon:-102,lat:23},
 '阿联酋':{code:'AE',name:'阿联酋',lon:54,lat:24}, ae:{code:'AE',name:'阿联酋',lon:54,lat:24}, uae:{code:'AE',name:'阿联酋',lon:54,lat:24},
 '瑞典':{code:'SE',name:'瑞典',lon:16,lat:62}, se:{code:'SE',name:'瑞典',lon:16,lat:62}, sweden:{code:'SE',name:'瑞典',lon:16,lat:62},
 '越南':{code:'VN',name:'越南',lon:108,lat:16}, vn:{code:'VN',name:'越南',lon:108,lat:16}, vietnam:{code:'VN',name:'越南',lon:108,lat:16},
 '新西兰':{code:'NZ',name:'新西兰',lon:172,lat:-41}, nz:{code:'NZ',name:'新西兰',lon:172,lat:-41}, newzealand:{code:'NZ',name:'新西兰',lon:172,lat:-41},
 '南非':{code:'ZA',name:'南非',lon:24,lat:-29}, za:{code:'ZA',name:'南非',lon:24,lat:-29}, southafrica:{code:'ZA',name:'南非',lon:24,lat:-29}
};
export function publishTradeWorkbenchSnapshot(customers:Array<{country?:string}>, todos:TimetableTodo[] = []) {
 publishTimetable(todos);
 const counts=new Map<string,{location:NonNullable<typeof coordinateAliases[string]>;count:number}>();
 for(const customer of customers){
  const raw=String(customer.country||'').trim(); if(!raw||raw==='未知')continue;
  const alias=raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[\s.,_-]/g,'');
  const location=coordinateAliases[alias];if(!location)continue;
  const current=counts.get(location.code);counts.set(location.code,{location,count:(current?.count||0)+1});
 }
 currentCustomerCount=customers.length;
 currentMarkets=Array.from(counts.values()).map(item=>({...item.location,count:item.count})).sort((a,b)=>b.count-a.count).slice(0,6);
 const marketCount=Array.from(counts.values()).length;
 const summary=$<HTMLElement>('#tradeRouteSummary');
 if(summary)summary.textContent=!customers.length?'当前没有客户记录':marketCount?`${customers.length} 家可见客户 · ${marketCount} 个目的市场`:`${customers.length} 家可见客户 · 暂无可归集的客户国家`;
 drawRoute();
}
function esc(value: string) { return value.replace(/[&<>"']/g,char=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]!)); }
function drawRoute() {
  if (!hero) return;
  const routes = currentMarkets;
  const empty = $<HTMLElement>('.trade-route-empty');
  const hint = $<HTMLElement>('.trade-route-hint');
  const selected = routes.slice(0, 6);
  if (!selected.length) {
    hero.replaceChildren();
    if (empty) empty.hidden = false;
    hero.setAttribute('aria-label', '当前没有可归集的客户市场');
    if (hint) hint.textContent = '';
    resetMotionState();
    return;
  }
  if (empty) empty.hidden = true;
  // 唛头带：每个目的市场一枚“唛头”，以客户数排序，最大的一枚用印章红。
  hero.innerHTML = selected.map((route, index) => {
    const title = `${route.name} · ${route.count} 家客户`;
    return `<div class="mh-mark trade-route-link" role="listitem" tabindex="0" data-rank="${index + 1}" aria-label="${esc(title)}"><span class="mh-code">${esc(route.code)}</span><b class="mh-count">${route.count}</b><span class="mh-name">${esc(route.name)}</span></div>`;
  }).join('');
  hero.setAttribute('aria-label', `客户目的市场：${selected.map(item => `${item.name} ${item.count} 家`).join('，')}`);
  if (hint) hint.textContent = `${currentCustomerCount} 家客户 · ${routes.length} 个市场`;
  // 唯一一处非用户触发的动效：航线描出 → 唛头盖下 → 数量计数。
  // 相同数据签名不重复播放（工作台每 60 秒重渲染）。
  playMarketsIntro({
    host: hero,
    band: hero.closest<HTMLElement>('.mh-band'),
    signature: selected.map(item => `${item.code}:${item.count}`).join('|')
  });
}
drawRoute();

// Calendar label is presentation only; no date or business metric is altered.
const dateLabel=$<HTMLElement>('#tradeDateChip');
if(dateLabel) dateLabel.textContent=new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long'}).format(new Date());
$$<HTMLButtonElement>('[data-trade-navigate]').forEach(button=>button.addEventListener('click',()=>{
 const target=button.dataset.tradeNavigate; if(!target)return;
 const destination=$<HTMLButtonElement>(`.sidebar button[data-view="${CSS.escape(target)}"]`);
 destination?.click();
}));

// Add a real-business page switcher (Cmd/Ctrl+K) using the original accessible navigation targets.
const dialog=$<HTMLDialogElement>('#tradeCommandDialog');
const commandInput=$<HTMLInputElement>('#tradeCommandInput');
const commandResults=$('#tradeCommandResults');
function renderCommandResults(){
 if(!commandResults)return;
 const needle=(commandInput?.value||'').trim().toLocaleLowerCase();
 const entries=$$<HTMLButtonElement>('.sidebar button[data-view]').filter(button=>{
   if(button.closest('[hidden]'))return false;
   return !needle||(button.textContent||'').toLocaleLowerCase().includes(needle)||(button.title||'').toLocaleLowerCase().includes(needle);
 });
 commandResults.replaceChildren();
 if(!entries.length){const empty=document.createElement('p');empty.className='trade-command-empty';empty.textContent='没有找到页面。试试输入客户、单据或报表。';commandResults.append(empty);return;}
 for(const source of entries){
  const option=document.createElement('button');option.type='button';
  const name=document.createElement('span');name.textContent=source.querySelector('span')?.textContent?.trim()||source.title;
  const group=document.createElement('small');group.textContent=source.closest('details')?.getAttribute('aria-label')||'业务台';
  option.append(name,group);
  option.addEventListener('click',()=>{dialog?.close();source.click();setNavigation(false);});
  commandResults.append(option);
 }
}
$('#tradeCommandClose')?.addEventListener('click',()=>dialog?.close());
commandInput?.addEventListener('input',renderCommandResults);
dialog?.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'&&document.body.classList.contains('trade-navigation-open'))setNavigation(false,true);
 if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'&&document.body.classList.contains('is-authenticated')&&dialog){
  event.preventDefault();if(dialog.open){dialog.close();return;}renderCommandResults();dialog.showModal();commandInput?.focus();
 }
 if(event.key==='Tab'&&mobileQuery.matches&&document.body.classList.contains('trade-navigation-open')&&sidebar){
  const items=Array.from(sidebar.querySelectorAll<HTMLElement>('button,summary,a[href]')).filter(item=>item.getClientRects().length&&!item.closest('[hidden]'));
  if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1)?.focus();}
  else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0]?.focus();}
 }
});
commandInput?.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();commandResults?.querySelector<HTMLButtonElement>('button')?.focus();}if(event.key==='Enter'){event.preventDefault();commandResults?.querySelector<HTMLButtonElement>('button')?.click();}});
commandResults?.addEventListener('keydown',event=>{if(!['ArrowDown','ArrowUp'].includes(event.key))return;event.preventDefault();const items=Array.from(commandResults.querySelectorAll('button'));const at=items.indexOf(document.activeElement as HTMLButtonElement);items[(at+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();});

// Existing form labels gain explicit associations. No auth listener or credential handling is changed.
$$<HTMLElement>('.login-field').forEach(field=>{const input=field.querySelector('input'),label=field.querySelector('label');if(input&&label)label.htmlFor=input.id;});
