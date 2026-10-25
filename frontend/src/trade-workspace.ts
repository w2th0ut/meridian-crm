import './trade-workspace.css';
import './trade-overhaul.css';
import './trade-polish.css';

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
function updateChrome() {
  const active = $('.workspace > .view.active') || $('.main > .view.active');
  const activeLabel=labelForActiveView();
  if (breadcrumb && breadcrumb.textContent !== activeLabel) breadcrumb.textContent = activeLabel;
  if (active) document.title = `${labelForActiveView()} · GoodJob 全球航贸工作台`;
}
$$('.view').forEach(view => new MutationObserver(updateChrome).observe(view,{attributes:true,attributeFilter:['class']}));
if (breadcrumb) new MutationObserver(updateChrome).observe(breadcrumb,{childList:true,characterData:true,subtree:true});
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
const shanghai = {x:50,y:47.5};
function coordinatesFor(market:MarketRoute) {
 const delta=((market.lon-121.47+540)%360)-180;
 return {x:50+delta/3.6,y:47.5-(market.lat-31.23)*.53};
}
export function publishTradeWorkbenchSnapshot(customers:Array<{country?:string}>) {
 const counts=new Map<string,{location:NonNullable<typeof coordinateAliases[string]>;count:number}>();
 for(const customer of customers){
  const raw=String(customer.country||'').trim(); if(!raw||raw==='未知')continue;
  const alias=raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[\s.,_-]/g,'');
  const location=coordinateAliases[alias];if(!location)continue;
  const current=counts.get(location.code);counts.set(location.code,{location,count:(current?.count||0)+1});
 }
 currentCustomerCount=customers.length;
 currentMarkets=Array.from(counts.values()).map(item=>({...item.location,count:item.count})).sort((a,b)=>b.count-a.count).slice(0,5);
 const marketCount=Array.from(counts.values()).length;
 const summary=$<HTMLElement>('#tradeRouteSummary');
 if(summary)summary.textContent=!customers.length?'当前没有客户记录':marketCount?`${customers.length} 家可见客户 · ${marketCount} 个可定位市场`:`${customers.length} 家可见客户 · 暂无可定位的客户国家`;
 drawRoute();
}
function esc(value: string) { return value.replace(/[&<>"']/g,char=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]!)); }
function drawRoute() {
  if (!hero) return;
  const routes = currentMarkets;
  const svg = hero.querySelector<SVGSVGElement>('.trade-route-svg');
  const empty = hero.querySelector<HTMLElement>('.trade-route-empty');
  const grid = hero.querySelector<SVGGElement>('.trade-route-points');
  if (!svg || !grid) return;
  const selected = routes.slice(0,5);
  if (!selected.length) {
    grid.replaceChildren();
    if (empty) empty.hidden = false;
    svg.setAttribute('aria-label','当前没有可视化的目的市场。现有的全球航线页仍可查看运输记录。');
    const hint=hero.querySelector<HTMLElement>('.trade-route-hint'); if(hint)hint.textContent=`${currentCustomerCount} 家客户 · 暂无可定位的目的市场；完整全球航线仍可查看运输记录`;
    return;
  }
  if (empty) empty.hidden = true;
  const anchor=shanghai;
  grid.innerHTML=selected.map(route=>{
    const point=coordinatesFor(route),x=point.x,y=point.y;
    const c1=(anchor.x+x)/2,c2=(anchor.y+y)/2-9;
    const labelAnchor=x>68?'end':'start',labelX=x>68?x-2:x+2;
    const title=`${route.name} · ${route.count} 家客户`;
    return `<g class="trade-route-link" tabindex="0" role="img" aria-label="${esc(title)}"><path d="M ${anchor.x} ${anchor.y} Q ${c1.toFixed(1)} ${c2.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}"/><circle class="route-pulse" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.1"/><circle class="route-core" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r=".82"/><text x="${labelX.toFixed(1)}" y="${(y-2).toFixed(1)}" text-anchor="${labelAnchor}">${esc(route.name)}</text><title>${esc(title)}</title></g>`;
  }).join('');
  svg.setAttribute('aria-label',`从上海出发的真实客户市场：${selected.map(item=>`${item.name} ${item.count} 家`).join('，')}`);
  const hint=hero.querySelector<HTMLElement>('.trade-route-hint');if(hint)hint.textContent=`${currentCustomerCount} 家真实客户 · ${routes.length} 个可定位市场`;
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
