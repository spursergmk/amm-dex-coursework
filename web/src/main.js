import { BrowserProvider, JsonRpcProvider, Contract, formatUnits, parseUnits, isAddress } from 'ethers';
import './style.css';
const $=id=>document.getElementById(id);
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=a=>a?`${a.slice(0,8)}…${a.slice(-6)}`:'—';
const number=(v,d=18)=>Number(formatUnits(v,d)).toLocaleString('en-US',{maximumFractionDigits:6});
let cfg,provider,signer,address,pools=[],busy=false,metaCache=new Map(),bestRoute;
const log=[];
const same=(a,b)=>a.toLowerCase()===b.toLowerCase();
const token=(a,write=false)=>new Contract(a,cfg.abi.token,write?signer:provider);
const dex=(a,write=false)=>new Contract(a,cfg.abi.dex,write?signer:provider);
async function meta(a){if(!metaCache.has(a)){const t=token(a);metaCache.set(a,{address:a,symbol:await t.symbol(),decimals:Number(await t.decimals())});}return metaCache.get(a);}
function setNotice(text,error=false){$('notice').textContent=text;$('notice').className=error?'error':'success';}
async function run(label,fn){if(busy)return;busy=true;document.body.classList.add('busy');setNotice(`${label}……`);try{await fn();setNotice(`${label}完成`);}catch(e){console.error(e);setNotice(e.reason||e.shortMessage||e.message,true);}finally{busy=false;document.body.classList.remove('busy');}}
function requireSigner(){if(!signer)throw Error('请先连接钱包或选择本地测试账户。');}
async function assertChain(){const chain=await provider.getNetwork();if(Number(chain.chainId)!==cfg.chainId)throw Error(`网络不匹配，请切换到 Chain ID ${cfg.chainId}。`);}
async function deadline(){return (await provider.getBlock('latest')).timestamp+600;}
function slippage(){const n=Number($('slippage').value);if(!Number.isFinite(n)||n<0||n>5)throw Error('滑点应在 0—5% 之间。');return BigInt(Math.round(n*100));}
const minimum=x=>x*(10000n-slippage())/10000n;
function current(){const p=pools.find(p=>p.key===$('pool-select').value);if(!p)throw Error('请先创建交易池。');return p;}
function amount(id,decimals){const n=parseUnits($(id).value.trim(),decimals);if(n<=0n)throw Error('数量必须大于零。');return n;}
async function mined(tx,label){setNotice(`${label}：等待确认 ${short(tx.hash)}`);const r=await tx.wait();log.unshift({label,hash:r.hash,block:r.blockNumber,status:r.status});renderLog();if(r.status!==1)throw Error('交易执行失败');return r;}
function renderLog(){$('tx-log').innerHTML=log.length?log.map(t=>`<div class="log-entry"><strong>${esc(t.label)}</strong> · 区块 ${t.block} · ${t.status===1?'成功':'失败'}<code>${esc(t.hash)}</code></div>`).join(''):'暂无本页面交易。';}
async function approve(t,spender,n){requireSigner();if(await token(t).allowance(address,spender)<n)await mined(await token(t,true).approve(spender,n),'ERC20 授权');}
async function refresh(){
 await assertChain();const next=[];
 for(const conf of cfg.dexes){const d=dex(conf.address);const count=Number(await d.poolCount());for(let id=1;id<=count;id++){const p=await d.pools(id);next.push({key:`${conf.address}:${id}`,id,dex:conf.address,name:conf.name,...Object.fromEntries(['tokenA','tokenB','reserveA','reserveB','totalShares'].map(k=>[k,p[k]])),a:await meta(p.tokenA),b:await meta(p.tokenB)});}}
 pools=next;const selected=$('pool-select').value;
 $('pool-select').innerHTML=pools.map(p=>`<option value="${p.key}">${esc(p.name)} #${p.id} · ${esc(p.a.symbol)}/${esc(p.b.symbol)}</option>`).join('');
 if(pools.some(p=>p.key===selected))$('pool-select').value=selected;
 $('pool-cards').innerHTML=pools.map(p=>`<article class="pool"><span class="eyebrow">${esc(p.name)} / POOL ${p.id}</span><h3>${esc(p.a.symbol)} / ${esc(p.b.symbol)}</h3><div class="price">${p.reserveA>0n?(Number(formatUnits(p.reserveB,p.b.decimals))/Number(formatUnits(p.reserveA,p.a.decimals))).toFixed(6):'—'} <small>${esc(p.b.symbol)} / ${esc(p.a.symbol)}</small></div><p>储备 ${number(p.reserveA,p.a.decimals)} ${esc(p.a.symbol)}<br>${number(p.reserveB,p.b.decimals)} ${esc(p.b.symbol)}</p><code title="${p.dex}">${short(p.dex)}</code></article>`).join('');
 updatePool();
 if(address){$('account').textContent=address;const eth=await provider.getBalance(address);const balances=await Promise.all(cfg.tokens.map(async t=>`${number(await token(t.address).balanceOf(address),t.decimals)} ${t.symbol}`));$('balances').textContent=`${number(eth)} ETH · ${balances.join(' · ')}`;}
 await renderPositions();
}
function updatePool(){if(!pools.length)return;const p=current(),selected=$('swap-token').value;$('swap-token').innerHTML=[p.a,p.b].map(t=>`<option value="${t.address}">${esc(t.symbol)}</option>`).join('');if([p.tokenA,p.tokenB].includes(selected))$('swap-token').value=selected;$('add-a-label').textContent=`${p.a.symbol} 投入上限`;$('add-b-label').textContent=`${p.b.symbol} 投入上限`;$('swap-quote').textContent='点击获取当前报价。';$('add-quote').textContent='点击预览实际投入与份额。';bestRoute=null;}
async function swapQuote(){const p=current(),input=await meta($('swap-token').value),output=same(input.address,p.tokenA)?p.b:p.a;const n=amount('swap-amount',input.decimals),out=await dex(p.dex).quoteSwap(p.id,input.address,n);$('swap-quote').textContent=`预计到账 ${number(out,output.decimals)} ${output.symbol}；最低到账 ${number(minimum(out),output.decimals)} ${output.symbol}`;return {p,input,n,out};}
async function addQuote(){const p=current(),a=amount('add-a',p.a.decimals),b=amount('add-b',p.b.decimals),q=await dex(p.dex).quoteAdd(p.id,a,b);$('add-quote').textContent=`实际投入 ${number(q[0],p.a.decimals)} ${p.a.symbol} + ${number(q[1],p.b.decimals)} ${p.b.symbol}；份额 ${number(q[2])}`;return {p,a,b,q};}
async function renderPositions(){const rows=[],mine=[];
 for(const conf of cfg.dexes){const d=dex(conf.address),next=Number(await d.nextPositionId());for(let id=1;id<next;id++){const pos=await d.positions(id);if(pos.shares===0n)continue;const owner=await d.ownerOf(id),p=pools.find(p=>p.dex===conf.address&&p.id===Number(pos.poolId));if(!p)continue;
 rows.push(`<tr><td>${esc(conf.name)} / ${pos.poolId} / #${id}</td><td title="${pos.provider}">${short(pos.provider)}</td><td title="${owner}">${short(owner)}</td><td>${number(pos.depositedA,p.a.decimals)} / ${number(pos.depositedB,p.b.decimals)}</td><td>${number(pos.shares)}</td><td>${new Date(Number(pos.createdAt)*1000).toLocaleString('zh-CN',{hour12:false})}</td></tr>`);
 if(address&&same(owner,address)){const [a,b]=await d.quoteRemove(id);mine.push(`<article class="nft"><span class="eyebrow">${esc(conf.name)} · POOL ${pos.poolId}</span><h3>流动性凭证 #${id}</h3><p>份额 ${number(pos.shares)} / 占比 ${(Number(pos.shares)*100/Number(p.totalShares)).toFixed(4)}%</p><p>当前可赎回<br><strong>${number(a,p.a.decimals)} ${esc(p.a.symbol)} + ${number(b,p.b.decimals)} ${esc(p.b.symbol)}</strong></p><button data-remove="${conf.address}:${id}" class="secondary">销毁 NFT 并赎回</button><details><summary>转让凭证</summary><input aria-label="NFT #${id} 接收地址" data-recipient="${conf.address}:${id}" placeholder="接收方 0x 地址"><button data-transfer="${conf.address}:${id}" class="secondary">转让 NFT</button></details></article>`);}
 }}
 $('sources').innerHTML=rows.join('');$('my-nfts').innerHTML=mine.join('')||'<p>当前账户没有活跃流动性 NFT。添加流动性后在此查看。</p>';
}
async function scan(){let best=null;for(const buy of [0,1]){const first=pools.find(p=>p.dex===cfg.dexes[buy].address&&p.id===1),second=pools.find(p=>p.dex===cfg.dexes[1-buy].address&&p.id===1);if(!first||!second)continue;if(!([second.tokenA,second.tokenB].some(a=>same(a,first.tokenA))&&[second.tokenA,second.tokenB].some(a=>same(a,first.tokenB))))continue;
 for(const input of [first.a,first.b])for(const size of [1,2,5,10,20,50,100,150,200]){const n=parseUnits(String(size),input.decimals),mid=same(input.address,first.tokenA)?first.b:first.a;try{const q=await dex(first.dex).quoteSwap(1,input.address,n),out=await dex(second.dex).quoteSwap(1,mid.address,q),profit=out-n;if(profit>0n&&(!best||Number(formatUnits(profit,input.decimals))>Number(formatUnits(best.profit,best.input.decimals))))best={first,second,input,n,out,profit};}catch{/* Empty pools are not candidates. */}}
 }
 bestRoute=best;if(!best){$('arb-quote').textContent='试算范围内无正收益路线。可先在一个池子交易形成价差。';return null;}
 $('arb-quote').innerHTML=`<strong>${esc(best.first.name)} → ${esc(best.second.name)}</strong><br>投入 ${number(best.n,best.input.decimals)} ${esc(best.input.symbol)} → 回收 ${number(best.out,best.input.decimals)} ${esc(best.input.symbol)}<br>预计毛利润 ${number(best.profit,best.input.decimals)} ${esc(best.input.symbol)}<br><small>两种代币的数值未按共同计价单位折算；此处仅演示可盈利路线。</small>`;return best;
}
async function renderSimulation(){try{const r=await fetch('/simulation.json');if(!r.ok)throw Error();const s=await r.json();const a=s.arbitrage;
 $('simulation').innerHTML=`<div class="metrics"><div><strong>${s.users.length}</strong>独立账户</div><div><strong>${s.actions.swaps} / ${s.actions.adds} / ${s.actions.removes}</strong>兑换 / 添加 / 撤回</div><div><strong>${Number(a.profit).toFixed(6)} ${esc(a.token)}</strong>套利毛利润（未扣 Gas）</div></div><p>存档网络：${esc(s.network)}，Chain ID ${s.chainId}。以下为模拟脚本保存的历史收据，不是当前余额。</p><p>路线 ${esc(a.route.join(' → '))}；投入 ${a.amountIn}，回收 ${Number(a.amountOut).toFixed(6)} ${esc(a.token)}；同一收据含 ${a.swapEventsInSameReceipt} 个 Swap 事件。</p><code>${esc(a.transactionHash)}</code><div class="table-wrap"><table><thead><tr><th>交易池</th><th>套利前价格 B/A</th><th>套利后价格 B/A</th><th>储备 A（前 → 后）</th><th>储备 B（前 → 后）</th></tr></thead><tbody>${a.before.map((p,i)=>`<tr><td>${esc(p.dex)}</td><td>${p.priceBperA.toFixed(6)}</td><td>${a.after[i].priceBperA.toFixed(6)}</td><td>${Number(p.reserveA).toFixed(3)} → ${Number(a.after[i].reserveA).toFixed(3)}</td><td>${Number(p.reserveB).toFixed(3)} → ${Number(a.after[i].reserveB).toFixed(3)}</td></tr>`).join('')}</tbody></table></div><p class="verified">失败回滚验证：收据状态 ${s.rollback.status}；两池储备保持不变，用户起始代币余额保持不变。失败交易仍支付 Gas。</p><code>${esc(s.rollback.hash)}</code><p><a href="/simulation.json" target="_blank" rel="noreferrer">打开完整交易记录 JSON</a></p>`;
 }catch{$('simulation').textContent='尚未生成模拟记录。请运行 npm run simulate。';}}
