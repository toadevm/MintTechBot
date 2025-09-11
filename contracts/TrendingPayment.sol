// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title MintTechBot
 * @dev Smart contract to handle ETH payments for NFT trending promotion
 * @dev Supports both normal and premium trending with different pricing tiers
 */
contract MintTechBot {
    address public owner;
    
    // Pricing tiers for normal trending (in Wei)
    mapping(uint256 => uint256) public normalTrendingFees;
    
    // Pricing tiers for premium trending (in Wei)  
    mapping(uint256 => uint256) public premiumTrendingFees;
    
    // Valid duration options in hours
    uint256[] public validDurations = [6, 12, 18, 24];
    
    struct Payment {
        address payer;
        uint256 amount;
        uint256 timestamp;
        uint256 duration; // Duration in hours
        string tokenAddress; // NFT contract address
        bool isPremium; // Whether this is premium trending
        bool isActive;
        bool processed; // Whether the payment has been processed by the bot
    }
    
    mapping(uint256 => Payment) public payments;
    mapping(string => uint256[]) public tokenPayments; // Track payments per token
    uint256 public paymentCounter;
    
    event PaymentReceived(
        uint256 indexed paymentId,
        address indexed payer,
        string indexed tokenAddress,
        uint256 amount,
        uint256 duration,
        bool isPremium
    );
    
    event PaymentExpired(uint256 indexed paymentId);
    event FeesUpdated(string trendingType, uint256 duration, uint256 newFee);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not the contract owner");
        _;
    }
    
    constructor() {
        owner = msg.sender;
        
        // Initialize normal trending fees (in Wei)
        normalTrendingFees[6] = 0.0625 ether;   // 6hrs: 0.0625 ETH
        normalTrendingFees[12] = 0.1125 ether;  // 12hrs: 0.1125 ETH
        normalTrendingFees[18] = 0.151 ether;   // 18hrs: 0.151 ETH
        normalTrendingFees[24] = 0.20 ether;    // 24hrs: 0.20 ETH
        
        // Initialize premium trending fees (in Wei)
        premiumTrendingFees[6] = 0.125 ether;   // 6hrs: 0.125 ETH
        premiumTrendingFees[12] = 0.225 ether;  // 12hrs: 0.225 ETH
        premiumTrendingFees[18] = 0.32 ether;   // 18hrs: 0.32 ETH
        premiumTrendingFees[24] = 0.40 ether;   // 24hrs: 0.40 ETH
    }
    
    /**
     * @dev Pay for trending promotion
     * @param tokenAddress The NFT contract address to promote
     * @param duration Duration in hours (6, 12, 18, or 24)
     * @param isPremium Whether to use premium trending
     */
    function payForTrending(
        string memory tokenAddress,
        uint256 duration,
        bool isPremium
    ) external payable returns (uint256 paymentId) {
        require(isValidDuration(duration), "Invalid duration. Use 6, 12, 18, or 24 hours");
        require(bytes(tokenAddress).length == 42, "Invalid token address format");
        
        uint256 requiredAmount = getFee(duration, isPremium);
        require(msg.value >= requiredAmount, "Insufficient payment");
        
        paymentCounter++;
        paymentId = paymentCounter;
        
        payments[paymentId] = Payment({
            payer: msg.sender,
            amount: msg.value,
            timestamp: block.timestamp,
            duration: duration,
            tokenAddress: tokenAddress,
            isPremium: isPremium,
            isActive: true,
            processed: false
        });
        
        tokenPayments[tokenAddress].push(paymentId);
        
        emit PaymentReceived(paymentId, msg.sender, tokenAddress, msg.value, duration, isPremium);
        
        return paymentId;
    }
    
    /**
     * @dev Receive function to accept plain ETH transfers
     * Creates payment record for bot to match later
     */
    receive() external payable {
        require(msg.value > 0, "Payment amount must be greater than 0");
        
        paymentCounter++;
        uint256 paymentId = paymentCounter;
        
        payments[paymentId] = Payment({
            payer: msg.sender,
            amount: msg.value,
            timestamp: block.timestamp,
            duration: 0, // Will be set by bot when matched
            tokenAddress: "", // Will be set by bot when matched
            isPremium: false, // Will be set by bot when matched
            isActive: false, // Only becomes active when processed by bot
            processed: false
        });
        
        emit PaymentReceived(paymentId, msg.sender, "", msg.value, 0, false);
    }
    
    /**
     * @dev Mark payment as processed and set details (called by bot)
     * @param paymentId The payment ID to process
     * @param tokenAddress The NFT contract address being promoted
     * @param duration The duration in hours
     * @param isPremium Whether this is premium trending
     */
    function processSimplePayment(
        uint256 paymentId, 
        string memory tokenAddress, 
        uint256 duration,
        bool isPremium
    ) external onlyOwner {
        require(paymentId <= paymentCounter && paymentId > 0, "Invalid payment ID");
        require(!payments[paymentId].processed, "Payment already processed");
        require(isValidDuration(duration), "Invalid duration. Use 6, 12, 18, or 24 hours");
        require(bytes(tokenAddress).length == 42, "Invalid token address format");
        
        payments[paymentId].tokenAddress = tokenAddress;
        payments[paymentId].duration = duration;
        payments[paymentId].isPremium = isPremium;
        payments[paymentId].isActive = true;
        payments[paymentId].processed = true;
        
        tokenPayments[tokenAddress].push(paymentId);
        
        emit PaymentReceived(paymentId, payments[paymentId].payer, tokenAddress, payments[paymentId].amount, duration, isPremium);
    }
    
    /**
     * @dev Get recent unprocessed payments (for bot to match)
     * @param since Timestamp to search from
     * @param maxResults Maximum number of results to return
     */
    function getUnprocessedPayments(
        uint256 since, 
        uint256 maxResults
    ) external view returns (
        uint256[] memory paymentIds,
        address[] memory payers,
        uint256[] memory amounts,
        uint256[] memory timestamps
    ) {
        // Count unprocessed payments since timestamp
        uint256 count = 0;
        for (uint256 i = paymentCounter; i > 0 && count < maxResults; i--) {
            if (payments[i].timestamp >= since && !payments[i].processed && payments[i].amount > 0) {
                count++;
            }
        }
        
        // Create arrays with exact size
        paymentIds = new uint256[](count);
        payers = new address[](count);
        amounts = new uint256[](count);
        timestamps = new uint256[](count);
        
        // Fill arrays
        uint256 index = 0;
        for (uint256 i = paymentCounter; i > 0 && index < count; i--) {
            if (payments[i].timestamp >= since && !payments[i].processed && payments[i].amount > 0) {
                paymentIds[index] = i;
                payers[index] = payments[i].payer;
                amounts[index] = payments[i].amount;
                timestamps[index] = payments[i].timestamp;
                index++;
            }
        }
    }
    
    /**
     * @dev Get fee for specific duration and trending type
     * @param duration Duration in hours
     * @param isPremium Whether premium trending is requested
     * @return Required fee in Wei
     */
    function getFee(uint256 duration, bool isPremium) public view returns (uint256) {
        require(isValidDuration(duration), "Invalid duration");
        
        if (isPremium) {
            return premiumTrendingFees[duration];
        } else {
            return normalTrendingFees[duration];
        }
    }
    
    /**
     * @dev Check if duration is valid
     * @param duration Duration to check
     * @return Whether the duration is valid
     */
    function isValidDuration(uint256 duration) public view returns (bool) {
        for (uint256 i = 0; i < validDurations.length; i++) {
            if (validDurations[i] == duration) {
                return true;
            }
        }
        return false;
    }
    
    /**
     * @dev Check if a payment is still active
     * @param paymentId The payment ID to check
     * @return Whether the payment is still active
     */
    function isPaymentActive(uint256 paymentId) public view returns (bool) {
        Payment memory payment = payments[paymentId];
        if (!payment.isActive) return false;
        
        uint256 expiryTime = payment.timestamp + (payment.duration * 1 hours);
        return block.timestamp <= expiryTime;
    }
    
    /**
     * @dev Get all active payments for a token
     * @param tokenAddress The token address
     * @return Array of active payment IDs
     */
    function getActivePaymentsForToken(
        string memory tokenAddress
    ) external view returns (uint256[] memory) {
        uint256[] memory tokenPaymentIds = tokenPayments[tokenAddress];
        uint256 activeCount = 0;
        
        // Count active payments
        for (uint256 i = 0; i < tokenPaymentIds.length; i++) {
            if (isPaymentActive(tokenPaymentIds[i])) {
                activeCount++;
            }
        }
        
        // Create array of active payment IDs
        uint256[] memory activePayments = new uint256[](activeCount);
        uint256 currentIndex = 0;
        
        for (uint256 i = 0; i < tokenPaymentIds.length; i++) {
            if (isPaymentActive(tokenPaymentIds[i])) {
                activePayments[currentIndex] = tokenPaymentIds[i];
                currentIndex++;
            }
        }
        
        return activePayments;
    }
    
    /**
     * @dev Expire a payment (called by backend)
     * @param paymentId The payment ID to expire
     */
    function expirePayment(uint256 paymentId) external onlyOwner {
        require(payments[paymentId].isActive, "Payment already inactive");
        payments[paymentId].isActive = false;
        emit PaymentExpired(paymentId);
    }
    
    /**
     * @dev Update normal trending fee for specific duration (owner only)
     * @param duration Duration in hours (6, 12, 18, or 24)
     * @param newFee New fee in Wei
     */
    function updateNormalTrendingFee(uint256 duration, uint256 newFee) external onlyOwner {
        require(isValidDuration(duration), "Invalid duration");
        normalTrendingFees[duration] = newFee;
        emit FeesUpdated("normal", duration, newFee);
    }
    
    /**
     * @dev Update premium trending fee for specific duration (owner only)
     * @param duration Duration in hours (6, 12, 18, or 24)
     * @param newFee New fee in Wei
     */
    function updatePremiumTrendingFee(uint256 duration, uint256 newFee) external onlyOwner {
        require(isValidDuration(duration), "Invalid duration");
        premiumTrendingFees[duration] = newFee;
        emit FeesUpdated("premium", duration, newFee);
    }
    
    /**
     * @dev Update multiple normal trending fees at once (owner only)
     * @param durations Array of durations
     * @param newFees Array of corresponding fees
     */
    function updateMultipleNormalTrendingFees(
        uint256[] memory durations, 
        uint256[] memory newFees
    ) external onlyOwner {
        require(durations.length == newFees.length, "Arrays length mismatch");
        
        for (uint256 i = 0; i < durations.length; i++) {
            require(isValidDuration(durations[i]), "Invalid duration");
            normalTrendingFees[durations[i]] = newFees[i];
            emit FeesUpdated("normal", durations[i], newFees[i]);
        }
    }
    
    /**
     * @dev Update multiple premium trending fees at once (owner only)
     * @param durations Array of durations
     * @param newFees Array of corresponding fees
     */
    function updateMultiplePremiumTrendingFees(
        uint256[] memory durations, 
        uint256[] memory newFees
    ) external onlyOwner {
        require(durations.length == newFees.length, "Arrays length mismatch");
        
        for (uint256 i = 0; i < durations.length; i++) {
            require(isValidDuration(durations[i]), "Invalid duration");
            premiumTrendingFees[durations[i]] = newFees[i];
            emit FeesUpdated("premium", durations[i], newFees[i]);
        }
    }
    
    /**
     * @dev Get all current fees
     */
    function getAllFees() external view returns (
        uint256[] memory durations,
        uint256[] memory normalFees,
        uint256[] memory premiumFees
    ) {
        durations = validDurations;
        normalFees = new uint256[](validDurations.length);
        premiumFees = new uint256[](validDurations.length);
        
        for (uint256 i = 0; i < validDurations.length; i++) {
            normalFees[i] = normalTrendingFees[validDurations[i]];
            premiumFees[i] = premiumTrendingFees[validDurations[i]];
        }
    }
    
    /**
     * @dev Withdraw contract balance (owner only)
     */
    function withdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds to withdraw");
        
        (bool success, ) = payable(owner).call{value: balance}("");
        require(success, "Withdrawal failed");
    }
    
    /**
     * @dev Get contract balance
     */
    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }
    
    /**
     * @dev Get payment details
     * @param paymentId The payment ID
     */
    function getPayment(uint256 paymentId) external view returns (
        address payer,
        uint256 amount,
        uint256 timestamp,
        uint256 duration,
        string memory tokenAddress,
        bool isPremium,
        bool isActive,
        bool processed
    ) {
        Payment memory payment = payments[paymentId];
        return (
            payment.payer,
            payment.amount,
            payment.timestamp,
            payment.duration,
            payment.tokenAddress,
            payment.isPremium,
            payment.isActive,
            payment.processed
        );
    }
    
    /**
     * @dev Transfer ownership
     * @param newOwner New owner address
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid new owner");
        owner = newOwner;
    }
}