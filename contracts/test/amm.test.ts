import { expect } from "chai";
import hre from "hardhat";
const { ethers, networkHelpers } = await hre.network.create();
const E = ethers.parseEther;
const deadline = () => Math.floor(Date.now()/1000)+864000;

describe("AMM / NFT / atomic arbitrage", function () {
  async function fixture() {
    const [owner, user, outsider] = await ethers.getSigners();
    const a = await ethers.deployContract("TestToken", ["Token A", "TKA"]);
    const b = await ethers.deployContract("TestToken", ["Token B", "TKB"]);
    const dex = await ethers.deployContract("MiniDEX", ["DEX One"]);
    const dex2 = await ethers.deployContract("MiniDEX", ["DEX Two"]);
    const arb = await ethers.deployContract("AtomicArbitrage");
    for (const who of [owner,user]) {
      await a.connect(who).faucet(); await b.connect(who).faucet();
      for (const target of [dex,dex2,arb]) {
        await a.connect(who).approve(target,ethers.MaxUint256);
        await b.connect(who).approve(target,ethers.MaxUint256);
      }
    }
    await dex.createPool(a,b); await dex2.createPool(a,b);
    await dex.addLiquidity(1,E("1000"),E("1000"),0,0,deadline());
    await dex2.addLiquidity(1,E("1000"),E("1500"),0,0,deadline());
    return {owner,user,outsider,a,b,dex,dex2,arb};
  }
  it("faucet is per-user and rejects claims during cooldown",async()=>{
    const {a,user,outsider}=await networkHelpers.loadFixture(fixture);
    expect(await a.balanceOf(user)).eq(E("10000"));
    await expect(a.connect(user).faucet()).revertedWith("Faucet cooldown");
    await a.connect(outsider).faucet(); expect(await a.balanceOf(outsider)).eq(E("10000"));
    await networkHelpers.time.increase(3600); await a.connect(user).faucet();
    expect(await a.balanceOf(user)).eq(E("20000"));
  });
  it("rejects duplicate/reversed, identical and non-contract token pairs",async()=>{
    const {a,b,dex,user}=await networkHelpers.loadFixture(fixture);
    await expect(dex.createPool(b,a)).revertedWith("Pool exists");
    await expect(dex.createPool(a,a)).revertedWith("Invalid tokens");
    await expect(dex.createPool(a,user)).revertedWith("Invalid tokens");
  });
  it("mints metadata-bearing NFT and permanently locks initial minimum shares",async()=>{
    const {dex,owner}=await networkHelpers.loadFixture(fixture);
    expect(await dex.ownerOf(1)).eq(owner.address);
    expect((await dex.positions(1)).shares).eq(E("1000")-1000n);
    const uri=await dex.tokenURI(1); const json=JSON.parse(Buffer.from(uri.split(",")[1],"base64").toString());
    expect(json.poolId).eq("1"); expect(BigInt(json.createdAt)).greaterThan(0n);
  });
  it("uses reserve ratio and transfers only optimal deposit amounts",async()=>{
    const {dex,a,b,user}=await networkHelpers.loadFixture(fixture);
    const beforeA=await a.balanceOf(user),beforeB=await b.balanceOf(user);
    await dex.connect(user).addLiquidity(1,E("100"),E("200"),E("100"),E("100"),deadline());
    expect(beforeA-await a.balanceOf(user)).eq(E("100"));
    expect(beforeB-await b.balanceOf(user)).eq(E("100"));
    expect((await dex.positions(2)).shares).eq(E("100"));
  });
  it("swap matches fee formula, increases k and exactly matches token reserves",async()=>{
    const {dex,a,b,user}=await networkHelpers.loadFixture(fixture);
    const before=await dex.pools(1),x=E("10");
    const expected=x*9970n*before.reserveB/(before.reserveA*10000n+x*9970n);
    expect(await dex.quoteSwap(1,a,x)).eq(expected);
    const balance=await b.balanceOf(user);
    await dex.connect(user).swap(1,a,x,expected,deadline());
    const after=await dex.pools(1);
    expect(await b.balanceOf(user)-balance).eq(expected);
    expect(after.reserveA*after.reserveB).greaterThan(before.reserveA*before.reserveB);
    expect(await a.balanceOf(dex)).eq(after.reserveA); expect(await b.balanceOf(dex)).eq(after.reserveB);
  });
  it("reverse swap is priced from reversed reserves",async()=>{
    const {dex,a,b,user}=await networkHelpers.loadFixture(fixture);
    const quote=await dex.quoteSwap(1,b,E("3")); const before=await a.balanceOf(user);
    await dex.connect(user).swap(1,b,E("3"),quote,deadline());
    expect(await a.balanceOf(user)-before).eq(quote);
  });
  it("slippage and deadlines revert without changing reserves",async()=>{
    const {dex,a,user}=await networkHelpers.loadFixture(fixture); const before=await dex.pools(1);
    await expect(dex.connect(user).swap(1,a,E("10"),E("11"),deadline())).revertedWith("Swap slippage");
    await expect(dex.connect(user).swap(1,a,E("10"),0,1)).revertedWith("Expired");
    await expect(dex.connect(user).addLiquidity(1,E("1"),E("1"),E("2"),0,deadline())).revertedWith("Liquidity slippage");
    expect(await dex.pools(1)).deep.eq(before);
  });
  it("cannot redeem another owner's NFT; transfer passes redemption rights",async()=>{
    const {dex,user,outsider,a}=await networkHelpers.loadFixture(fixture);
    await expect(dex.connect(outsider).removeLiquidity(1,0,0,deadline())).revertedWith("Not position owner");
    await dex.transferFrom(await dex.ownerOf(1),user,1);
    const quote=await dex.quoteRemove(1),before=await a.balanceOf(user);
    await dex.connect(user).removeLiquidity(1,quote[0],quote[1],deadline());
    expect(await a.balanceOf(user)-before).eq(quote[0]);
    await expect(dex.ownerOf(1)).revertedWithCustomError(dex,"ERC721NonexistentToken");
    expect((await dex.pools(1)).totalShares).eq(1000n);
  });
  it("fees raise geometric reserve value per share and redemption includes accrued reserves",async()=>{
    const {dex,a,b,user}=await networkHelpers.loadFixture(fixture);
    const p0=await dex.pools(1);await dex.connect(user).swap(1,a,E("100"),0,deadline());
    const p1=await dex.pools(1);expect(p1.totalShares).eq(p0.totalShares);
    expect(p1.reserveA*p1.reserveB).greaterThan(p0.reserveA*p0.reserveB);
    const [qa,qb]=await dex.quoteRemove(1),ba=await a.balanceOf(await dex.ownerOf(1)),bb=await b.balanceOf(await dex.ownerOf(1));
    await dex.removeLiquidity(1,qa,qb,deadline());
    const [owner]=await ethers.getSigners();expect(await a.balanceOf(owner)-ba).eq(qa);expect(await b.balanceOf(owner)-bb).eq(qb);
  });
  it("withdrawal min amounts protect LP from intervening price changes",async()=>{
    const {dex}=await networkHelpers.loadFixture(fixture);
    await expect(dex.removeLiquidity(1,E("1001"),0,deadline())).revertedWith("Withdrawal slippage");
    expect(await dex.ownerOf(1)).not.eq(ethers.ZeroAddress);
  });
  it("one transaction executes both legs and pays exact profit to caller",async()=>{
    const {dex,dex2,arb,a,b,user}=await networkHelpers.loadFixture(fixture);
    const before=await a.balanceOf(user),amount=E("10");
    const mid=await dex2.quoteSwap(1,a,amount);const out=await dex.quoteSwap(1,b,mid);
    const tx=await arb.connect(user).execute(dex2,1,dex,1,a,amount,1,deadline());
    const receipt=await tx.wait();
    expect(await a.balanceOf(user)-before).eq(out-amount);
    expect(receipt!.logs.filter(l=>l.topics[0]===dex.interface.getEvent("Swap")!.topicHash)).length(2);
    expect(await a.balanceOf(arb)).eq(0);expect(await b.balanceOf(arb)).eq(0);
  });
  it("unprofitable second leg rolls back first leg, transfers, allowances and events",async()=>{
    const {dex,dex2,arb,a,b,user}=await networkHelpers.loadFixture(fixture);
    const p1=await dex.pools(1),p2=await dex2.pools(1),balance=await a.balanceOf(user);
    await expect(arb.connect(user).execute(dex,1,dex2,1,a,E("10"),1,deadline())).revertedWith("Swap slippage");
    expect(await dex.pools(1)).deep.eq(p1);expect(await dex2.pools(1)).deep.eq(p2);
    expect(await a.balanceOf(user)).eq(balance);expect(await a.balanceOf(arb)).eq(0);expect(await b.balanceOf(arb)).eq(0);
    expect(await a.allowance(arb,dex)).eq(0);
  });
  it("rejects fake profit targets and same-pool routes",async()=>{
    const {dex,dex2,arb,a,user}=await networkHelpers.loadFixture(fixture);
    await expect(arb.connect(user).execute(dex2,1,dex,1,a,E("10"),E("1000"),deadline())).revertedWith("Swap slippage");
    await expect(arb.connect(user).execute(dex,1,dex,1,a,E("10"),1,deadline())).revertedWith("Same pool");
    await expect(arb.connect(user).execute(dex2,1,dex,1,a,E("10"),0,deadline())).revertedWith("Positive profit required");
  });
  it("separate pools sharing a token preserve per-pool accounting",async()=>{
    const {dex,a,user}=await networkHelpers.loadFixture(fixture);
    const c=await ethers.deployContract("TestToken",["Token C","TKC"]);await c.faucet();await c.approve(dex,E("1000"));
    await dex.createPool(a,c);await dex.addLiquidity(2,E("100"),E("200"),0,0,deadline());
    const p2=await dex.pools(2);await dex.connect(user).swap(1,a,E("10"),0,deadline());
    expect(await dex.pools(2)).deep.eq(p2);
    expect(await a.balanceOf(dex)).eq((await dex.pools(1)).reserveA+p2.reserveA);
  });
});
