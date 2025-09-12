// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract MongsInspiredNFT is ERC721, Ownable, ReentrancyGuard {
    uint256 public constant PROJECT_SCALE = 1000000;
    uint256 public constant MAX_PROJECTS = 999;
    
    uint256 private _currentProjectId;
    
    struct Project {
        string name;
        uint256 maxSupply;
        uint256 mintCost;
        uint256 currentSupply;
        bool isActive;
        string projectURI;
    }
    
    mapping(uint256 => Project) public projects;
    mapping(uint256 => uint256) private _projectForToken;
    mapping(uint256 => uint256) private _mintNumberForToken;
    
    string private _baseTokenURI = "https://mongs.io/nft/";
    
    event ProjectCreated(uint256 indexed projectId, string name, uint256 maxSupply, uint256 mintCost);
    event ProjectToggled(uint256 indexed projectId, bool isActive);
    event ProjectURIUpdated(uint256 indexed projectId, string uri);
    event TokenMinted(uint256 indexed tokenId, uint256 indexed projectId, uint256 mintNumber, address to);

    constructor(string memory name, string memory symbol) ERC721(name, symbol) Ownable(msg.sender) {}

    function createProject(
        string memory name,
        uint256 maxSupply,
        uint256 mintCost,
        string memory projectURI
    ) external onlyOwner {
        require(_currentProjectId < MAX_PROJECTS, "Maximum projects reached");
        require(bytes(name).length > 0, "Project name cannot be empty");
        require(maxSupply > 0, "Max supply must be greater than 0");
        
        uint256 projectId = _currentProjectId;
        
        projects[projectId] = Project({
            name: name,
            maxSupply: maxSupply,
            mintCost: mintCost,
            currentSupply: 0,
            isActive: true,
            projectURI: projectURI
        });
        
        _currentProjectId++;
        
        emit ProjectCreated(projectId, name, maxSupply, mintCost);
    }

    function toggleProject(uint256 projectId) external onlyOwner {
        require(projectExists(projectId), "Project does not exist");
        
        projects[projectId].isActive = !projects[projectId].isActive;
        
        emit ProjectToggled(projectId, projects[projectId].isActive);
    }

    function setProjectURI(uint256 projectId, string memory uri) external onlyOwner {
        require(projectExists(projectId), "Project does not exist");
        
        projects[projectId].projectURI = uri;
        
        emit ProjectURIUpdated(projectId, uri);
    }

    function setBaseURI(string memory baseURI) external onlyOwner {
        _baseTokenURI = baseURI;
    }

    function mintNFT(uint256 projectId, address to) external payable nonReentrant {
        require(projectExists(projectId), "Project does not exist");
        require(projects[projectId].isActive, "Project is not active");
        require(projects[projectId].currentSupply < projects[projectId].maxSupply, "Project sold out");
        require(msg.value >= projects[projectId].mintCost, "Insufficient payment");
        
        uint256 mintNumber = projects[projectId].currentSupply + 1;
        uint256 tokenId = (projectId * PROJECT_SCALE) + mintNumber;
        
        projects[projectId].currentSupply++;
        _projectForToken[tokenId] = projectId;
        _mintNumberForToken[tokenId] = mintNumber;
        
        _safeMint(to, tokenId);
        
        if (msg.value > projects[projectId].mintCost) {
            payable(msg.sender).transfer(msg.value - projects[projectId].mintCost);
        }
        
        emit TokenMinted(tokenId, projectId, mintNumber, to);
    }

    function ownerMint(uint256 projectId, address to) external onlyOwner {
        require(projectExists(projectId), "Project does not exist");
        require(projects[projectId].currentSupply < projects[projectId].maxSupply, "Project sold out");
        
        uint256 mintNumber = projects[projectId].currentSupply + 1;
        uint256 tokenId = (projectId * PROJECT_SCALE) + mintNumber;
        
        projects[projectId].currentSupply++;
        _projectForToken[tokenId] = projectId;
        _mintNumberForToken[tokenId] = mintNumber;
        
        _safeMint(to, tokenId);
        
        emit TokenMinted(tokenId, projectId, mintNumber, to);
    }

    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "ERC721: invalid token ID");
        
        uint256 projectId = _projectForToken[tokenId];
        uint256 mintNumber = _mintNumberForToken[tokenId];
        
        // For MONGS compatibility, use project ID 2 to avoid conflict with mainnet MONGS (project 1)
        // MONGS mainnet uses project 1 (tokens 1000001-1006969)
        // We use project 2 (tokens 2000001+) to avoid conflicts
        uint256 mongsStyleTokenId = ((projectId + 2) * PROJECT_SCALE) + mintNumber;
        
        if (bytes(projects[projectId].projectURI).length > 0) {
            return string(abi.encodePacked(projects[projectId].projectURI, _toString(mongsStyleTokenId)));
        }
        
        return string(abi.encodePacked(_baseTokenURI, _toString(mongsStyleTokenId)));
    }

    function getTokenProject(uint256 tokenId) external view returns (uint256) {
        require(_ownerOf(tokenId) != address(0), "ERC721: invalid token ID");
        return _projectForToken[tokenId];
    }

    function getTokenMintNumber(uint256 tokenId) external view returns (uint256) {
        require(_ownerOf(tokenId) != address(0), "ERC721: invalid token ID");
        return _mintNumberForToken[tokenId];
    }

    function getProjectInfo(uint256 projectId) external view returns (
        string memory name,
        uint256 maxSupply,
        uint256 mintCost,
        uint256 currentSupply,
        bool isActive,
        string memory projectURI
    ) {
        require(projectExists(projectId), "Project does not exist");
        
        Project memory project = projects[projectId];
        return (
            project.name,
            project.maxSupply,
            project.mintCost,
            project.currentSupply,
            project.isActive,
            project.projectURI
        );
    }

    function getCurrentProjectId() external view returns (uint256) {
        return _currentProjectId;
    }

    function projectExists(uint256 projectId) public view returns (bool) {
        return projectId < _currentProjectId;
    }

    function deconstructTokenId(uint256 tokenId) external pure returns (uint256 projectId, uint256 mintNumber) {
        projectId = tokenId / PROJECT_SCALE;
        mintNumber = tokenId % PROJECT_SCALE;
    }

    function constructTokenId(uint256 projectId, uint256 mintNumber) external pure returns (uint256) {
        return (projectId * PROJECT_SCALE) + mintNumber;
    }

    function withdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds to withdraw");
        
        payable(owner()).transfer(balance);
    }

    function _toString(uint256 value) internal pure returns (string memory) {
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