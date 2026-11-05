// Records a 1-2 minute walkthrough of the running DApp and writes a video file.
// Requires: local Hardhat node (deploy + simulate done) and `npm run dev` on 127.0.0.1:5173.
import {JsonRpcProvider, Contract, parseEther} from 'ethers';
import fs from 'node:fs/promises';
import path from 'node:path';
import {launchBrowser} from './launch.mjs';

const SPEED = Number(process.env.DEMO_SPEED ?? 1);          // 1 = normal pace, 2 = twice as fast
const USER_INDEX = Number(process.env.DEMO_USER ?? 6);       // local account used on camera
// Off by default: the delivered video is a clean screen recording with no overlay.
// Set DEMO_CAPTIONS=1 to burn in the step captions instead.
const CAPTIONS = process.env.DEMO_CAPTIONS === '1';
const OUT_DIR = path.resolve('../docs/video');
const RAW_DIR = path.resolve('../docs/video-raw');

const config = JSON.parse(await fs.readFile('public/deployment.json', 'utf8'));
if (config.chainId !== 31337) throw new Error('The recorded demo only supports the local chain.');
const rpc = new JsonRpcProvider(config.rpcUrl);
const user = await rpc.getSigner(USER_INDEX);
const userAddress = await user.getAddress();
const [tokA, tokB] = config.tokens;
const [dex1, dex2] = config.dexes;
const a = new Contract(tokA.address, config.abi.token, user);
const b = new Contract(tokB.address, config.abi.token, user);

await fs.mkdir(OUT_DIR, {recursive: true});
await fs.rm(RAW_DIR, {recursive: true, force: true});
await fs.mkdir(RAW_DIR, {recursive: true});

const wait = ms => new Promise(r => setTimeout(r, ms / SPEED));
const steps = [];

const {browser, channel} = await launchBrowser({headless: true});
const context = await browser.newContext({
  viewport: {width: 1280, height: 720},
  deviceScaleFactor: 1,
  recordVideo: {dir: RAW_DIR, size: {width: 1280, height: 720}},
});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));

// A caption strip can be injected by the recorder (DEMO_CAPTIONS=1) so a silent video
// stays readable. The delivered recording leaves the page untouched.
async function caption(text, hint) {
  if (!CAPTIONS) return;
  await page.evaluate(([text, hint]) => {
    let el = document.getElementById('demo-caption');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demo-caption';
      el.style.cssText = [
        'position:fixed', 'left:20px', 'bottom:16px', 'z-index:2147483647',
        'max-width:min(660px,calc(100vw - 260px))', 'padding:11px 16px',
        'border-radius:12px', 'background:rgba(17,43,34,.93)', 'color:#f4faf6',
        'font:500 15px/1.42 "Noto Sans CJK SC","Microsoft YaHei",system-ui,sans-serif',
        'box-shadow:0 12px 32px rgba(0,0,0,.28)', 'pointer-events:none',
        'transition:opacity .25s ease', 'border-left:4px solid #a7e0bd',
      ].join(';');
      document.body.appendChild(el);
    }
    el.innerHTML = `<div style="font:600 10px/1.5 ui-monospace,monospace;letter-spacing:.14em;color:#9ecfb2;text-transform:uppercase">DEMO</div>
      <div>${text}</div>${hint ? `<div style="margin-top:5px;font-size:12.5px;color:#a9c9b8">${hint}</div>` : ''}`;
    el.style.opacity = '1';
  }, [text, hint ?? '']);
}

async function scrollTo(top) {
  await page.evaluate(y => window.scrollTo({top: y, behavior: 'smooth'}), top);
  await wait(600);
}

// Clicks auto-scroll the element into view; reframe so the step's payload is visible
// above the caption strip.
async function focus(selector) {
  await page.evaluate(sel => {
    const el = document.querySelector(sel);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - 88;
    window.scrollTo({top: Math.max(0, y), behavior: 'smooth'});
  }, selector);
  await wait(650);
}

async function done(selector, message, timeout = 60000) {
  await page.locator(selector).click();
  await page.waitForFunction(t => document.querySelector('#notice').textContent === t, message, {timeout});
}
async function tab(name) { await page.locator(`[data-tab="${name}"]`).click(); await wait(700); }
async function shot(name) { await page.screenshot({path: path.join(OUT_DIR, `${name}.png`)}); }
const txCount = async () => (await page.locator('#tx-log .log-entry').count());

