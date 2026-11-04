import hre from "hardhat";
import fs from "node:fs/promises";
import path from "node:path";
const {ethers}=await hre.network.create();
const [deployer]=await ethers.getSigners();
if(!deployer) throw new Error("No deployment signer. For Sepolia, supply DEPLOYER_PRIVATE_KEY and fund that test wallet yourself.");
const network=await ethers.provider.getNetwork();
const txs:any[]=[];
async function mined(tx:any,label:string){const r=await tx.wait();txs.push({label,hash:r.hash,block:r.blockNumber,status:r.status});}
const a=await ethers.deployContract("TestToken",["Course Token A","TKA"]);await a.waitForDeployment();await mined(a.deploymentTransaction(),"deploy Token A");
const b=await ethers.deployContract("TestToken",["Course Token B","TKB"]);await b.waitForDeployment();await mined(b.deploymentTransaction(),"deploy Token B");
const d1=await ethers.deployContract("MiniDEX",["River DEX LP"]);await d1.waitForDeployment();await mined(d1.deploymentTransaction(),"deploy River DEX");
const d2=await ethers.deployContract("MiniDEX",["Hill DEX LP"]);await d2.waitForDeployment();await mined(d2.deploymentTransaction(),"deploy Hill DEX");
const arb=await ethers.deployContract("AtomicArbitrage");await arb.waitForDeployment();await mined(arb.deploymentTransaction(),"deploy AtomicArbitrage");
await mined(await a.faucet(),"deployer faucet A");await mined(await b.faucet(),"deployer faucet B");
const deadline=(await ethers.provider.getBlock("latest"))!.timestamp+3600;
for(const dex of [d1,d2]){
 await mined(await dex.createPool(a,b),"create A/B pool");
 await mined(await a.approve(dex,ethers.parseEther("2000")),"approve seed A");
 await mined(await b.approve(dex,ethers.parseEther("2000")),"approve seed B");
 await mined(await dex.addLiquidity(1,ethers.parseEther("2000"),ethers.parseEther("2000"),0,0,deadline),"seed A/B liquidity");
}
const configuration={chainId:Number(network.chainId),network:network.chainId===31337n?"Local Hardhat":"Sepolia",rpcUrl:network.chainId===31337n?"http://127.0.0.1:8545":"",deployer:deployer.address,blockNumber:txs[0].block,createdAt:new Date().toISOString(),tokens:[{address:await a.getAddress(),symbol:"TKA",decimals:18},{address:await b.getAddress(),symbol:"TKB",decimals:18}],dexes:[{name:"River DEX",address:await d1.getAddress()},{name:"Hill DEX",address:await d2.getAddress()}],arbitrage:await arb.getAddress(),abi:{token:(await hre.artifacts.readArtifact("TestToken")).abi,dex:(await hre.artifacts.readArtifact("MiniDEX")).abi,arbitrage:(await hre.artifacts.readArtifact("AtomicArbitrage")).abi}};
await fs.mkdir("../web/public",{recursive:true});await fs.mkdir("../evidence",{recursive:true});
await fs.writeFile("../web/public/deployment.json",JSON.stringify(configuration,null,2));
await fs.writeFile(`../evidence/deployment-${network.chainId}.json`,JSON.stringify({...configuration,transactions:txs},null,2));
console.log(JSON.stringify({chainId:configuration.chainId,deployer:configuration.deployer,tokens:configuration.tokens,dexes:configuration.dexes,arbitrage:configuration.arbitrage,transactions:txs.length},null,2));
