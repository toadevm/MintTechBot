// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title SimplePaymentReceiver
 * @dev Minimalist smart contract for receiving ETH payments for trending promotion
 * @dev No private key storage in bot - eliminates security risks
 */
contract SimplePaymentReceiver {
    address public owner;
    uint256 public totalPayments;
    
    struct Payment {
        address payer;
        uint256 amount;
        uint256 timestamp;
    }
    
    mapping(uint256 => Payment) public payments;
    
    event PaymentReceived(
        uint256 indexed paymentId,
        address indexed payer,
        uint256 amount,
        uint256 timestamp
    );
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not the contract owner");
        _;
    }
    
    constructor() {
        owner = msg.sender;
    }
    
    /**
     * @dev Receive function to accept ETH payments
     * Emits PaymentReceived event for bot monitoring
     */
    receive() external payable {
        require(msg.value > 0, "Payment amount must be greater than 0");
        
        totalPayments++;
        uint256 paymentId = totalPayments;
        
        payments[paymentId] = Payment({
            payer: msg.sender,
            amount: msg.value,
            timestamp: block.timestamp
        });
        
        emit PaymentReceived(paymentId, msg.sender, msg.value, block.timestamp);
    }
    
    /**
     * @dev Get payment details by ID
     */
    function getPayment(uint256 paymentId) external view returns (
        address payer,
        uint256 amount,
        uint256 timestamp
    ) {
        Payment memory payment = payments[paymentId];
        return (payment.payer, payment.amount, payment.timestamp);
    }
    
    /**
     * @dev Get recent payments (for debugging)
     */
    function getRecentPayments(uint256 count) external view returns (
        uint256[] memory paymentIds,
        address[] memory payers,
        uint256[] memory amounts,
        uint256[] memory timestamps
    ) {
        uint256 startId = totalPayments > count ? totalPayments - count + 1 : 1;
        uint256 actualCount = totalPayments >= startId ? totalPayments - startId + 1 : 0;
        
        paymentIds = new uint256[](actualCount);
        payers = new address[](actualCount);
        amounts = new uint256[](actualCount);
        timestamps = new uint256[](actualCount);
        
        for (uint256 i = 0; i < actualCount; i++) {
            uint256 paymentId = startId + i;
            Payment memory payment = payments[paymentId];
            paymentIds[i] = paymentId;
            payers[i] = payment.payer;
            amounts[i] = payment.amount;
            timestamps[i] = payment.timestamp;
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
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
    
    /**
     * @dev Transfer ownership
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid new owner");
        owner = newOwner;
    }
    
    /**
     * @dev Emergency function to handle stuck transactions (owner only)
     */
    function emergencyWithdraw() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }
}