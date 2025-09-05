// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title TrendingPayment
 * @dev Simple contract to handle ETH payments for NFT trending promotion
 * @dev Designed for Sepolia testnet deployment
 */
contract TrendingPayment {
    address public owner;
    uint256 public baseFee; // Base fee in Wei (0.01 ETH = 10^16 Wei)
    
    struct Payment {
        address payer;
        uint256 amount;
        uint256 timestamp;
        uint256 duration; // Duration in hours
        string tokenAddress; // NFT contract address
        bool isActive;
    }
    
    mapping(uint256 => Payment) public payments;
    mapping(string => uint256[]) public tokenPayments; // Track payments per token
    uint256 public paymentCounter;
    
    event PaymentReceived(
        uint256 indexed paymentId,
        address indexed payer,
        string indexed tokenAddress,
        uint256 amount,
        uint256 duration
    );
    
    event PaymentExpired(uint256 indexed paymentId);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not the contract owner");
        _;
    }
    
    constructor() {
        owner = msg.sender;
        baseFee = 0.01 ether; // 0.01 ETH base fee
    }
    
    /**
     * @dev Pay for trending promotion
     * @param tokenAddress The NFT contract address to promote
     * @param duration Duration in hours (1-168, max 1 week)
     */
    function payForTrending(
        string memory tokenAddress,
        uint256 duration
    ) external payable returns (uint256 paymentId) {
        require(duration >= 1 && duration <= 168, "Duration must be 1-168 hours");
        require(bytes(tokenAddress).length == 42, "Invalid token address format");
        
        uint256 requiredAmount = calculateFee(duration);
        require(msg.value >= requiredAmount, "Insufficient payment");
        
        paymentCounter++;
        paymentId = paymentCounter;
        
        payments[paymentId] = Payment({
            payer: msg.sender,
            amount: msg.value,
            timestamp: block.timestamp,
            duration: duration,
            tokenAddress: tokenAddress,
            isActive: true
        });
        
        tokenPayments[tokenAddress].push(paymentId);
        
        emit PaymentReceived(paymentId, msg.sender, tokenAddress, msg.value, duration);
        
        return paymentId;
    }
    
    /**
     * @dev Calculate required fee based on duration
     * @param duration Duration in hours
     * @return Required fee in Wei
     */
    function calculateFee(uint256 duration) public view returns (uint256) {
        // Base fee + 0.001 ETH per hour
        return baseFee + (duration * 0.001 ether);
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
     * @dev Update base fee (owner only)
     * @param newBaseFee New base fee in Wei
     */
    function updateBaseFee(uint256 newBaseFee) external onlyOwner {
        baseFee = newBaseFee;
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
        bool isActive,
        bool isExpired
    ) {
        Payment memory payment = payments[paymentId];
        return (
            payment.payer,
            payment.amount,
            payment.timestamp,
            payment.duration,
            payment.tokenAddress,
            payment.isActive,
            !isPaymentActive(paymentId)
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