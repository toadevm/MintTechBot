const { ethers } = require('ethers');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
const sharp = require('sharp');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
            return `${timestamp} [${level.toUpperCase()}] ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'nft-metadata.log' })
    ],
});

class NFTMetadataService {
    constructor() {
        this.provider = new ethers.JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/kAmtb3hCAJaBhgQWSJBVs`);
        this.mainnetProvider = new ethers.JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/kAmtb3hCAJaBhgQWSJBVs`);
        this.tempDir = path.join(__dirname, '../../temp_images');
        this.ensureTempDir();
        
        this.mongsInspiredABI = [
            "function name() view returns (string)",
            "function symbol() view returns (string)",
            "function tokenURI(uint256 tokenId) view returns (string)",
            "function getTokenProject(uint256 tokenId) view returns (uint256)",
            "function getTokenMintNumber(uint256 tokenId) view returns (uint256)",
            "function getProjectInfo(uint256 projectId) view returns (string memory name, uint256 maxSupply, uint256 mintCost, uint256 currentSupply, bool isActive, string memory projectURI)",
            "function ownerOf(uint256 tokenId) view returns (address)",
            "function PROJECT_SCALE() view returns (uint256)"
        ];
        
        this.mongsMainnetABI = [
            "function tokenURI(uint256 tokenId) view returns (string)",
            "function ownerOf(uint256 tokenId) view returns (address)"
        ];
    }

    async ensureTempDir() {
        try {
            await fs.mkdir(this.tempDir, { recursive: true });
        } catch (error) {
            logger.error(`Failed to create temp directory: ${error.message}`);
        }
    }

    async fetchTokenMetadata(contractAddress, tokenId, isMainnet = false) {
        try {
            const provider = isMainnet ? this.mainnetProvider : this.provider;
            const abi = isMainnet ? this.mongsMainnetABI : this.mongsInspiredABI;
            const contract = new ethers.Contract(contractAddress, abi, provider);

            logger.info(`Fetching metadata for token ${tokenId} from contract ${contractAddress} (${isMainnet ? 'mainnet' : 'testnet'})`);

            const tokenURI = await contract.tokenURI(tokenId);
            logger.info(`Token URI: ${tokenURI}`);

            if (!tokenURI) {
                throw new Error('Token URI is empty');
            }

            const resolvedURI = this.resolveIPFS(tokenURI);
            const metadata = await this.fetchJSONMetadata(resolvedURI);

            const result = {
                tokenId,
                tokenURI,
                contractAddress,
                isMainnet,
                metadata,
                owner: null,
                projectInfo: null
            };

            try {
                result.owner = await contract.ownerOf(tokenId);
            } catch (error) {
                logger.warn(`Could not fetch owner for token ${tokenId}: ${error.message}`);
            }

            if (!isMainnet) {
                try {
                    const projectId = await contract.getTokenProject(tokenId);
                    const mintNumber = await contract.getTokenMintNumber(tokenId);
                    const projectInfo = await contract.getProjectInfo(projectId);
                    
                    result.projectInfo = {
                        projectId,
                        mintNumber,
                        name: projectInfo[0],
                        maxSupply: projectInfo[1].toString(),
                        mintCost: ethers.formatEther(projectInfo[2]),
                        currentSupply: projectInfo[3].toString(),
                        isActive: projectInfo[4],
                        projectURI: projectInfo[5]
                    };
                } catch (error) {
                    logger.warn(`Could not fetch project info for token ${tokenId}: ${error.message}`);
                }
            }

            return result;

        } catch (error) {
            logger.error(`Failed to fetch token metadata: ${error.message}`);
            throw error;
        }
    }

    async fetchJSONMetadata(uri) {
        try {
            logger.debug(`Fetching JSON metadata from: ${uri}`);
            
            const response = await axios.get(uri, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'MintTechBot/1.0'
                }
            });

            const metadata = response.data;
            logger.info(`Successfully fetched metadata for token`);
            logger.debug(`Metadata: ${JSON.stringify(metadata, null, 2)}`);
            
            return metadata;
        } catch (error) {
            // Try fallback metadata for MONGS tokens if blocked
            if (uri.includes('mongs.io') && (error.response?.status === 403 || error.response?.status === 429)) {
                logger.warn(`MONGS API blocked request (${error.response?.status}), using fallback metadata`);
                return this.getFallbackMongsMetadata(uri);
            }
            
            logger.error(`Failed to fetch JSON metadata from ${uri}: ${error.message}`);
            throw error;
        }
    }

    getFallbackMongsMetadata(uri) {
        const tokenId = uri.split('/').pop();
        return {
            name: `MONGS #${tokenId}`,
            description: "MONGS is a collection of digital collectibles living on the Ethereum blockchain.",
            image: "https://ipfs.io/ipfs/QmYjXWeCjqYbhwLhKPJBE9TJpRjMeYxRgKZW4kTzYPKPvN/placeholder.png",
            attributes: [
                {
                    trait_type: "Type",
                    value: "MONGS"
                },
                {
                    trait_type: "Generation",
                    value: "Genesis"
                },
                {
                    trait_type: "Rarity",
                    value: "Common"
                }
            ],
            external_url: `https://mongs.io/nft/${tokenId}`,
            background_color: "000000"
        };
    }

    async fetchMongsMetadataDirectly(tokenId) {
        try {
            // Use the direct IPFS NFT Storage link that bypasses API blocking
            const directUrl = `https://bafybeicueawvkhthacvoyeqlbnpwlumgffwgpxczvtexpm5no2hvyxkzey.ipfs.nftstorage.link/${tokenId}`;
            logger.info(`Trying direct IPFS NFT Storage: ${directUrl}`);
            
            const response = await axios.get(directUrl, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'MintTechBot/1.0'
                }
            });

            logger.info(`Successfully fetched MONGS metadata directly for token ${tokenId}`);
            return response.data;
        } catch (error) {
            logger.warn(`Direct IPFS fetch failed for token ${tokenId}: ${error.message}`);
            throw error;
        }
    }

    resolveIPFS(uri, gatewayIndex = 0) {
        if (uri.startsWith('ipfs://')) {
            const hash = uri.replace('ipfs://', '');
            const gateways = [
                `https://nftstorage.link/ipfs/${hash}`,
                `https://gateway.pinata.cloud/ipfs/${hash}`,
                `https://cloudflare-ipfs.com/ipfs/${hash}`,
                `https://ipfs.io/ipfs/${hash}`,
                `https://dweb.link/ipfs/${hash}`
            ];
            return gateways[gatewayIndex % gateways.length];
        }
        return uri;
    }

    async downloadImage(imageUrl, tokenId) {
        try {
            if (!imageUrl) return null;

            // Try multiple IPFS gateways
            const maxAttempts = 5;
            for (let gatewayIndex = 0; gatewayIndex < maxAttempts; gatewayIndex++) {
                try {
                    const resolvedImageUrl = this.resolveIPFS(imageUrl, gatewayIndex);
                    logger.info(`Attempting download from gateway ${gatewayIndex}: ${resolvedImageUrl}`);

                    const response = await axios.get(resolvedImageUrl, {
                        responseType: 'stream',
                        timeout: 8000, // Reduced timeout for faster failover
                        headers: {
                            'User-Agent': 'MintTechBot/1.0'
                        }
                    });

                    const ext = this.getImageExtension(resolvedImageUrl, response.headers['content-type']);
                    const filename = `token_${tokenId}_${Date.now()}.${ext}`;
                    const filepath = path.join(this.tempDir, filename);

                    const writer = require('fs').createWriteStream(filepath);
                    response.data.pipe(writer);

                    return new Promise((resolve, reject) => {
                        writer.on('finish', () => {
                            logger.info(`Image downloaded successfully: ${filepath}`);
                            resolve(filepath);
                        });
                        writer.on('error', (error) => {
                            logger.error(`Failed to write image: ${error.message}`);
                            reject(error);
                        });
                    });
                } catch (gatewayError) {
                    logger.warn(`Gateway ${gatewayIndex} failed: ${gatewayError.message}`);
                    if (gatewayIndex === maxAttempts - 1) {
                        throw gatewayError; // Last attempt failed
                    }
                    // Continue to next gateway
                }
            }
        } catch (error) {
            logger.error(`All image gateways failed: ${error.message}`);
            return null;
        }
    }

    getImageExtension(url, contentType) {
        if (contentType && contentType.includes('image/')) {
            const type = contentType.split('/')[1];
            if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(type)) {
                return type === 'svg' ? 'svg' : type;
            }
        }
        
        const urlExt = url.split('.').pop().toLowerCase();
        if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(urlExt)) {
            return urlExt;
        }
        
        return 'png';
    }

    async resizeImage(imagePath, maxWidth = 300, maxHeight = 300) {
        try {
            const resizedPath = imagePath.replace(/\.(png|jpg|jpeg)$/, '_resized.$1');
            
            await sharp(imagePath)
                .resize(maxWidth, maxHeight, {
                    fit: 'inside',
                    withoutEnlargement: true
                })
                .jpeg({ quality: 85 })
                .toFile(resizedPath);

            logger.info(`Image resized: ${resizedPath}`);
            return resizedPath;
        } catch (error) {
            logger.error(`Failed to resize image: ${error.message}`);
            return imagePath; // Return original if resize fails
        }
    }

    formatTraits(attributes) {
        if (!attributes || !Array.isArray(attributes) || attributes.length === 0) {
            return 'No traits available';
        }

        return attributes
            .map(attr => `• **${attr.trait_type}**: ${attr.value}`)
            .join('\n');
    }

    formatMetadataForTelegram(tokenData) {
        const { metadata, tokenId, contractAddress, projectInfo, owner, isMainnet } = tokenData;
        
        let message = '';
        
        if (metadata.name) {
            message += `🎨 **${metadata.name}**\n\n`;
        }
        
        // if (metadata.description) {
        //     message += `📝 ${metadata.description.substring(0, 200)}${metadata.description.length > 200 ? '...' : ''}\n\n`;
        // }

        // message += `🆔 **Token ID**: ${tokenId}\n`;
        // message += `📦 **Contract**: \`${contractAddress}\`\n`;
        // message += `🌐 **Network**: ${isMainnet ? 'Ethereum Mainnet' : 'Sepolia Testnet'}\n`;

        // if (owner) {
        //     message += `👤 **Owner**: \`${owner}\`\n`;
        // }

        // if (projectInfo) {
        //     message += `\n🎯 **Project Details**:\n`;
        //     message += `• **Name**: ${projectInfo.name}\n`;
        //     message += `• **Project ID**: ${projectInfo.projectId}\n`;
        //     message += `• **Mint Number**: ${projectInfo.mintNumber}\n`;
        //     message += `• **Supply**: ${projectInfo.currentSupply}/${projectInfo.maxSupply}\n`;
        //     message += `• **Mint Cost**: ${projectInfo.mintCost} ETH\n`;
        //     message += `• **Status**: ${projectInfo.isActive ? '🟢 Active' : '🔴 Inactive'}\n`;
        // }

        // if (metadata.attributes && metadata.attributes.length > 0) {
        //     message += `\n✨ **Traits**:\n`;
        //     message += this.formatTraits(metadata.attributes);
        // }

        if (metadata.external_url) {
            message += `\n🔗 [View Details](${metadata.external_url})`;
        }

        return message;
    }

    async getRandomMongsToken() {
        try {
            const randomTokenNumber = Math.floor(Math.random() * 6969) + 1;
            const tokenId = 1000000 + randomTokenNumber;
            
            // Try direct IPFS first, then fallback to regular method
            try {
                const metadata = await this.fetchMongsMetadataDirectly(tokenId);
                
                // Get owner from blockchain
                let owner = null;
                try {
                    const contract = new ethers.Contract(
                        '0xb4a7d131436ed8ec06ad696fa3bf8d23c0ab3acf',
                        this.mongsMainnetABI,
                        this.mainnetProvider
                    );
                    owner = await contract.ownerOf(tokenId);
                } catch (ownerError) {
                    logger.warn(`Could not fetch owner for token ${tokenId}: ${ownerError.message}`);
                }

                return {
                    tokenId,
                    tokenURI: `https://meta.mongs.io/token/${tokenId}`,
                    contractAddress: '0xb4a7d131436ed8ec06ad696fa3bf8d23c0ab3acf',
                    isMainnet: true,
                    metadata,
                    owner,
                    projectInfo: null
                };
            } catch (directError) {
                logger.warn(`Direct IPFS failed, trying regular method: ${directError.message}`);
                return await this.fetchTokenMetadata(
                    '0xb4a7d131436ed8ec06ad696fa3bf8d23c0ab3acf',
                    tokenId,
                    true
                );
            }
        } catch (error) {
            logger.error(`Failed to get random MONGS token: ${error.message}`);
            throw error;
        }
    }

    async getMongsInspiredToken(contractAddress, tokenId) {
        return await this.fetchTokenMetadata(contractAddress, tokenId, false);
    }

    async cleanupOldImages() {
        try {
            const files = await fs.readdir(this.tempDir);
            const now = Date.now();
            const maxAge = 24 * 60 * 60 * 1000;

            for (const file of files) {
                const filepath = path.join(this.tempDir, file);
                const stats = await fs.stat(filepath);
                
                if (now - stats.mtime.getTime() > maxAge) {
                    await fs.unlink(filepath);
                    logger.info(`Cleaned up old image: ${file}`);
                }
            }
        } catch (error) {
            logger.error(`Failed to cleanup old images: ${error.message}`);
        }
    }

    async testTokenFetch(contractAddress, tokenId) {
        try {
            logger.info(`Testing token fetch for ${contractAddress}:${tokenId}`);
            const tokenData = await this.fetchTokenMetadata(contractAddress, tokenId, false);
            
            if (tokenData.metadata.image) {
                const imagePath = await this.downloadImage(tokenData.metadata.image, tokenId);
                tokenData.imagePath = imagePath;
            }
            
            return tokenData;
        } catch (error) {
            logger.error(`Test token fetch failed: ${error.message}`);
            throw error;
        }
    }
}

module.exports = NFTMetadataService;