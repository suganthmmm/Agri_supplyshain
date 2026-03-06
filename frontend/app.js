// frontend/app.js
// AgriChain — supports Localhost + Sepolia Testnet
// Consumer verify works WITHOUT a wallet (read-only via public RPC)

// ─── CONFIG ───────────────────────────────────────────────────────────────────
// After deploying to Sepolia, paste your contract address here:
const CONTRACT_ADDRESS = "0xDC97bEE04370a0eAc49e3f6e8F19586d0238CF43";// update after Sepolia deploy

// Network config — change to "sepolia" after deploying to Sepolia
const NETWORK_NAME = "sepolia"; // "localhost" or "sepolia"

// Public read-only RPC (no wallet needed for reading data)
const PUBLIC_RPC = {
  localhost: "http://127.0.0.1:8545",
  sepolia:   "https://ethereum-sepolia-rpc.publicnode.com"
};

const CHAIN_IDS = {
  localhost: 31337,
  sepolia:   11155111
};

const EXPLORERS = {
  localhost: "",
  sepolia:   "https://sepolia.etherscan.io/tx/"
};

const ABI = [
  "function registerBatch(string,string,string,uint256,uint256,string,string) returns (uint256)",
  "function updateStatus(uint256,uint8,string,string)",
  "function addImage(uint256,string)",
  "function getBatch(uint256) view returns (tuple(uint256 batchId,string cropName,string farmerName,string farmerLocation,uint256 quantity,uint256 harvestDate,uint8 currentStatus,address registeredBy,uint256 registeredAt,bool exists,string harvestImageCID,string description))",
  "function getStatusHistory(uint256) view returns (tuple(uint8 status,string note,address updatedBy,uint256 timestamp,string imageCID)[])",
  "function getBatchImages(uint256) view returns (string[])",
  "function getTotalBatches() view returns (uint256)",
  "function getAllBatchIds() view returns (uint256[])",
  "event BatchRegistered(uint256 indexed,string,string,uint256,string)",
  "event StatusUpdated(uint256 indexed,uint8,string,address,string)",
  "event ImageAdded(uint256 indexed,string,address)"
];

const STATUS_LABELS = ["Harvested","Processing","In Transit","In Warehouse","At Retailer","Sold"];
const STATUS_ICONS  = ["🌾","⚙️","🚛","🏭","🏪","✅"];
const STATUS_COLORS = ["#4ade80","#facc15","#60a5fa","#a78bfa","#f97316","#34d399"];

// ─── STATE ────────────────────────────────────────────────────────────────────
let provider     = null;
let signer       = null;
let contract     = null;
let readContract = null; // read-only contract (no wallet needed)

// ─── INIT ─────────────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", async () => {
  setupNavigation();
  setupImagePreviews();
  updateWalletUI(false);

  // Set up read-only provider for consumer verify (no wallet needed)
  await setupReadOnlyProvider();

  // Auto-load batch from URL param (QR code scan)
  const params = new URLSearchParams(window.location.search);
  const bid = params.get("batchId");
  if (bid) {
    document.querySelector("[data-tab='verify']").click();
    document.getElementById("ver-id").value = bid;
    await verifyBatchReadOnly(bid); // verify without wallet
  }
});

// ─── READ-ONLY PROVIDER (for consumer QR scan — no wallet needed) ─────────────
async function setupReadOnlyProvider() {
  try {
    const rpc = PUBLIC_RPC[NETWORK_NAME];
    const readProvider = new ethers.JsonRpcProvider(rpc);
    readContract = new ethers.Contract(CONTRACT_ADDRESS, ABI, readProvider);
  } catch (e) {
    console.warn("Read-only provider setup failed:", e);
  }
}

function setupNavigation() {
  document.querySelectorAll("[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
      document.querySelectorAll("[data-tab]").forEach(el => el.classList.remove("active"));
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
      btn.classList.add("active");
    });
  });
}

function setupImagePreviews() {
  const regImg = document.getElementById("reg-image");
  if (regImg) {
    regImg.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const dataUrl = await createImagePreview(file);
      document.getElementById("reg-preview-img").src = dataUrl;
      document.getElementById("reg-img-preview").style.display = "block";
      document.getElementById("reg-cid-status").textContent = "Image selected. Will upload when you register.";
    });
  }
  const updImg = document.getElementById("upd-image");
  if (updImg) {
    updImg.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const dataUrl = await createImagePreview(file);
      document.getElementById("upd-preview-img").src = dataUrl;
      document.getElementById("upd-img-preview").style.display = "block";
      document.getElementById("upd-cid-status").textContent = "Image selected. Will upload when you update.";
    });
  }
}

