import hre from "hardhat";
import fs from "node:fs/promises";
const {ethers}=await hre.network.create();
if((await ethers.provider.getNetwork()).chainId!==31337n)throw new Error("20-user simulation is local-only. It uses unlocked development accounts.");
const config=JSON.parse(await fs.readFile("../web/public/deployment.json","utf8"));
const users=(await ethers.getSigners()).slice(0,20);
if(users.length!==20)throw new Error("20 unlocked local accounts required");
const a:any=await ethers.getContractAt("TestToken",config.tokens[0].address);
const b:any=await ethers.getContractAt("TestToken",config.tokens[1].address);
const dexes:any[]=await Promise.all(config.dexes.map((d:any)=>ethers.getContractAt("MiniDEX",d.address)));
const arb:any=await ethers.getContractAt("AtomicArbitrage",config.arbitrage);
const E=ethers.parseEther;const fmt=ethers.formatEther;
const records:any[]=[];let seed=20261031;
function random(n:number){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed>>>8)%n;}
async function deadline(){return (await ethers.provider.getBlock("latest"))!.timestamp+3600;}
async function send(tx:any,action:string,user:string,extra:any={}){const r=await tx.wait();records.push({action,user,...extra,hash:r.hash,block:r.blockNumber,status:r.status,gasUsed:r.gasUsed.toString()});return r;}
async function snapshot(){return Promise.all(dexes.map(async(d:any,i:number)=>{const p=await d.pools(1);return {dex:config.dexes[i].name,reserveA:fmt(p.reserveA),reserveB:fmt(p.reserveB),rawA:p.reserveA.toString(),rawB:p.reserveB.toString(),shares:p.totalShares.toString(),priceBperA:Number(fmt(p.reserveB))/Number(fmt(p.reserveA))};}));}
const startedAt=(await ethers.provider.getBlock("latest"))!.timestamp;
const start=await snapshot();
for(let i=0;i<20;i++){
 const user=users[i],dexIndex=random(2),dex=dexes[dexIndex];
 const now=(await ethers.provider.getBlock("latest"))!.timestamp;
 for(const token of [a,b]){
  if(await token.nextClaim(user.address)<=BigInt(now))await send(await token.connect(user).faucet(),"faucet",user.address,{token:await token.symbol()});
  for(const d of dexes)await send(await token.connect(user).approve(d,ethers.MaxUint256),"approve",user.address);
 }
 const amount=E(String(15+random(40))),token=random(2)?a:b;
 const quote=await dex.quoteSwap(1,token,amount);
 await send(await dex.connect(user).swap(1,token,amount,quote*99n/100n,await deadline()),"swap",user.address,{dex:dexIndex,tokenIn:await token.symbol(),amountIn:fmt(amount),amountOut:fmt(quote)});
 const supply=E(String(30+random(30))),id=await dex.nextPositionId();
 const [aa,bb]=await dex.quoteAdd(1,supply,supply);
 await send(await dex.connect(user).addLiquidity(1,supply,supply,aa*99n/100n,bb*99n/100n,await deadline()),"add",user.address,{dex:dexIndex,nft:id.toString(),amountA:fmt(aa),amountB:fmt(bb)});
 if(i%2===0){const [qa,qb]=await dex.quoteRemove(id);await send(await dex.connect(user).removeLiquidity(id,qa,qb,await deadline()),"remove",user.address,{dex:dexIndex,nft:id.toString(),amountA:fmt(qa),amountB:fmt(qb)});}
 console.log(`user ${i+1}/20 ${user.address}: swap + add${i%2===0?" + remove":""}`);
}
// Continue for 100 seeded operations. Advance local chain time, without wall-clock sleeps.
for(let step=0;step<100;step++){
 await ethers.provider.send("evm_increaseTime",[30]);
 const user=users[random(20)],dexIndex=random(2),dex=dexes[dexIndex];
 let action=random(3);
 if(action===2){
  const candidates:bigint[]=[];
  for(let id=2n;id<await dex.nextPositionId();id++){
   const pos=await dex.positions(id);
   if(pos.shares>0n&&(await dex.ownerOf(id)).toLowerCase()===user.address.toLowerCase())candidates.push(id);
  }
  if(candidates.length){const id=candidates[random(candidates.length)],[qa,qb]=await dex.quoteRemove(id);
   await send(await dex.connect(user).removeLiquidity(id,qa,qb,await deadline()),"remove",user.address,{phase:"continued",step,dex:dexIndex,nft:id.toString(),amountA:fmt(qa),amountB:fmt(qb)});
  }else action=0;
 }
 if(action===0){const token=random(2)?a:b,amount=E(String(1+random(30))),quote=await dex.quoteSwap(1,token,amount);
  await send(await dex.connect(user).swap(1,token,amount,quote*99n/100n,await deadline()),"swap",user.address,{phase:"continued",step,dex:dexIndex,tokenIn:await token.symbol(),amountIn:fmt(amount),amountOut:fmt(quote)});
 }else if(action===1){const supply=E(String(10+random(20))),id=await dex.nextPositionId(),[aa,bb]=await dex.quoteAdd(1,supply,supply);
  await send(await dex.connect(user).addLiquidity(1,supply,supply,aa*99n/100n,bb*99n/100n,await deadline()),"add",user.address,{phase:"continued",step,dex:dexIndex,nft:id.toString(),amountA:fmt(aa),amountB:fmt(bb)});
 }
}
console.log("100 additional random operations completed across 50 minutes of advanced local-chain time.");
const afterUsers=await snapshot();
// A disclosed extra user trade ensures an observable spread after seeded random activity.
const trader=users[19];await send(await dexes[1].connect(trader).swap(1,a,E("350"),0,await deadline()),"price-impact-trade",trader.address,{dex:1,amountIn:"350",tokenIn:"TKA"});
let best:any=null;
for(const buy of [0,1])for(const token of [a,b])for(const size of [1,2,5,10,20,50,100,150,200]){
 const amount=E(String(size)),midToken=(await token.getAddress())===await a.getAddress()?b:a;
 const mid=await dexes[buy].quoteSwap(1,token,amount);const out=await dexes[1-buy].quoteSwap(1,midToken,mid);
 if(!best||out-amount>best.profit)best={buy,sell:1-buy,token,amount,out,profit:out-amount};
}
if(best.profit<=0n)throw new Error("No profitable route found");
await send(await best.token.connect(trader).approve(arb,best.amount*2n),"approve-arbitrage",trader.address);
const before=await snapshot(),beforeBalance=await best.token.balanceOf(trader);
const receipt=await send(await arb.connect(trader).execute(dexes[best.buy],1,dexes[best.sell],1,best.token,best.amount,best.profit*95n/100n,await deadline()),"arbitrage",trader.address);
const after=await snapshot(),afterBalance=await best.token.balanceOf(trader);
if(afterBalance-beforeBalance!==best.profit)throw new Error("Profit accounting mismatch");
const swaps=receipt.logs.filter((l:any)=>l.topics[0]===dexes[0].interface.getEvent("Swap").topicHash);
if(swaps.length!==2)throw new Error("Expected two swaps in same receipt");
const rollbackBefore=await snapshot(),balanceBefore=await best.token.balanceOf(trader);let failure:any;
try{
 const tx=await arb.connect(trader).execute(dexes[0],1,dexes[1],1,best.token,E("1"),E("1000000"),await deadline(),{gasLimit:2000000});
 const r=await tx.wait();throw new Error(`Unexpected success ${r.hash}`);
}catch(error:any){
 failure={hash:error.receipt?.hash??error.data?.txHash??null,status:error.receipt?.status??null,eventCount:error.receipt?.logs?.length??null,gasUsed:error.receipt?.gasUsed?.toString()??null,reason:error.shortMessage??error.message};
 if(String(error.message).includes("Unexpected success"))throw error;
}
if(failure.status!==0||!failure.hash||failure.eventCount!==0)throw new Error("Expected a mined reverted transaction with no surviving events");
const rollbackAfter=await snapshot();
if(JSON.stringify(rollbackBefore)!==JSON.stringify(rollbackAfter)||await best.token.balanceOf(trader)!==balanceBefore)throw new Error("Rollback failed");
for(const token of [a,b]){
 for(const dex of dexes){let sum=0n;for(let id=1;id<=Number(await dex.poolCount());id++){const p=await dex.pools(id);if(p.tokenA.toLowerCase()===(await token.getAddress()).toLowerCase())sum+=p.reserveA;if(p.tokenB.toLowerCase()===(await token.getAddress()).toLowerCase())sum+=p.reserveB;}
 if(await token.balanceOf(dex)!==sum)throw new Error("Reserve mismatch");}
}
const output={network:"Local Hardhat",chainId:31337,seed:20261031,continuedSteps:100,advancedChainTimeSeconds:3000,elapsedChainTimeSeconds:(await ethers.provider.getBlock("latest"))!.timestamp-startedAt,users:users.map(u=>u.address),start,afterUsers,transactionCount:records.length,actions:{swaps:records.filter(r=>r.action==="swap").length,adds:records.filter(r=>r.action==="add").length,removes:records.filter(r=>r.action==="remove").length},arbitrage:{route:[config.dexes[best.buy].name,config.dexes[best.sell].name],token:await best.token.symbol(),amountIn:fmt(best.amount),amountOut:fmt(best.out),profit:fmt(best.profit),beforeBalance:fmt(beforeBalance),afterBalance:fmt(afterBalance),before,after,transactionHash:receipt.hash,block:receipt.blockNumber,swapEventsInSameReceipt:swaps.length,gasUsed:receipt.gasUsed.toString(),gasCostETH:fmt(receipt.gasUsed*receipt.gasPrice),profitIncludesGas:false},rollback:{...failure,poolsUnchanged:true,tokenBalanceUnchanged:true,before:rollbackBefore,after:rollbackAfter},reserveAudit:"passed",records};
await fs.writeFile("../evidence/simulation.json",JSON.stringify(output,null,2));await fs.writeFile("../web/public/simulation.json",JSON.stringify(output,null,2));
console.log(JSON.stringify({users:20,actions:output.actions,profit:output.arbitrage.profit,token:output.arbitrage.token,rollback:output.rollback},null,2));
