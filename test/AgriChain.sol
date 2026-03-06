// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title AgriChain
 * @dev Blockchain-based supply chain transparency for agricultural products
 *      — with IPFS image hash storage for visual proof of crop origin.
 *
 * HOW IPFS WORKS HERE:
 *   Images are NOT stored on the blockchain (too expensive).
 *   Instead, each image is uploaded to IPFS (decentralized storage),
 *   which returns a Content Identifier (CID) like:
 *       QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco
 *   This CID is stored on-chain. Because IPFS uses content-based addressing,
 *   the CID can NEVER point to a different image — it is permanently tamper-proof.
 *   To view image: https://ipfs.io/ipfs/<CID>
 */
contract AgriChain {

    // ── Enums ─────────────────────────────────────────────────────────────────

    enum Status {
        Harvested,      // 0
        Processing,     // 1
        InTransit,      // 2
        InWarehouse,    // 3
        AtRetailer,     // 4
        Sold            // 5
    }

    // ── Data Structures ───────────────────────────────────────────────────────

    struct StatusUpdate {
        Status   status;
        string   note;
        address  updatedBy;
        uint256  timestamp;
        string   imageCID;   // IPFS CID for photo proof at this stage
    }

    struct Batch {
        uint256  batchId;
        string   cropName;
        string   farmerName;
        string   farmerLocation;
        uint256  quantity;
        uint256  harvestDate;
        Status   currentStatus;
        address  registeredBy;
        uint256  registeredAt;
        bool     exists;
        string   harvestImageCID; // IPFS CID of harvest photo
        string   description;
    }

    // ── State ─────────────────────────────────────────────────────────────────

    address public owner;
    uint256 private _nextBatchId;

    mapping(uint256 => Batch)          public batches;
    mapping(uint256 => StatusUpdate[]) public statusHistory;
    mapping(uint256 => string[])       public batchImages; // all CIDs per batch
    uint256[]                          public allBatchIds;

    mapping(address => bool) public admins;
    mapping(address => bool) public distributors;
    mapping(address => bool) public retailers;

    // ── Events ────────────────────────────────────────────────────────────────

    event BatchRegistered(uint256 indexed batchId, string cropName, string farmerName, uint256 quantity, string imageCID);
    event StatusUpdated(uint256 indexed batchId, Status newStatus, string note, address updatedBy, string imageCID);
    event ImageAdded(uint256 indexed batchId, string imageCID, address addedBy);
    event RoleGranted(address indexed account, string role);

    // ── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "AgriChain: caller is not owner");
        _;
    }
    modifier onlyAdmin() {
        require(admins[msg.sender] || msg.sender == owner, "AgriChain: caller is not admin");
        _;
    }
    modifier batchExists(uint256 batchId) {
        require(batches[batchId].exists, "AgriChain: batch does not exist");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
        admins[msg.sender] = true;
        _nextBatchId = 1;
    }

    // ── Role Management ───────────────────────────────────────────────────────

    function addAdmin(address account) external onlyOwner {
        admins[account] = true;
        emit RoleGranted(account, "Admin");
    }
    function addDistributor(address account) external onlyAdmin {
        distributors[account] = true;
        emit RoleGranted(account, "Distributor");
    }
    function addRetailer(address account) external onlyAdmin {
        retailers[account] = true;
        emit RoleGranted(account, "Retailer");
    }

    // ── Core Functions ────────────────────────────────────────────────────────

    /**
     * @notice Register a new agricultural batch.
     * @param cropName        Crop name e.g. "Organic Wheat"
     * @param farmerName      Farmer or cooperative name
     * @param farmerLocation  Geographic origin
     * @param quantity        Quantity in kg
     * @param harvestDate     Unix timestamp of harvest
     * @param harvestImageCID IPFS CID of harvest photo (pass "" if none)
     * @param description     Optional batch description
     */
    function registerBatch(
        string calldata cropName,
        string calldata farmerName,
        string calldata farmerLocation,
        uint256         quantity,
        uint256         harvestDate,
        string calldata harvestImageCID,
        string calldata description
    ) external onlyAdmin returns (uint256 batchId) {
        require(bytes(cropName).length > 0,   "AgriChain: crop name required");
        require(bytes(farmerName).length > 0, "AgriChain: farmer name required");
        require(quantity > 0,                 "AgriChain: quantity must be > 0");

        batchId = _nextBatchId++;

        batches[batchId] = Batch({
            batchId:         batchId,
            cropName:        cropName,
            farmerName:      farmerName,
            farmerLocation:  farmerLocation,
            quantity:        quantity,
            harvestDate:     harvestDate,
            currentStatus:   Status.Harvested,
            registeredBy:    msg.sender,
            registeredAt:    block.timestamp,
            exists:          true,
            harvestImageCID: harvestImageCID,
            description:     description
        });

        statusHistory[batchId].push(StatusUpdate({
            status:    Status.Harvested,
            note:      "Batch registered and harvested",
            updatedBy: msg.sender,
            timestamp: block.timestamp,
            imageCID:  harvestImageCID
        }));

        if (bytes(harvestImageCID).length > 0) {
            batchImages[batchId].push(harvestImageCID);
            emit ImageAdded(batchId, harvestImageCID, msg.sender);
        }

        allBatchIds.push(batchId);
        emit BatchRegistered(batchId, cropName, farmerName, quantity, harvestImageCID);
        return batchId;
    }

    /**
     * @notice Update batch status with optional IPFS photo proof.
     * @param batchId   Batch ID
     * @param newStatus New status value
     * @param note      Human-readable update note
     * @param imageCID  IPFS CID of photo at this stage (pass "" if none)
     */
    function updateStatus(
        uint256         batchId,
        Status          newStatus,
        string calldata note,
        string calldata imageCID
    ) external batchExists(batchId) {
        bool isAdmin    = admins[msg.sender] || msg.sender == owner;
        bool isDistrib  = distributors[msg.sender];
        bool isRetailer = retailers[msg.sender];

        if (!isAdmin) {
            if (isDistrib) {
                require(
                    newStatus == Status.Processing ||
                    newStatus == Status.InTransit  ||
                    newStatus == Status.InWarehouse,
                    "AgriChain: distributor can only set Processing/InTransit/InWarehouse"
                );
            } else if (isRetailer) {
                require(
                    newStatus == Status.AtRetailer ||
                    newStatus == Status.Sold,
                    "AgriChain: retailer can only set AtRetailer/Sold"
                );
            } else {
                revert("AgriChain: caller has no update permission");
            }
        }

        batches[batchId].currentStatus = newStatus;

        statusHistory[batchId].push(StatusUpdate({
            status:    newStatus,
            note:      note,
            updatedBy: msg.sender,
            timestamp: block.timestamp,
            imageCID:  imageCID
        }));

        if (bytes(imageCID).length > 0) {
            batchImages[batchId].push(imageCID);
            emit ImageAdded(batchId, imageCID, msg.sender);
        }

        emit StatusUpdated(batchId, newStatus, note, msg.sender, imageCID);
    }

    /**
     * @notice Add an extra IPFS image to a batch without changing status.
     */
    function addImage(uint256 batchId, string calldata imageCID)
        external batchExists(batchId) onlyAdmin
    {
        require(bytes(imageCID).length > 0, "AgriChain: CID required");
        batchImages[batchId].push(imageCID);
        emit ImageAdded(batchId, imageCID, msg.sender);
    }

    // ── View Functions ────────────────────────────────────────────────────────

    function getBatch(uint256 batchId)
        external view batchExists(batchId) returns (Batch memory)
    { return batches[batchId]; }

    function getStatusHistory(uint256 batchId)
        external view batchExists(batchId) returns (StatusUpdate[] memory)
    { return statusHistory[batchId]; }

    function getBatchImages(uint256 batchId)
        external view batchExists(batchId) returns (string[] memory)
    { return batchImages[batchId]; }

    function getTotalBatches() external view returns (uint256) { return allBatchIds.length; }
    function getAllBatchIds()   external view returns (uint256[] memory) { return allBatchIds; }

    function statusName(Status s) public pure returns (string memory) {
        if (s == Status.Harvested)   return "Harvested";
        if (s == Status.Processing)  return "Processing";
        if (s == Status.InTransit)   return "In Transit";
        if (s == Status.InWarehouse) return "In Warehouse";
        if (s == Status.AtRetailer)  return "At Retailer";
        if (s == Status.Sold)        return "Sold";
        return "Unknown";
    }
}
