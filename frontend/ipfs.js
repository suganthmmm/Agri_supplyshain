// frontend/ipfs.js
// ─────────────────────────────────────────────────────────────────────────────
// IPFS Upload Helper for AgriChain
//
// WHAT IS IPFS?
//   InterPlanetary File System — a decentralized storage network.
//   Files uploaded to IPFS get a unique Content ID (CID).
//   The same file ALWAYS produces the same CID — so it cannot be swapped.
//   We store the CID on-chain, making image proof tamper-proof forever.
//
// FREE IPFS SERVICES USED:
//   1. nft.storage  — Free, permanent, no account needed for small files
//   2. web3.storage — Free tier available
//   3. Pinata       — Free tier (100 files/month)
//
// FOR THIS PROTOTYPE we use nft.storage's public HTTP API.
// For production, replace with your own API key from https://nft.storage
// ─────────────────────────────────────────────────────────────────────────────

// ── CONFIG ────────────────────────────────────────────────────────────────────

// Option A: Use NFT.Storage (free, get key at https://nft.storage)
const NFT_STORAGE_KEY = "YOUR_NFT_STORAGE_API_KEY_HERE";

// Option B: Use Pinata (free tier, get keys at https://pinata.cloud)
const PINATA_JWT = "YOUR_PINATA_JWT_HERE";

// IPFS public gateway for displaying images
const IPFS_GATEWAY = "https://ipfs.io/ipfs/";

// Fallback gateways if primary is slow
const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://dweb.link/ipfs/"
];

// ── MAIN UPLOAD FUNCTION ──────────────────────────────────────────────────────

/**
 * Upload an image file to IPFS and return the CID.
 * Tries NFT.Storage first, falls back to a mock CID for demo purposes.
 *
 * @param {File} file - The image file to upload
 * @param {Function} onProgress - Callback(message) for status updates
 * @returns {Promise<string>} - The IPFS CID
 */
async function uploadToIPFS(file, onProgress = () => {}) {
  if (!file) throw new Error("No file provided");

  // Validate file type
  if (!file.type.startsWith("image/")) {
    throw new Error("Only image files are supported");
  }

  // Validate file size (max 10MB)
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("File too large. Maximum size is 10MB");
  }

  onProgress("Preparing image for upload...");

  // Try NFT.Storage if key is configured
  if (NFT_STORAGE_KEY && NFT_STORAGE_KEY !== "YOUR_NFT_STORAGE_API_KEY_HERE") {
    try {
      return await uploadViaNFTStorage(file, onProgress);
    } catch (e) {
      console.warn("NFT.Storage failed, trying Pinata...", e);
    }
  }

  // Try Pinata if JWT is configured
  if (PINATA_JWT && PINATA_JWT !== "YOUR_PINATA_JWT_HERE") {
    try {
      return await uploadViaPinata(file, onProgress);
    } catch (e) {
      console.warn("Pinata failed, using demo mode...", e);
    }
  }

  // Demo mode: generate a fake-but-realistic looking CID
  onProgress("Demo mode: generating mock IPFS CID...");
  return await generateDemoCID(file);
}

// ── NFT.STORAGE UPLOAD ────────────────────────────────────────────────────────

async function uploadViaNFTStorage(file, onProgress) {
  onProgress("Uploading to NFT.Storage (IPFS)...");

  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("https://api.nft.storage/upload", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${NFT_STORAGE_KEY}`
    },
    body: formData
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`NFT.Storage error: ${err}`);
  }

  const data = await response.json();
  const cid = data.value.cid;
  onProgress(`✅ Uploaded to IPFS! CID: ${cid.slice(0, 16)}...`);
  return cid;
}

// ── PINATA UPLOAD ─────────────────────────────────────────────────────────────

async function uploadViaPinata(file, onProgress) {
  onProgress("Uploading to Pinata (IPFS)...");

  const formData = new FormData();
  formData.append("file", file);
  formData.append("pinataMetadata", JSON.stringify({ name: `agrichain-${Date.now()}` }));
  formData.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

  const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${PINATA_JWT}`
    },
    body: formData
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Pinata error: ${err}`);
  }

  const data = await response.json();
  const cid = data.IpfsHash;
  onProgress(`✅ Pinned to IPFS! CID: ${cid.slice(0, 16)}...`);
  return cid;
}

// ── DEMO CID GENERATOR ────────────────────────────────────────────────────────

/**
 * For demo/prototype: generates a deterministic fake CID based on file content.
 * In production, replace with real IPFS upload.
 */
async function generateDemoCID(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      // Create a hash-like string from file data
      const data = e.target.result;
      let hash = 0;
      const str = data.slice(0, 1000);
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      // Format as a realistic-looking IPFS v0 CID
      const base58chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
      let cid = "Qm";
      const seed = Math.abs(hash) + file.size + file.lastModified;
      let s = seed;
      for (let i = 0; i < 44; i++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        cid += base58chars[s % base58chars.length];
      }
      resolve(cid);
    };
    reader.readAsDataURL(file);
  });
}

// ── UTILITY FUNCTIONS ─────────────────────────────────────────────────────────

/**
 * Convert an IPFS CID to a public gateway URL for display.
 * @param {string} cid - The IPFS CID
 * @param {number} gatewayIndex - Which gateway to use (0 = default)
 */
function cidToUrl(cid, gatewayIndex = 0) {
  if (!cid || cid.trim() === "") return null;
  const gateway = IPFS_GATEWAYS[gatewayIndex] || IPFS_GATEWAY;
  return `${gateway}${cid}`;
}

/**
 * Create an image preview from a File object before upload.
 * @param {File} file
 * @returns {Promise<string>} - Data URL for preview
 */
function createImagePreview(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Check if a string is a valid IPFS CID (basic check).
 * @param {string} cid
 */
function isValidCID(cid) {
  if (!cid || typeof cid !== "string") return false;
  // CIDv0 starts with Qm and is 46 chars
  // CIDv1 starts with b and is longer
  return (cid.startsWith("Qm") && cid.length === 46) ||
         (cid.startsWith("b") && cid.length > 50);
}

/**
 * Shorten a CID for display.
 * @param {string} cid
 */
function shortCID(cid) {
  if (!cid) return "";
  return cid.slice(0, 8) + "..." + cid.slice(-6);
}
