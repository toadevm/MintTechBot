const { ethers } = require('ethers');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');

class NFTImageService {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`);
    this.cacheDir = path.join(__dirname, '../../temp_images');
    this.externalContracts = this.parseExternalContracts();
    if (this.externalContracts.length === 0) {
      this.externalContracts = [
        {
          address: '0xb4a7d131436ed8ec06ad696fa3bf8d23c0ab3acf',
          name: 'MONGS',
          totalSupply: 6969,
          tokenIdBase: 1000000
        }
      ];
    }
    
    this.erc721ABI = [
      'function tokenURI(uint256 tokenId) external view returns (string memory)',
      'function totalSupply() external view returns (uint256)',
      'function name() external view returns (string memory)'
    ];
    
    this.ensureCacheDir();
  }

  parseExternalContracts() {
    try {
      const contractsConfig = process.env.EXTERNAL_NFT_CONTRACTS;
      if (!contractsConfig) return [];

      return contractsConfig.split(',').map(config => {
        const parts = config.trim().split(':');
        const [address, name, totalSupply, tokenIdBase] = parts;
        return {
          address: address.trim(),
          name: name.trim(),
          totalSupply: parseInt(totalSupply.trim()),
          tokenIdBase: tokenIdBase ? parseInt(tokenIdBase.trim()) : 0
        };
      });
    } catch (error) {
      logger.warn('Failed to parse external contracts config:', error);
      return [];
    }
  }

  async ensureCacheDir() {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (error) {
      logger.error('Failed to create cache directory:', error);
    }
  }

  resolveIPFS(url, gatewayIndex = 0) {
    if (url.startsWith('ipfs://')) {
      const gateways = [
        'https://ipfs.io/ipfs/',
        'https://gateway.pinata.cloud/ipfs/',
        'https://cloudflare-ipfs.com/ipfs/',
        'https://dweb.link/ipfs/'
      ];
      const gateway = gateways[gatewayIndex % gateways.length];
      return url.replace('ipfs://', gateway);
    }
    return url;
  }

  async downloadImage(imageUrl, filename) {
    try {
      const response = await axios.get(imageUrl, {
        responseType: 'stream',
        timeout: 15000,
        headers: {
          'User-Agent': 'MintTechBot/1.0'
        }
      });

      const filepath = path.join(this.cacheDir, filename);
      const writer = require('fs').createWriteStream(filepath);
      
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(filepath));
        writer.on('error', reject);
      });
    } catch (error) {
      logger.error(`Failed to download image from ${imageUrl}:`, error);
      throw error;
    }
  }

  async cleanupImage(filepath) {
    try {
      await fs.unlink(filepath);
      logger.debug(`Cleaned up cached image: ${filepath}`);
    } catch (error) {
      logger.warn(`Failed to cleanup image ${filepath}:`, error);
    }
  }

  async getRandomNFTImage(contractInfo = null) {
    try {
      const contract = contractInfo || this.externalContracts[0];
      const nftContract = new ethers.Contract(contract.address, this.erc721ABI, this.provider);
      
      let actualTotalSupply;
      try {
        actualTotalSupply = await nftContract.totalSupply();
        logger.info(`Actual total supply for ${contract.name}: ${actualTotalSupply}`);
      } catch (error) {
        logger.warn(`Failed to get actual total supply, using config value: ${error.message}`);
        actualTotalSupply = contract.totalSupply;
      }
      
      let tokenURI;
      let randomTokenId;
      let attempts = 0;
      const maxAttempts = 5;
      
      while (attempts < maxAttempts) {
        const randomNumber = Math.floor(Math.random() * Number(actualTotalSupply)) + 1;
        randomTokenId = contract.tokenIdBase ? contract.tokenIdBase + randomNumber : randomNumber;
        logger.info(`Attempt ${attempts + 1}: Fetching NFT image from ${contract.name} token ID: ${randomTokenId}`);
        
        try {
          tokenURI = await nftContract.tokenURI(randomTokenId);
          logger.debug(`Token URI: ${tokenURI}`);
          break;
        } catch (error) {
          attempts++;
          if (error.reason === 'NOTOKEN' || error.message.includes('NOTOKEN')) {
            logger.warn(`Token ${randomTokenId} does not exist, trying another...`);
            if (attempts >= maxAttempts) {
              throw new Error(`Failed to find valid token after ${maxAttempts} attempts`);
            }
            continue;
          }
          throw error;
        }
      }

      let metadata;
      let metadataFetched = false;
      
      for (let gatewayIndex = 0; gatewayIndex < 4 && !metadataFetched; gatewayIndex++) {
        try {
          const metadataUrl = this.resolveIPFS(tokenURI, gatewayIndex);
          logger.debug(`Trying metadata gateway ${gatewayIndex}: ${metadataUrl}`);
          
          const metadataResponse = await axios.get(metadataUrl, {
            timeout: 10000,
            headers: {
              'User-Agent': 'MintTechBot/1.0'
            }
          });
          
          metadata = metadataResponse.data;
          metadataFetched = true;
          break;
        } catch (error) {
          logger.warn(`Gateway ${gatewayIndex} failed for metadata: ${error.message}`);
          if (gatewayIndex === 3) {
            throw new Error('All metadata gateways failed');
          }
        }
      }

      if (!metadata.image) {
        throw new Error('No image found in metadata');
      }

      let imagePath;
      let imageDownloaded = false;
      const filename = `${contract.name.toLowerCase()}_${randomTokenId}_${crypto.randomBytes(4).toString('hex')}.${this.getImageExtension(metadata.image)}`;
      
      for (let gatewayIndex = 0; gatewayIndex < 4 && !imageDownloaded; gatewayIndex++) {
        try {
          const imageUrl = this.resolveIPFS(metadata.image, gatewayIndex);
          logger.debug(`Trying image gateway ${gatewayIndex}: ${imageUrl}`);
          
          imagePath = await this.downloadImage(imageUrl, filename);
          imageDownloaded = true;
          break;
        } catch (error) {
          logger.warn(`Gateway ${gatewayIndex} failed for image download: ${error.message}`);
          if (gatewayIndex === 3) {
            throw new Error('All image gateways failed');
          }
        }
      }
      
      return {
        imagePath,
        metadata: {
          name: metadata.name || `${contract.name} #${randomTokenId}`,
          description: metadata.description || '',
          tokenId: randomTokenId,
          contractAddress: contract.address,
          contractName: contract.name
        }
      };
    } catch (error) {
      logger.error('Failed to get random NFT image:', error);
      throw error;
    }
  }

  getImageExtension(url) {
    const urlPath = url.split('?')[0];
    const ext = path.extname(urlPath).toLowerCase();
    return ext || '.jpg';
  }

  async getNFTImageForContract(contractAddress, tokenId) {
    try {
      const nftContract = new ethers.Contract(contractAddress, this.erc721ABI, this.provider);
      
      const tokenURI = await nftContract.tokenURI(tokenId);
      const metadataUrl = this.resolveIPFS(tokenURI);
      
      const metadataResponse = await axios.get(metadataUrl, {
        timeout: 15000,
        headers: {
          'User-Agent': 'MintTechBot/1.0'
        }
      });

      const metadata = metadataResponse.data;
      if (!metadata.image) {
        throw new Error('No image found in metadata');
      }

      const imageUrl = this.resolveIPFS(metadata.image);
      const filename = `custom_${contractAddress.slice(0, 8)}_${tokenId}_${crypto.randomBytes(4).toString('hex')}.${this.getImageExtension(imageUrl)}`;
      
      const imagePath = await this.downloadImage(imageUrl, filename);
      
      return {
        imagePath,
        metadata: {
          name: metadata.name || `Token #${tokenId}`,
          description: metadata.description || '',
          tokenId,
          contractAddress
        }
      };
    } catch (error) {
      logger.error(`Failed to get NFT image for ${contractAddress}:${tokenId}:`, error);
      throw error;
    }
  }

  async getAvailableContracts() {
    return this.externalContracts;
  }
}

module.exports = NFTImageService;