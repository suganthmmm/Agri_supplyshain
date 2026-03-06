// scripts/deploy.js
// Local:   npx hardhat run scripts/deploy.js --network localhost
// Sepolia: npx hardhat run scripts/deploy.js --network sepolia

const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network    = hre.network.name;

  console.log("\n🌾 AgriChain Deployment");
  console.log("========================");
  console.log("Network:         ", network);
  console.log("Deployer address:", deployer.address);
  console.log(
    "Account balance:",
    hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)),
    "ETH\n"
  );

  // ── Deploy ──────────────────────────────────────────────────────────────
  const AgriChain = await hre.ethers.getContractFactory("AgriChain");
  console.log("Deploying AgriChain...");
  const agriChain = await AgriChain.deploy();
  await agriChain.waitForDeployment();

  const address = await agriChain.getAddress();
  console.log("✅ AgriChain deployed to:", address);

  // ── Seed demo data ───────────────────────────────────────────────────────
  console.log("\n📦 Seeding demo batches...");
  const now = Math.floor(Date.now() / 1000);

  const tx1 = await agriChain.registerBatch(
    "Organic Wheat", "Ravi Kumar", "Punjab, India",
    5000, now - 7 * 24 * 3600, "", "Grade A organic wheat, sun-dried"
  );
  await tx1.wait();
  console.log("  Batch 1: Organic Wheat registered");

  const tx2 = await agriChain.registerBatch(
    "Basmati Rice", "Sunita Devi", "Haryana, India",
    3200, now - 4 * 24 * 3600, "", "Premium long grain basmati"
  );
  await tx2.wait();
  console.log("  Batch 2: Basmati Rice registered");

  const tx3 = await agriChain.updateStatus(1, 2, "Loaded onto truck — heading to Mumbai warehouse", "");
  await tx3.wait();
  console.log("  Batch 1 → In Transit");

  const tx4 = await agriChain.updateStatus(1, 3, "Arrived at Mumbai Central Warehouse", "");
  await tx4.wait();
  console.log("  Batch 1 → In Warehouse");

  const tx5 = await agriChain.updateStatus(1, 4, "Delivered to FreshMart Retail, Andheri", "");
  await tx5.wait();
  console.log("  Batch 1 → At Retailer");

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n📋 Deployment Summary");
  console.log("  Contract address:", address);
  console.log("  Network:         ", network);
  console.log("  Chain ID:        ", (await hre.ethers.provider.getNetwork()).chainId.toString());

  if (network === "sepolia") {
    console.log("\n🌐 View on Etherscan:");
    console.log(`  https://sepolia.etherscan.io/address/${address}`);
    console.log("\n📝 Next steps:");
    console.log("  1. Copy the contract address above");
    console.log("  2. Open frontend/app.js");
    console.log("  3. Replace CONTRACT_ADDRESS with:", address);
    console.log("  4. Also set NETWORK_NAME to 'sepolia'");
    console.log("  5. Upload frontend/ folder to Vercel");
  } else {
    console.log("\n💡 For local testing:");
    console.log("  Paste this address into frontend/app.js → CONTRACT_ADDRESS");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(error); process.exit(1); });
