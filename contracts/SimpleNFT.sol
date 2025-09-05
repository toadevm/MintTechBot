// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SimpleNFT
 * @dev A simple NFT contract for testing the BuyBot monitoring system
 * @dev Very cheap minting for easy testing on Sepolia testnet
 */
contract SimpleNFT is ERC721, Ownable {
    uint256 private _tokenIdCounter;
    uint256 public mintPrice = 0.001 ether; // Very cheap for testing
    uint256 public maxSupply = 10000;
    bool public mintingActive = true;
    
    // Base URI for metadata
    string private _baseTokenURI;
    
    // Events for the bot to monitor
    event NFTMinted(address indexed to, uint256 indexed tokenId, string tokenURI);
    event MintPriceUpdated(uint256 newPrice);
    event MintingToggled(bool isActive);
    
    constructor() ERC721("SimpleNFT", "SNFT") Ownable(msg.sender) {
        _baseTokenURI = "https://api.example.com/metadata/";
    }
    
    /**
     * @dev Public mint function - anyone can mint for cheap
     * @param to Address to mint to
     */
    function mint(address to) public payable {
        require(mintingActive, "Minting is not active");
        require(msg.value >= mintPrice, "Insufficient payment");
        require(_tokenIdCounter < maxSupply, "Max supply reached");
        
        uint256 tokenId = _tokenIdCounter;
        _tokenIdCounter++;
        
        _safeMint(to, tokenId);
        
        string memory autoURI = string(abi.encodePacked(_baseTokenURI, toString(tokenId)));
        emit NFTMinted(to, tokenId, autoURI);
        
        // Refund excess payment
        if (msg.value > mintPrice) {
            payable(msg.sender).transfer(msg.value - mintPrice);
        }
    }
    
    /**
     * @dev Mint to yourself with automatic metadata
     */
    function quickMint() public payable {
        require(mintingActive, "Minting is not active");
        require(msg.value >= mintPrice, "Insufficient payment");
        require(_tokenIdCounter < maxSupply, "Max supply reached");
        
        uint256 tokenId = _tokenIdCounter;
        _tokenIdCounter++;
        
        _safeMint(msg.sender, tokenId);
        
        // Auto-generate simple metadata URI
        string memory autoURI = string(abi.encodePacked(_baseTokenURI, toString(tokenId)));
        
        emit NFTMinted(msg.sender, tokenId, autoURI);
        
        // Refund excess payment
        if (msg.value > mintPrice) {
            payable(msg.sender).transfer(msg.value - mintPrice);
        }
    }
    
    /**
     * @dev Batch mint multiple NFTs (for testing)
     * @param quantity Number of NFTs to mint
     */
    function batchMint(uint256 quantity) public payable {
        require(mintingActive, "Minting is not active");
        require(quantity > 0 && quantity <= 10, "Invalid quantity (1-10)");
        require(msg.value >= mintPrice * quantity, "Insufficient payment");
        require(_tokenIdCounter + quantity <= maxSupply, "Would exceed max supply");
        
        for (uint256 i = 0; i < quantity; i++) {
            uint256 tokenId = _tokenIdCounter;
            _tokenIdCounter++;
            
            _safeMint(msg.sender, tokenId);
            
            string memory autoURI = string(abi.encodePacked(_baseTokenURI, toString(tokenId)));
            
            emit NFTMinted(msg.sender, tokenId, autoURI);
        }
        
        // Refund excess payment
        uint256 totalCost = mintPrice * quantity;
        if (msg.value > totalCost) {
            payable(msg.sender).transfer(msg.value - totalCost);
        }
    }
    
    /**
     * @dev Owner can mint for free (for initial collection setup)
     */
    function ownerMint(address to) public onlyOwner {
        require(_tokenIdCounter < maxSupply, "Max supply reached");
        
        uint256 tokenId = _tokenIdCounter;
        _tokenIdCounter++;
        
        _safeMint(to, tokenId);
        
        string memory autoURI = string(abi.encodePacked(_baseTokenURI, toString(tokenId)));
        emit NFTMinted(to, tokenId, autoURI);
    }
    
    /**
     * @dev Update mint price (owner only)
     */
    function setMintPrice(uint256 newPrice) public onlyOwner {
        mintPrice = newPrice;
        emit MintPriceUpdated(newPrice);
    }
    
    /**
     * @dev Toggle minting active state
     */
    function toggleMinting() public onlyOwner {
        mintingActive = !mintingActive;
        emit MintingToggled(mintingActive);
    }
    
    /**
     * @dev Update base URI for metadata
     */
    function setBaseURI(string memory newBaseURI) public onlyOwner {
        _baseTokenURI = newBaseURI;
    }
    
    /**
     * @dev Get current total supply
     */
    function totalSupply() public view returns (uint256) {
        return _tokenIdCounter;
    }
    
    /**
     * @dev Withdraw contract funds (owner only)
     */
    function withdraw() public onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds to withdraw");
        
        (bool success, ) = payable(owner()).call{value: balance}("");
        require(success, "Withdrawal failed");
    }
    
    /**
     * @dev Get contract balance
     */
    function getContractBalance() public view returns (uint256) {
        return address(this).balance;
    }
    
    // Override tokenURI to use baseURI
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string(abi.encodePacked(_baseTokenURI, toString(tokenId)));
    }
    
    /**
     * @dev Convert uint256 to string
     */
    function toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}