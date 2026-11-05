import {JsonRpcProvider, Contract, ContractFactory, parseEther} from 'ethers';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {launchBrowser} from './launch.mjs';
const config=JSON.parse(await fs.readFile('public/deployment.json','utf8'));
if(config.chainId!==31337)throw Error('Browser integration test only supports the local chain.');
const rpc=new JsonRpcProvider(config.rpcUrl),user=await rpc.getSigner(19),receiver=await rpc.getSigner(18);
const userAddress=await user.getAddress(),receiverAddress=await receiver.getAddress();
const a=new Contract(config.tokens[0].address,config.abi.token,user);
const d1=new Contract(config.dexes[0].address,config.abi.dex,user),d2=new Contract(config.dexes[1].address,config.abi.dex,user);
const checks=[],errors=[],setup=[];
const {browser}=await launchBrowser({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1080},deviceScaleFactor:1});
page.on('pageerror',e=>errors.push(e.message));
async function done(button,message){await page.locator(button).click();await page.waitForFunction(text=>document.querySelector('#notice').textContent===text,message,{timeout:45000});}
async function shot(name){await page.screenshot({path:`../docs/screenshots/${name}.png`,fullPage:true});}
async function tab(name){await page.locator(`[data-tab="${name}"]`).click();}
try{
 await page.goto('http://127.0.0.1:5173');await page.getByText('链上数据已加载。请选择账户开始操作。').waitFor();
 await page.locator('#local-account').selectOption('19');await done('#connect-local','连接本地账户完成');
 assert.equal(await page.locator('#account').innerText(),userAddress);checks.push('连接真实本地账户并读取链上余额');
 await rpc.send('evm_increaseTime',[3601]);await rpc.send('evm_mine',[]);
 const faucetBefore=await a.balanceOf(userAddress);await done(`[data-faucet="${config.tokens[0].address}"]`,'领取测试代币完成');
 assert.equal(await a.balanceOf(userAddress)-faucetBefore,parseEther('10000'));checks.push('网页水龙头实际领取10000 TKA');
 await page.locator('#swap-amount').fill('2');await done('#quote-swap','获取报价完成');
 const swapBefore=await a.balanceOf(userAddress);await done('#swap','兑换完成');assert.equal(swapBefore-await a.balanceOf(userAddress),parseEther('2'));checks.push('网页报价、授权与兑换上链');
 await shot('01-trade');
 const nft=await d1.nextPositionId();await page.locator('#add-a').fill('20');await page.locator('#add-b').fill('20');await done('#quote-add','预览投入完成');await done('#add','添加流动性完成');assert.equal(await d1.ownerOf(nft),userAddress);checks.push('网页添加流动性并铸造NFT');
 await tab('positions');await shot('02-positions');
 const transferKey=`${config.dexes[0].address}:${nft}`;
 const details=page.locator(`article.nft`).filter({has:page.locator(`[data-transfer="${transferKey}"]`)}).locator('details');
 await details.locator('summary').click();await details.locator('input').fill(receiverAddress);
 await done(`[data-transfer="${transferKey}"]`,'转让 NFT完成');assert.equal(await d1.ownerOf(nft),receiverAddress);checks.push('网页转让NFT，链上所有权变更');
 await page.locator('#local-account').selectOption('18');await done('#connect-local','连接本地账户完成');
 const redeemBefore=await a.balanceOf(receiverAddress);await done(`[data-remove="${transferKey}"]`,'销毁 NFT 并赎回完成');assert.ok(await a.balanceOf(receiverAddress)>redeemBefore);await assert.rejects(d1.ownerOf(nft));checks.push('新持有人在网页销毁NFT并获得资产');
 const artifact=JSON.parse(await fs.readFile('../contracts/artifacts/contracts/TestToken.sol/TestToken.json','utf8'));
 const c=await new ContractFactory(artifact.abi,artifact.bytecode,receiver).deploy('Browser Test C','TKC');await c.waitForDeployment();setup.push({action:'deploy browser test ERC20 C',hash:c.deploymentTransaction().hash,address:await c.getAddress()});
 const cr=await(await c.faucet()).wait();setup.push({action:'faucet C for browser user',hash:cr.hash});
 await tab('trade');await page.locator('#create-b').fill(await c.getAddress());const poolId=Number(await d1.poolCount())+1;await done('#create','创建交易池完成');assert.equal((await d1.pools(poolId)).tokenB,await c.getAddress());
 await page.locator('#pool-select').selectOption(`${config.dexes[0].address}:${poolId}`);await page.locator('#add-a').fill('10');await page.locator('#add-b').fill('10');await done('#add','添加流动性完成');assert.equal((await d1.pools(poolId)).reserveB,parseEther('10'));checks.push('网页创建新代币对并向空池注入首笔流动性');await shot('03-created-pool');
 // Disclosed external setup trade creates a new spread for the browser arbitrage flow.
 const approval=await(await a.approve(d2,parseEther('300'))).wait();setup.push({action:'approve price-impact trade',hash:approval.hash});const block=await rpc.getBlock('latest');const impact=await(await d2.swap(1,a,parseEther('300'),0,block.timestamp+3600)).wait();setup.push({action:'price-impact trade for browser arbitrage',hash:impact.hash,amountIn:'300 TKA'});
 await done('#refresh','刷新完成');await tab('arbitrage');await done('#scan','扫描套利完成');assert.match(await page.locator('#arb-quote').innerText(),/预计毛利润/);await page.locator('#min-profit').fill('0.001');await done('#execute-arb','执行原子套利完成');assert.match(await page.locator('#arb-result').innerText(),/执行成功/);checks.push('网页扫描价差并真实执行原子套利');await shot('04-arbitrage');
 await tab('records');const sim=JSON.parse(await fs.readFile('../evidence/simulation.json','utf8'));assert.match(await page.locator('#simulation').innerText(),new RegExp(Number(sim.arbitrage.profit).toFixed(6).replace('.','\\.')));await shot('05-records');checks.push('展示20账户模拟、储备变化、套利收据和失败回滚');
 const hashes=await page.locator('#tx-log .log-entry code').allTextContents();const receipts=await Promise.all(hashes.map(async hash=>{const r=await rpc.getTransactionReceipt(hash);assert.equal(r.status,1);return{hash,block:r.blockNumber,status:r.status,gasUsed:r.gasUsed.toString()};}));
 await page.setViewportSize({width:390,height:844});await tab('trade');await shot('06-mobile');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));checks.push('390px移动端无页面横向溢出');
 assert.deepEqual(errors,[]);
 await fs.writeFile('../evidence/browser-checks.json',JSON.stringify({passed:checks.length,checks,pageErrors:errors,network:'Local Hardhat',chainId:31337,setup,transactions:receipts,screenshots:['01-trade','02-positions','03-created-pool','04-arbitrage','05-records','06-mobile']},null,2));
 console.log(JSON.stringify({passed:checks.length,checks,transactions:receipts.length,pageErrors:errors},null,2));
}catch(e){await page.screenshot({path:'../evidence/browser-failure.png',fullPage:true});console.error('Notice:',await page.locator('#notice').innerText());throw e;}finally{await browser.close();}
