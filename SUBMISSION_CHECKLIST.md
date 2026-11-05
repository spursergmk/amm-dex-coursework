# 提交清单

作业要求：**GitHub 仓库链接 + 项目视频（压缩后）发到 hinsliu@zju.edu.cn，主题为「学号_姓名_作业2」**，截止 11 月 6 日。

## 一、代码与文档（已完成）

| 作业条目 | 交付物 | 状态 |
|---|---|---|
| 1. ERC20 创建 + 多用户领取 | `contracts/contracts/TestToken.sol`，TKA / TKB，`faucet()` 每地址每小时 10,000 枚 | 完成 |
| 2. AMM 交易池（恒定乘积 + 手续费） | `contracts/contracts/MiniDEX.sol`，任意标准 ERC20 建池、双向兑换、0.30% 手续费留存储备 | 完成 |
| 3. 提供/移除流动性 + ERC721 凭证 | 同一 `MiniDEX` 即 ERC721，记录池号、份额、首次投入、创建时间、原始提供者；销毁 NFT 赎回 | 完成 |
| 4. 多用户持续模拟 | `contracts/scripts/simulate.ts`，20 个地址、150 次业务操作、固定随机种子 | 完成 |
| 5. Bonus 多交易所价差 | River DEX / Hill DEX 两个独立部署，同一 TKA/TKB 对不同池、不同价格 | 完成 |
| 5. Bonus 原子套利 | `contracts/contracts/AtomicArbitrage.sol`，单笔交易两腿兑换，第二腿 `minOut = 本金 + 最低利润`，失败整笔回滚 | 完成 |
| README（介绍、功能、运行步骤、Bonus 说明与结果） | `README.md` | 完成 |
| 关键界面与钱包/链上交互截图 | `docs/screenshots/01—06.png`，均由浏览器实际操作后截图 | 完成（可重拍） |
| 实验报告 | `docs/实验报告.pdf`（6 页，由 `evidence/` 真实数据生成） | 完成 |
| 1–2 分钟演示视频 | `docs/video/amm-dex-demo.mp4`（H.264，1280×720，86 秒，3.4 MB，无字幕），原始录制 `amm-dex-demo.webm` | 完成 |

## 二、需要你本人填写的

- [ ] `README.md` 第 5 行：`**姓名：待填写　学号：待填写**`
- [ ] `README.md` 末尾「参考资料」前一段的姓名学号
- [ ] `web/scripts/report.mjs` 第 11 行：`<p class="author">姓名：待填写　　学号：待填写</p>`，改完重新生成 PDF
- [ ] 公开 GitHub 仓库地址（README 中「参考课程框架」处可补一行本项目仓库链接）

## 三、录制视频的命令

```powershell
# 终端一：本地链（保持运行）
npm run node

# 终端二
npm run deploy
npm run simulate
npm run dev

# 终端三：录屏（需要先跑过一次 npm run setup）
cd web
npx playwright install chromium
cd ..
npm run demo
```

产物：

- `docs/video/amm-dex-demo.mp4` —— H.264，1280×720，86 秒，3.4 MB，无字幕（建议作为提交文件）
- `docs/video/amm-dex-demo.webm` —— 同一段录制的原始文件，6.7 MB
- `docs/video/demo-meta.json` —— 录制时间轴、使用的账户、页面错误（本次为 0）
- `docs/video/07—10-*.png` —— 录制过程中的关键帧截图

想加快节奏可以用 `$env:DEMO_SPEED=2`；想换演示账户用 `$env:DEMO_USER=3`（对应「用户 04」）。

webm 转 mp4（需要带 libx264 的 ffmpeg；Playwright 自带的精简版没有该编码器）：

```powershell
ffmpeg -i docs/video/amm-dex-demo.webm -c:v libx264 -crf 24 -pix_fmt yuv420p -movflags +faststart -an docs/video/amm-dex-demo.mp4
```

## 四、提交前自检

```powershell
npm test          # 合约单元测试 + 类型检查 + 前端构建
npm run test:e2e  # 浏览器流程（会真实发交易、创建 TKC 池、推进链时间）
npm run verify    # 链上核查：储备=余额、份额=NFT+锁定、字节码一致
python scripts/package.py   # 生成 AMM_DEX作业_完整材料.zip 与 SHA256
```

提交邮件附件建议同时压缩视频，邮件主题与视频文件名都用 `学号_姓名_作业2`。

## 五、说明（写进报告或答辩时可用）

- 运行网络是**本地 Hardhat 链（Chain ID 31337）**，不是公开测试网。题目要求「在网站前端」操作，未指定必须公开部署；`npm run deploy:sepolia` 为可选脚本，需要你自己的测试钱包。
- 浏览器中的「本地账户」入口只在本机 `31337` 时出现，等价于 MetaMask 连接本地网络；连接 MetaMask 的路径已在 README 2 节说明。
- 水龙头、兑换、注资、赎回、套利全部发送真实交易，页面展示的交易哈希可在本地节点查询；截图不是设计稿。
- 模拟中的「链上时间跨度 3174 秒」是手动 `evm_increaseTime` 推进的结果，不是真实等待 53 分钟，也不是并发压力测试。
- 套利利润是**起始代币毛利润**，未扣 ETH Gas，不代表现实净收益。
