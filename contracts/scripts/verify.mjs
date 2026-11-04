import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {JsonRpcProvider,Contract,parseEther} from 'ethers';
const config=JSON.parse(await fs.readFile('../web/public/deployment.json','utf8'));
const sim=JSON.parse(await fs.readFile('../evidence/simulation.json','utf8'));
const browser=JSON.parse(await fs.readFile('../evidence/browser-checks.json','utf8'));
const deployed=JSON.parse(await fs.readFile('../evidence/deployment-31337.json','utf8'));
const provider=new JsonRpcProvider(config.rpcUrl);
assert.equal(Number((await provider.getNetwork()).chainId),31337);
const checks=[];
assert.equal(new Set(sim.users).size,20);
for(const user of sim.users){assert.ok(sim.records.some(r=>r.user===user&&r.action==='swap'));assert.ok(sim.records.some(r=>r.user===user&&r.action==='add'));}
checks.push('20 unique accounts each performed both swap and deposit');
for(const entry of [...deployed.transactions,...sim.records,...browser.transactions,...browser.setup]){
 const receipt=await provider.getTransactionReceipt(entry.hash);assert.ok(receipt);assert.equal(receipt.status,1);
}
checks.push('all deployment, simulation and browser transaction receipts exist and succeeded');
const fail=await provider.getTransactionReceipt(sim.rollback.hash);assert.equal(fail.status,0);assert.equal(fail.logs.length,0);
assert.deepEqual(sim.rollback.before,sim.rollback.after);assert.equal(sim.rollback.tokenBalanceUnchanged,true);
checks.push('failed arbitrage has mined status 0 and no surviving events; captured states are equal');
const arb=new Contract(config.arbitrage,config.abi.arbitrage,provider);
const arbReceipt=await provider.getTransactionReceipt(sim.arbitrage.transactionHash);
const event=arbReceipt.logs.map(l=>{try{return arb.interface.parseLog(l);}catch{return null;}}).find(e=>e?.name==='ArbitrageExecuted');
assert.equal(event.args.profit,parseEther(sim.arbitrage.profit));assert.equal(event.args.amountOut-event.args.amountIn,event.args.profit);
const swapTopic=new Contract(config.dexes[0].address,config.abi.dex,provider).interface.getEvent('Swap').topicHash;
assert.equal(arbReceipt.logs.filter(l=>l.topics[0]===swapTopic).length,2);
checks.push('one arbitrage receipt contains two swaps and exactly the reported profit');
const poolChecks=[];
for(const dc of config.dexes){const dex=new Contract(dc.address,config.abi.dex,provider),totals=new Map(),shares=new Map();
 for(let id=1;id<Number(await dex.nextPositionId());id++){const p=await dex.positions(id);if(p.shares>0n){await dex.ownerOf(id);shares.set(Number(p.poolId),(shares.get(Number(p.poolId))??0n)+p.shares);const metadata=JSON.parse(Buffer.from((await dex.tokenURI(id)).split(',')[1],'base64').toString());assert.equal(metadata.shares,p.shares.toString());}}
 for(let id=1;id<=Number(await dex.poolCount());id++){const p=await dex.pools(id);totals.set(p.tokenA,(totals.get(p.tokenA)??0n)+p.reserveA);totals.set(p.tokenB,(totals.get(p.tokenB)??0n)+p.reserveB);assert.equal(p.totalShares,(shares.get(id)??0n)+(p.totalShares===0n?0n:1000n));poolChecks.push({dex:dc.name,pool:id,totalShares:p.totalShares.toString(),activeNFTShares:(shares.get(id)??0n).toString()});}
 for(const [address,reserve] of totals){assert.equal(await new Contract(address,config.abi.token,provider).balanceOf(dc.address),reserve);}
}
checks.push('all pools: token balances equal summed reserves and NFT shares plus locked minimum equal total shares');
for(const [name,addresses] of [['MiniDEX',config.dexes.map(d=>d.address)],['TestToken',config.tokens.map(t=>t.address)],['AtomicArbitrage',[config.arbitrage]]]){const artifact=JSON.parse(await fs.readFile(`artifacts/contracts/${name}.sol/${name}.json`,'utf8'));for(const address of addresses)assert.equal(await provider.getCode(address),artifact.deployedBytecode);}
checks.push('deployed contract runtime bytecode exactly matches compiled artifacts');
assert.equal(browser.passed,10);assert.deepEqual(browser.pageErrors,[]);checks.push('10 browser flows passed with no page JavaScript errors');
const result={passed:checks.length,checks,chainId:31337,checkedAt:new Date().toISOString(),block:Number(await provider.send('eth_blockNumber',[])),successfulReceipts:deployed.transactions.length+sim.records.length+browser.transactions.length+browser.setup.length,failedArbitrage:{hash:fail.hash,status:fail.status,events:fail.logs.length},pools:poolChecks};
await fs.writeFile('../evidence/final-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