const t0 = Date.now();
try {
  // Off-camera setup: a fresh faucet cooldown window so the on-camera claim succeeds.
  await rpc.send('evm_increaseTime', [3601]);
  await rpc.send('evm_mine', []);
  await a.connect(user).approve(dex2.address, parseEther('400'));

  await page.goto('http://127.0.0.1:5173');
  await page.getByText('链上数据已加载。请选择账户开始操作。').waitFor();
  await caption('① 打开 DApp：本地 Hardhat 链 31337，两个独立交易所', 'River DEX 与 Hill DEX，各有一个 TKA/TKB 池，网页直接读链上储备');
  await wait(4200);

  await page.locator('#local-account').selectOption(String(USER_INDEX));
  await done('#connect-local', '连接本地账户完成');
  await caption('② 选择模拟用户并连接账户', `用户 ${String(USER_INDEX + 1).padStart(2, '0')} · ${userAddress.slice(0, 10)}…`);
  await wait(3200);

  await done(`[data-faucet="${tokA.address}"]`, '领取测试代币完成');
  await scrollTo(0);
  await caption('③ 水龙头领取 10,000 TKA（每地址每小时限一次，真实上链交易）', '余额与 NFT 全部来自链上查询，不是前端假数据');
  await wait(3000);
  steps.push({step: 'faucet', at: Date.now() - t0});

  await page.locator('#swap-amount').fill('5');
  await focus('#tab-trade .grid');
  await done('#quote-swap', '获取报价完成');
  await focus('#swap-quote');
  await caption('④ 获取报价：输出量已扣 0.30% 手续费并计入价格冲击', '池子越大、成交越小，越接近卡片上的储备比价格');
  await wait(3000);
  const beforeSwap = await txCount();
  await done('#swap', '兑换完成');
  await scrollTo(0);
  await caption('⑤ 授权并兑换上链', `交易哈希与区块号实时写入“实验记录”，本次页面已发出 ${await txCount()} 笔交易`);
  await wait(3000);
  steps.push({step: 'swap', newTxs: (await txCount()) - beforeSwap});

  await page.locator('#add-a').fill('20');
  await page.locator('#add-b').fill('20');
  await focus('#tab-trade .grid');
  await done('#quote-add', '预览投入完成');
  await focus('#add-quote');
  await caption('⑥ 添加流动性：按池内比例计算实际投入，多余代币留在钱包', '每次添加都会铸造一张 ERC721 流动性凭证');
  await wait(3000);
  await done('#add', '添加流动性完成');
  await scrollTo(0);
  await caption('⑦ 添加成功，ERC721 凭证已铸造给当前账户', '份额包含手续费收益，赎回时按当前储备结算');
  await wait(2800);
  steps.push({step: 'add'});

  await tab('positions');
  await focus('#my-nfts');
  await caption('⑧ NFT 与流动性来源：份额、首次投入、创建时间、原始提供者与当前持有人', '销毁 NFT 即按当前份额取回两种代币，包含池中累积的手续费');
  await wait(4600);
  await shot('07-video-positions');
  steps.push({step: 'positions'});

  await tab('trade');
  await page.locator('#pool-select').selectOption(`${dex2.address}:1`);
  await page.locator('#swap-amount').fill('300');
  await focus('#tab-trade .grid');
  await done('#quote-swap', '获取报价完成');
  await focus('#swap-quote');
  await caption('⑨ 在 Hill DEX 大额卖出 300 TKA，把两边价格推开', '恒定乘积池的价格由储备比决定，大单会明显压低成交价');
  await wait(3000);
  await done('#swap', '兑换完成');
  await done('#refresh', '刷新完成');
  await scrollTo(70);
  await caption('⑩ 刷新后两个池子出现明显价差', '同一时刻 River 与 Hill 的 TKB/TKA 报价不再相同');
  await wait(5600);
  await shot('08-video-spread');
  steps.push({step: 'price-impact'});

  await tab('arbitrage');
  await done('#scan', '扫描套利完成');
  await focus('#arb-quote');
  await caption('⑪ 扫描价差：同时试算两个方向、两种起始代币与 1—200 枚的离散规模', '脚本给出可盈利路线、投入与预期毛利润');
  await wait(4600);
  await page.locator('#min-profit').fill('0.01');
  await done('#execute-arb', '执行原子套利完成');
  await focus('#arb-result');
  await caption('⑫ 一笔交易内完成两次兑换：低价所买入、高价所卖出', '第二腿要求回收 ≥ 本金 + 最低利润，否则整笔回滚');
  await wait(5000);
  await shot('09-video-arbitrage');
  steps.push({step: 'arbitrage'});

  await tab('records');
  await focus('#simulation');
  await caption('⑬ 实验记录：20 个账户 150 次业务操作、套利前后价格、失败回滚收据', '失败的那笔收据状态为 0、日志为空、储备与用户余额均回滚，但 Gas 照付');
  await wait(5600);
  await shot('10-video-records');

  await page.evaluate(() => window.scrollTo({top: document.body.scrollHeight, behavior: 'smooth'}));
  await caption('⑭ 本页面全部交易哈希均可在本地区块链节点查询', 'README 记录了安装、部署、模拟、测试与复现步骤');
  await wait(3800);

  steps.push({step: 'done'});
} catch (error) {
  await caption(`录制中断：${error.message}`);
  await page.screenshot({path: path.join(OUT_DIR, 'demo-failure.png')});
  console.error('Demo failed:', error);
  console.error('Notice:', await page.locator('#notice').innerText().catch(() => 'n/a'));
} finally {
  await wait(600);
  const video = page.video();
  await context.close();
  await browser.close();
  if (video) {
    const src = await video.path();
    const dest = path.join(OUT_DIR, 'amm-dex-demo.webm');
    await fs.copyFile(src, dest);
    await fs.rm(RAW_DIR, {recursive: true, force: true});
    const stat = await fs.stat(dest);
    const summary = {
      video: 'docs/video/amm-dex-demo.webm',
      bytes: stat.size,
      seconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
      viewport: '1280x720',
      browser: channel,
      user: userAddress,
      localAccountIndex: USER_INDEX,
      pageErrors,
      steps,
    };
    await fs.writeFile(path.join(OUT_DIR, 'demo-meta.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  }
}