// ─── WALLET CONNECTION ────────────────────────────────────────────────────────
async function connectWallet() {
  if (!window.ethereum) {
    showAlert("No wallet found! Please install Rabby or MetaMask.", "error");
    return;
  }
  try {
    await window.ethereum.request({ method: "eth_requestAccounts" });
    provider = new ethers.BrowserProvider(window.ethereum);
    signer   = await provider.getSigner();
    contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

    // Check correct network
    const network = await provider.getNetwork();
    const expectedChainId = CHAIN_IDS[NETWORK_NAME];
    if (Number(network.chainId) !== expectedChainId) {
      showAlert(`⚠️ Wrong network! Please switch to ${NETWORK_NAME === "sepolia" ? "Sepolia Testnet" : "Hardhat Local"} in your wallet.`, "error");
      return;
    }

    const address = await signer.getAddress();
    updateWalletUI(true, address, network.name);
    showAlert("✅ Wallet connected: " + shortAddr(address), "success");
    await refreshDashboard();
  } catch (err) {
    showAlert("Connection failed: " + err.message, "error");
  }
}

function updateWalletUI(connected, address = "", network = "") {
  const btn  = document.getElementById("connect-btn");
  const info = document.getElementById("wallet-info");
  if (connected) {
    btn.textContent = "✓ Connected";
    btn.classList.add("connected");
    info.textContent = shortAddr(address) + " · " + network;
  } else {
    btn.textContent = "Connect Wallet";
    btn.classList.remove("connected");
    info.textContent = "No wallet connected";
  }
}

// ─── IPFS UPLOAD ──────────────────────────────────────────────────────────────
async function uploadImageIfSelected(inputId, statusId) {
  const input   = document.getElementById(inputId);
  const statusEl = document.getElementById(statusId);
  if (!input || !input.files[0]) return "";
  const file = input.files[0];
  try {
    statusEl.textContent = "⬆️ Uploading to IPFS...";
    const cid = await uploadToIPFS(file, (msg) => { statusEl.textContent = msg; });
    statusEl.textContent = `✅ IPFS CID: ${shortCID(cid)}`;
    statusEl.style.color = "#4ade80";
    return cid;
  } catch (err) {
    statusEl.textContent = "⚠️ IPFS upload failed: " + err.message;
    statusEl.style.color = "#f97316";
    return "";
  }
}

// ─── REGISTER BATCH ───────────────────────────────────────────────────────────
async function registerBatch() {
  requireWallet();
  const cropName       = val("reg-crop");
  const farmerName     = val("reg-farmer");
  const farmerLocation = val("reg-location");
  const quantity       = parseInt(val("reg-qty"));
  const harvestDate    = new Date(val("reg-date")).getTime() / 1000;
  const description    = val("reg-desc") || "";

  if (!cropName || !farmerName || !farmerLocation || !quantity || !harvestDate) {
    showAlert("Please fill in all required fields.", "error"); return;
  }

  try {
    setBusy("reg-submit", true, "Uploading image...");
    const imageCID = await uploadImageIfSelected("reg-image", "reg-cid-status");

    setBusy("reg-submit", true, "Registering on blockchain...");
    const tx = await contract.registerBatch(
      cropName, farmerName, farmerLocation,
      BigInt(quantity), BigInt(Math.floor(harvestDate)),
      imageCID, description
    );

    showAlert("Transaction sent. Confirming...", "info");
    const receipt = await tx.wait();

    const event = receipt.logs
      .map(l => { try { return contract.interface.parseLog(l); } catch { return null; } })
      .find(e => e?.name === "BatchRegistered");

    const batchId = event ? event.args[0].toString() : "?";

    // Show Etherscan link for Sepolia
    const explorerLink = EXPLORERS[NETWORK_NAME]
      ? `<a href="${EXPLORERS[NETWORK_NAME]}${receipt.hash}" target="_blank" style="color:var(--wheat)">View on Etherscan ↗</a>`
      : "";

    showAlert(`✅ Batch #${batchId} registered on blockchain!`, "success");
    document.getElementById("reg-result").innerHTML = `
      <div class="result-box">
        <strong>✅ Batch #${batchId} Registered!</strong><br/>
        ${imageCID ? `📌 IPFS CID: <code>${shortCID(imageCID)}</code> — <a href="${cidToUrl(imageCID)}" target="_blank" style="color:var(--wheat)">View on IPFS ↗</a><br/>` : ""}
        ${explorerLink}
      </div>`;

    await generateQR(batchId, "qr-output-reg");
    document.getElementById("reg-form").reset();
    document.getElementById("reg-img-preview").style.display = "none";
    document.getElementById("reg-cid-status").textContent = "";
    await refreshDashboard();
  } catch (err) {
    showAlert("Error: " + (err.reason || err.message), "error");
  } finally {
    setBusy("reg-submit", false, "🌾 Register Batch on Blockchain");
  }
}