function bind(){
 document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab],.tab').forEach(e=>e.classList.remove('active'));b.classList.add('active');$(`tab-${b.dataset.tab}`).classList.add('active');});
 $('pool-select').onchange=updatePool;
 $('connect-local').onclick=()=>run('连接本地账户',async()=>{provider=new JsonRpcProvider(cfg.rpcUrl);signer=await provider.getSigner(Number($('local-account').value));address=await signer.getAddress();await refresh();});
 $('connect-wallet').onclick=()=>run('连接钱包',async()=>{if(!window.ethereum)throw Error('未检测到浏览器钱包，请安装 MetaMask 或使用本地账户。');const bp=new BrowserProvider(window.ethereum);await bp.send('eth_requestAccounts',[]);if(Number((await bp.getNetwork()).chainId)!==cfg.chainId)throw Error(`请在钱包中切换至 Chain ID ${cfg.chainId} 后重新连接。`);provider=bp;signer=await bp.getSigner();address=await signer.getAddress();await refresh();});
 $('refresh').onclick=()=>run('刷新',refresh);$('refresh-positions').onclick=()=>run('刷新凭证',renderPositions);
 $('quote-swap').onclick=()=>run('获取报价',swapQuote);$('quote-add').onclick=()=>run('预览投入',addQuote);
 $('swap').onclick=()=>run('兑换',async()=>{requireSigner();const {p,input,n,out}=await swapQuote();const min=minimum(out);await approve(input.address,p.dex,n);await mined(await dex(p.dex,true).swap(p.id,input.address,n,min,await deadline()),'兑换');await refresh();});
 $('add').onclick=()=>run('添加流动性',async()=>{requireSigner();const {p,a,b,q}=await addQuote(),minA=minimum(q[0]),minB=minimum(q[1]);await approve(p.tokenA,p.dex,a);await approve(p.tokenB,p.dex,b);await mined(await dex(p.dex,true).addLiquidity(p.id,a,b,minA,minB,await deadline()),'添加流动性 / 铸造 NFT');await refresh();});
 $('create').onclick=()=>run('创建交易池',async()=>{requireSigner();const a=$('create-a').value.trim(),b=$('create-b').value.trim();if(!isAddress(a)||!isAddress(b))throw Error('请输入有效 ERC20 地址。');await Promise.all([meta(a),meta(b)]);await mined(await dex($('create-dex').value,true).createPool(a,b),'创建交易池');await refresh();});
 $('faucets').onclick=e=>{const addr=e.target.dataset.faucet;if(addr)run('领取测试代币',async()=>{requireSigner();await mined(await token(addr,true).faucet(),'领取测试代币');await refresh();});};
 $('my-nfts').onclick=e=>{const remove=e.target.dataset.remove,transfer=e.target.dataset.transfer;if(remove)run('销毁 NFT 并赎回',async()=>{requireSigner();const [d,id]=remove.split(':'),q=await dex(d).quoteRemove(id);await mined(await dex(d,true).removeLiquidity(id,minimum(q[0]),minimum(q[1]),await deadline()),'销毁 NFT / 赎回');await refresh();});if(transfer)run('转让 NFT',async()=>{requireSigner();const [d,id]=transfer.split(':'),to=document.querySelector(`[data-recipient="${transfer}"]`).value.trim();if(!isAddress(to))throw Error('接收地址无效。');await mined(await dex(d,true)['safeTransferFrom(address,address,uint256)'](address,to,id),'转让 NFT');await refresh();});};
 $('scan').onclick=()=>run('扫描套利',scan);
 $('execute-arb').onclick=()=>run('执行原子套利',async()=>{requireSigner();const route=await scan();if(!route)throw Error('当前没有正收益路线。');const {first,second,input,n}=route,min=amount('min-profit',input.decimals);if(route.profit<min)throw Error('预期利润低于最低利润，未发送交易。');await approve(input.address,cfg.arbitrage,n);const before=await token(input.address).balanceOf(address);const arb=new Contract(cfg.arbitrage,cfg.abi.arbitrage,signer);const r=await mined(await arb.execute(first.dex,1,second.dex,1,input.address,n,min,await deadline()),'原子套利');const event=r.logs.map(l=>{try{return arb.interface.parseLog(l);}catch{return null;}}).find(e=>e?.name==='ArbitrageExecuted');const after=await token(input.address).balanceOf(address);$('arb-result').innerHTML=`<p class="verified">执行成功 · 区块 ${r.blockNumber}</p><p>资产 ${number(before,input.decimals)} → ${number(after,input.decimals)} ${esc(input.symbol)}</p><p>实际毛利润 <strong>${number(event.args.profit,input.decimals)} ${esc(input.symbol)}</strong></p><p>Gas ${number(r.gasUsed*r.gasPrice)} ETH（未从代币利润扣减）</p><code>${r.hash}</code>`;await refresh();});
 if(window.ethereum?.on){window.ethereum.on('accountsChanged',()=>{signer=null;address=null;$('account').textContent='钱包账户已变化，请重新连接';$('balances').textContent='';$('my-nfts').innerHTML='请重新连接账户后刷新。';});window.ethereum.on('chainChanged',()=>location.reload());}
}
async function init(){const r=await fetch('/deployment.json');if(!r.ok)throw Error('未找到部署文件，请先运行部署脚本。');cfg=await r.json();$('network').textContent=`${cfg.network} · Chain ${cfg.chainId}`;
 const local=cfg.chainId===31337&&['localhost','127.0.0.1','[::1]'].includes(location.hostname);
 if(local){provider=new JsonRpcProvider(cfg.rpcUrl);const accounts=await provider.listAccounts();$('local-account').innerHTML=accounts.map((a,i)=>`<option value="${i}">用户 ${String(i+1).padStart(2,'0')} · ${short(a.address)}</option>`).join('');$('local-account').hidden=false;$('connect-local').hidden=false;$('eth-note').textContent='本地节点预置20个账户，每个账户已有测试 ETH。此入口仅在本机 Chain 31337 开放。';}
 else if(window.ethereum)provider=new BrowserProvider(window.ethereum);
 else throw Error('请安装浏览器钱包并连接部署网络。');
 $('create-dex').innerHTML=cfg.dexes.map(d=>`<option value="${d.address}">${esc(d.name)}</option>`).join('');$('create-a').value=cfg.tokens[0].address;$('create-b').value=cfg.tokens[1].address;
 $('faucets').innerHTML=cfg.tokens.map(t=>`<button data-faucet="${t.address}" class="secondary">领取 ${esc(t.symbol)}</button>`).join('');bind();renderLog();await refresh();await renderSimulation();setNotice('链上数据已加载。请选择账户开始操作。');
}
init().catch(e=>{console.error(e);setNotice(e.shortMessage||e.message,true);});
