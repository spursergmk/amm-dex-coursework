// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// @notice Educational full-range x*y=k AMM. Only standard non-rebasing ERC20s are supported.
/// Each deposit mints a transferable NFT representing proportional pool shares.
contract MiniDEX is ERC721, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Strings for uint256;
    uint256 public constant FEE_BPS = 30;
    uint256 public constant BPS = 10_000;
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    struct Pool {
        address tokenA;
        address tokenB;
        uint256 reserveA;
        uint256 reserveB;
        uint256 totalShares;
        uint256 createdAt;
    }
    struct Position {
        uint256 poolId;
        uint256 shares;
        uint256 depositedA;
        uint256 depositedB;
        uint256 createdAt;
        address provider;
    }
    uint256 public poolCount;
    uint256 public nextPositionId = 1;
    mapping(uint256 => Pool) public pools;
    mapping(uint256 => Position) public positions;
    mapping(bytes32 => uint256) public pairToPool;

    event PoolCreated(uint256 indexed poolId, address indexed tokenA, address indexed tokenB, address creator);
    event LiquidityAdded(uint256 indexed poolId, uint256 indexed tokenId, address indexed provider, uint256 amountA, uint256 amountB, uint256 shares);
    event LiquidityRemoved(uint256 indexed poolId, uint256 indexed tokenId, address indexed owner, uint256 amountA, uint256 amountB);
    event Swap(uint256 indexed poolId, address indexed trader, address indexed tokenIn, uint256 amountIn, uint256 amountOut, uint256 fee);

    constructor(string memory name_) ERC721(name_, "LP-NFT") {}

    function createPool(address tokenA, address tokenB) external returns (uint256 poolId) {
        require(tokenA != tokenB && tokenA.code.length > 0 && tokenB.code.length > 0, "Invalid tokens");
        require(tokenA != address(this) && tokenB != address(this), "Invalid tokens");
        bytes32 key = tokenA < tokenB ? keccak256(abi.encode(tokenA, tokenB)) : keccak256(abi.encode(tokenB, tokenA));
        require(pairToPool[key] == 0, "Pool exists");
        poolId = ++poolCount;
        pools[poolId] = Pool(tokenA, tokenB, 0, 0, 0, block.timestamp);
        pairToPool[key] = poolId;
        emit PoolCreated(poolId, tokenA, tokenB, msg.sender);
    }

    function _pool(uint256 id) private view returns (Pool storage p) {
        p = pools[id];
        require(p.tokenA != address(0), "Unknown pool");
    }
    function _deadline(uint256 deadline) private view {
        require(block.timestamp <= deadline, "Expired");
    }
    function _receive(address token, uint256 amount) private {
        uint256 beforeBalance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        require(IERC20(token).balanceOf(address(this)) == beforeBalance + amount, "Unsupported token");
    }

    function quoteAdd(uint256 poolId, uint256 desiredA, uint256 desiredB)
        public view returns (uint256 amountA, uint256 amountB, uint256 shares)
    {
        Pool storage p = _pool(poolId);
        require(desiredA > 0 && desiredB > 0, "Zero amount");
        if (p.totalShares == 0) {
            // Checked multiplication deliberately rejects excessively large deposits.
            uint256 root = Math.sqrt(desiredA * desiredB);
            require(root > MINIMUM_LIQUIDITY, "Small initial deposit");
            return (desiredA, desiredB, root - MINIMUM_LIQUIDITY);
        }
        uint256 optimalB = Math.mulDiv(desiredA, p.reserveB, p.reserveA);
        if (optimalB <= desiredB) { amountA = desiredA; amountB = optimalB; }
        else { amountA = Math.mulDiv(desiredB, p.reserveA, p.reserveB); amountB = desiredB; }
        shares = Math.min(Math.mulDiv(amountA, p.totalShares, p.reserveA), Math.mulDiv(amountB, p.totalShares, p.reserveB));
        require(shares > 0 && amountA > 0 && amountB > 0, "Zero shares");
    }

    function addLiquidity(uint256 poolId, uint256 desiredA, uint256 desiredB, uint256 minA, uint256 minB, uint256 deadline)
        external nonReentrant returns (uint256 tokenId)
    {
        _deadline(deadline);
        Pool storage p = _pool(poolId);
        (uint256 a, uint256 b, uint256 shares) = quoteAdd(poolId, desiredA, desiredB);
        require(a >= minA && b >= minB, "Liquidity slippage");
        _receive(p.tokenA, a); _receive(p.tokenB, b);
        if (p.totalShares == 0) p.totalShares = MINIMUM_LIQUIDITY;
        p.totalShares += shares; p.reserveA += a; p.reserveB += b;
        tokenId = nextPositionId++;
        positions[tokenId] = Position(poolId, shares, a, b, block.timestamp, msg.sender);
        _safeMint(msg.sender, tokenId);
        emit LiquidityAdded(poolId, tokenId, msg.sender, a, b, shares);
    }

    function quoteRemove(uint256 tokenId) public view returns (uint256 amountA, uint256 amountB) {
        _requireOwned(tokenId);
        Position storage position = positions[tokenId];
        Pool storage p = pools[position.poolId];
        return (Math.mulDiv(position.shares, p.reserveA, p.totalShares), Math.mulDiv(position.shares, p.reserveB, p.totalShares));
    }

    function removeLiquidity(uint256 tokenId, uint256 minA, uint256 minB, uint256 deadline) external nonReentrant {
        _deadline(deadline);
        require(ownerOf(tokenId) == msg.sender, "Not position owner");
        Position memory position = positions[tokenId];
        Pool storage p = pools[position.poolId];
        (uint256 a, uint256 b) = quoteRemove(tokenId);
        require(a >= minA && b >= minB, "Withdrawal slippage");
        _burn(tokenId); delete positions[tokenId];
        p.totalShares -= position.shares; p.reserveA -= a; p.reserveB -= b;
        IERC20(p.tokenA).safeTransfer(msg.sender, a); IERC20(p.tokenB).safeTransfer(msg.sender, b);
        emit LiquidityRemoved(position.poolId, tokenId, msg.sender, a, b);
    }

    function quoteSwap(uint256 poolId, address tokenIn, uint256 amountIn) public view returns (uint256 amountOut) {
        Pool storage p = _pool(poolId);
        require(tokenIn == p.tokenA || tokenIn == p.tokenB, "Wrong token");
        require(amountIn > 0 && p.reserveA > 0 && p.reserveB > 0, "No liquidity or amount");
        (uint256 rIn, uint256 rOut) = tokenIn == p.tokenA ? (p.reserveA, p.reserveB) : (p.reserveB, p.reserveA);
        uint256 withFee = amountIn * (BPS - FEE_BPS);
        amountOut = Math.mulDiv(withFee, rOut, rIn * BPS + withFee);
    }

    function swap(uint256 poolId, address tokenIn, uint256 amountIn, uint256 minOut, uint256 deadline)
        external nonReentrant returns (uint256 amountOut)
    {
        _deadline(deadline);
        Pool storage p = _pool(poolId);
        amountOut = quoteSwap(poolId, tokenIn, amountIn);
        require(amountOut > 0 && amountOut >= minOut, "Swap slippage");
        _receive(tokenIn, amountIn);
        address tokenOut;
        if (tokenIn == p.tokenA) { p.reserveA += amountIn; p.reserveB -= amountOut; tokenOut = p.tokenB; }
        else { p.reserveB += amountIn; p.reserveA -= amountOut; tokenOut = p.tokenA; }
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
        emit Swap(poolId, msg.sender, tokenIn, amountIn, amountOut, Math.mulDiv(amountIn, FEE_BPS, BPS));
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        Position memory pos = positions[tokenId];
        string memory json = string.concat('{"name":"Liquidity Position #', tokenId.toString(),
            '","description":"Full-range AMM shares; fees accrue in pool reserves.","poolId":"', pos.poolId.toString(),
            '","shares":"', pos.shares.toString(), '","depositedA":"', pos.depositedA.toString(),
            '","depositedB":"', pos.depositedB.toString(), '","createdAt":"', pos.createdAt.toString(), '"}');
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }
}