// ─── UPDATE STATUS ────────────────────────────────────────────────────────────
async function updateStatus() {
  requireWallet();
  const batchId   = val("upd-id");
  const newStatus = parseInt(val("upd-status"));
  const note      = val("upd-note");

  if (!batchId || isNaN(newStatus) || !note) {
    showAlert("Please fill in all fields.", "error"); return;
  }

  try {
    setBusy("upd-submit", true, "Uploading image...");
    const imageCID = await uploadImageIfSelected("upd-image", "upd-cid-status");

    setBusy("upd-submit", true, "Updating on blockchain...");
    const tx = await contract.updateStatus(BigInt(batchId), newStatus, note, imageCID);
    showAlert("Transaction sent...", "info");
    const receipt = await tx.wait();

    const explorerLink = EXPLORERS[NETWORK_NAME]
      ? `<a href="${EXPLORERS[NETWORK_NAME]}${receipt.hash}" target="_blank" style="color:var(--wheat)">View on Etherscan ↗</a>`
      : "";

    showAlert(`✅ Batch #${batchId} → ${STATUS_LABELS[newStatus]}`, "success");
    document.getElementById("upd-result").innerHTML = `
      <div class="result-box">
        <strong>✅ Status Updated!</strong><br/>
        Batch #${batchId} → ${STATUS_ICONS[newStatus]} ${STATUS_LABELS[newStatus]}<br/>
        ${imageCID ? `📌 Photo: <a href="${cidToUrl(imageCID)}" target="_blank" style="color:var(--wheat)">${shortCID(imageCID)} ↗</a><br/>` : ""}
        ${explorerLink}
      </div>`;

    document.getElementById("upd-form").reset();
    document.getElementById("upd-img-preview").style.display = "none";
    document.getElementById("upd-cid-status").textContent = "";
    await refreshDashboard();
  } catch (err) {
    showAlert("Error: " + (err.reason || err.message), "error");
  } finally {
    setBusy("upd-submit", false, "🔄 Update Status");
  }
}

// ─── VERIFY (requires wallet) ─────────────────────────────────────────────────
async function verifyBatch() {
  const batchId = val("ver-id").trim();
  if (!batchId) { showAlert("Enter a Batch ID.", "error"); return; }

  // Use read-only contract if wallet not connected
  const c = contract || readContract;
  if (!c) { showAlert("Unable to connect. Please try again.", "error"); return; }

  try {
    setBusy("ver-submit", true, "Looking up...");
    showAlert("Fetching from blockchain...", "info");

    const [batch, history, images] = await Promise.all([
      c.getBatch(BigInt(batchId)),
      c.getStatusHistory(BigInt(batchId)),
      c.getBatchImages(BigInt(batchId))
    ]);

    renderBatchCard(batch, history, images);
    await generateQR(batchId, "qr-output-ver");
    showAlert("✅ Batch found!", "success");
  } catch (err) {
    showAlert("Batch not found: " + (err.reason || err.message), "error");
    document.getElementById("ver-result").innerHTML = `
      <div class="panel" style="text-align:center;padding:40px">
        <div style="font-size:48px;margin-bottom:16px">❌</div>
        <h3 style="color:var(--rust);margin-bottom:8px">Batch #${batchId} Not Found</h3>
        <p style="color:var(--muted)">This batch does not exist on the blockchain.</p>
      </div>`;
  } finally {
    setBusy("ver-submit", false, "🔍 Verify Batch");
  }
}

// ─── VERIFY READ-ONLY (for QR scan — no wallet) ───────────────────────────────
async function verifyBatchReadOnly(batchId) {
  const c = readContract;
  if (!c) return;
  try {
    document.getElementById("ver-submit").textContent = "Loading...";
    const [batch, history, images] = await Promise.all([
      c.getBatch(BigInt(batchId)),
      c.getStatusHistory(BigInt(batchId)),
      c.getBatchImages(BigInt(batchId))
    ]);
    renderBatchCard(batch, history, images);
    await generateQR(batchId, "qr-output-ver");
  } catch (err) {
    console.error("Read-only verify failed:", err);
  } finally {
    document.getElementById("ver-submit").textContent = "🔍 Verify Batch";
  }
}

// ─── RENDER BATCH CARD ────────────────────────────────────────────────────────
function renderBatchCard(batch, history, images) {
  const status      = Number(batch.currentStatus);
  const harvestDate = new Date(Number(batch.harvestDate) * 1000).toLocaleDateString();
  const regDate     = new Date(Number(batch.registeredAt) * 1000).toLocaleString();

  const harvestImgHTML = batch.harvestImageCID ? `
    <div class="harvest-image-wrap">
      <img src="${cidToUrl(batch.harvestImageCID)}"
           onerror="this.src='';this.parentElement.innerHTML='<p class=img-error>Loading from IPFS...</p>'"
           alt="Harvest photo" class="harvest-img" />
      <div class="ipfs-badge">
        📌 IPFS
        <a href="${cidToUrl(batch.harvestImageCID)}" target="_blank">${shortCID(batch.harvestImageCID)}</a>
      </div>
    </div>` : '<p class="no-image">No harvest photo attached</p>';

  const galleryHTML = images.length > 0 ? `
    <h3 class="section-title">🖼️ Photo Gallery (${images.length} images on IPFS)</h3>
    <div class="image-gallery">
      ${images.map((cid, i) => `
        <div class="gallery-item">
          <img src="${cidToUrl(cid)}" onerror="this.src=''" alt="Photo ${i+1}" />
          <div class="gallery-caption"><a href="${cidToUrl(cid)}" target="_blank">📌 ${shortCID(cid)}</a></div>
        </div>`).join("")}
    </div>` : "";

  const timelineHTML = history.map((h, i) => {
    const s    = Number(h.status);
    const date = new Date(Number(h.timestamp) * 1000).toLocaleString();
    const imgHTML = h.imageCID ? `
      <div class="timeline-img-wrap">
        <img src="${cidToUrl(h.imageCID)}" onerror="this.parentElement.style.display='none'" class="timeline-img" />
        <a href="${cidToUrl(h.imageCID)}" target="_blank" class="ipfs-link">📌 ${shortCID(h.imageCID)}</a>
      </div>` : "";
    return `
      <div class="timeline-item ${i === history.length - 1 ? "active" : ""}">
        <div class="timeline-dot" style="background:${STATUS_COLORS[s]}">${STATUS_ICONS[s]}</div>
        <div class="timeline-content">
          <strong>${STATUS_LABELS[s]}</strong>
          <span class="timeline-date">${date}</span>
          <p>${h.note}</p>
          <small>By: ${shortAddr(h.updatedBy)}</small>
          ${imgHTML}
        </div>
      </div>`;
  }).join("");

  // Etherscan link for Sepolia
  const explorerHTML = EXPLORERS[NETWORK_NAME]
    ? `<a href="https://sepolia.etherscan.io/address/${CONTRACT_ADDRESS}" target="_blank" class="ipfs-link" style="padding:0 24px 12px;display:block">🔍 View Contract on Etherscan ↗</a>`
    : "";

  document.getElementById("ver-result").innerHTML = `
    <div class="batch-card">
      <div class="batch-header">
        <div>
          <h2>${batch.cropName} <span class="batch-id">#${batch.batchId}</span></h2>
          <p>Farmer: <strong>${batch.farmerName}</strong> · ${batch.farmerLocation}</p>
          ${batch.description ? `<p class="batch-desc">${batch.description}</p>` : ""}
        </div>
        <div class="status-badge" style="background:${STATUS_COLORS[status]}20;border-color:${STATUS_COLORS[status]};color:${STATUS_COLORS[status]}">
          ${STATUS_ICONS[status]} ${STATUS_LABELS[status]}
        </div>
      </div>
      <div class="batch-image-section">${harvestImgHTML}</div>
      <div class="batch-meta">
        <div class="meta-item"><label>Quantity</label><span>${Number(batch.quantity).toLocaleString()} kg</span></div>
        <div class="meta-item"><label>Harvest Date</label><span>${harvestDate}</span></div>
        <div class="meta-item"><label>Registered On</label><span>${regDate}</span></div>
        <div class="meta-item"><label>Registered By</label><span>${shortAddr(batch.registeredBy)}</span></div>
        <div class="meta-item"><label>Photos on IPFS</label><span>${images.length} image${images.length !== 1 ? "s" : ""}</span></div>
        <div class="meta-item"><label>Network</label><span>${NETWORK_NAME === "sepolia" ? "Sepolia Testnet" : "Local"}</span></div>
      </div>
      ${explorerHTML}
      <h3 class="section-title">📜 Supply Chain History</h3>
      <div class="timeline">${timelineHTML}</div>
      ${galleryHTML}
    </div>`;
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
async function refreshDashboard() {
  const c = contract || readContract;
  if (!c) return;
  try {
    const ids = await c.getAllBatchIds();
    document.getElementById("stat-total").textContent = ids.length;
    if (ids.length === 0) {
      document.getElementById("dash-list").innerHTML = "<p class='empty'>No batches registered yet.</p>";
      return;
    }
    const recentIds   = [...ids].reverse().slice(0, 10);
    const batchesData = await Promise.all(recentIds.map(id => c.getBatch(id)));

    let sold = 0, inTransit = 0, withImages = 0;
    batchesData.forEach(b => {
      if (Number(b.currentStatus) === 5) sold++;
      if (Number(b.currentStatus) === 2) inTransit++;
      if (b.harvestImageCID) withImages++;
    });
    document.getElementById("stat-sold").textContent    = sold;
    document.getElementById("stat-transit").textContent = inTransit;
    document.getElementById("stat-images").textContent  = withImages;

    const rows = batchesData.map(b => {
      const s     = Number(b.currentStatus);
      const thumb = b.harvestImageCID
        ? `<img src="${cidToUrl(b.harvestImageCID)}" class="dash-thumb" onerror="this.style.display='none'" />`
        : `<div class="dash-thumb-empty">🌾</div>`;
      return `
        <tr class="batch-row" onclick="quickVerify(${b.batchId})">
          <td>${thumb}</td>
          <td><strong>#${b.batchId}</strong></td>
          <td>${b.cropName}</td>
          <td>${b.farmerName}</td>
          <td>${Number(b.quantity).toLocaleString()} kg</td>
          <td><span class="pill" style="background:${STATUS_COLORS[s]}20;color:${STATUS_COLORS[s]};border:1px solid ${STATUS_COLORS[s]}">${STATUS_ICONS[s]} ${STATUS_LABELS[s]}</span></td>
          <td>${b.harvestImageCID ? `<a href="${cidToUrl(b.harvestImageCID)}" target="_blank" class="ipfs-link">📌 IPFS</a>` : "—"}</td>
        </tr>`;
    }).join("");

    document.getElementById("dash-list").innerHTML = `
      <table class="batch-table">
        <thead><tr><th>Photo</th><th>ID</th><th>Crop</th><th>Farmer</th><th>Qty</th><th>Status</th><th>IPFS</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (err) { console.error("Dashboard error:", err); }
}

async function quickVerify(batchId) {
  document.getElementById("ver-id").value = batchId;
  document.querySelector("[data-tab='verify']").click();
  await verifyBatch();
}

// ─── QR CODE ─────────────────────────────────────────────────────────────────
async function generateQR(batchId, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.style.display = "flex";
  container.innerHTML = "";

  // Use current page URL so it works on both localhost and Vercel
  const base = window.location.origin + window.location.pathname;
  const url  = `${base}?batchId=${batchId}`;

  try {
    new QRCode(container, { text: url, width: 180, height: 180, colorDark: "#1a1208", colorLight: "#f5edd8" });
    const label = document.createElement("p");
    label.textContent = `Batch #${batchId}`;
    label.className = "qr-label";
    container.appendChild(label);

    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.textContent = "🔗 Open Batch URL";
    link.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--wheat);";
    container.appendChild(link);
  } catch(e) {
    container.innerHTML = `<p class="qr-url">${url}</p>`;
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function val(id)       { return document.getElementById(id)?.value || ""; }
function shortAddr(a)  { return a ? a.slice(0,6)+"…"+a.slice(-4) : ""; }
function requireWallet() {
  if (!contract) { showAlert("Please connect your wallet first.", "error"); throw new Error("No wallet"); }
}
function setBusy(id, busy, label) {
  const el = document.getElementById(id);
  if (el) { el.disabled = busy; el.textContent = label; }
}
function showAlert(msg, type = "info") {
  const el = document.getElementById("global-alert");
  if (!el) return;
  el.className = `alert alert-${type} show`;
  el.textContent = msg;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 5000);
}
