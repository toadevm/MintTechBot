const { ethers } = require('ethers');
const fs = require('fs');
require('dotenv').config();

async function deploySimplePaymentReceiver() {
    try {
        console.log('🚀 Deploying SimplePaymentReceiver contract...');

        const provider = new ethers.JsonRpcProvider(`https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`);
        const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

        const contractSource = fs.readFileSync('./contracts/SimplePaymentReceiver.sol', 'utf8');
        console.log('✅ Contract source loaded');

        const solc = require('solc');
        const input = {
            language: 'Solidity',
            sources: {
                'SimplePaymentReceiver.sol': {
                    content: contractSource,
                },
            },
            settings: {
                outputSelection: {
                    '*': {
                        '*': ['*'],
                    },
                },
            },
        };

        console.log('⚙️ Compiling contract...');
        const output = JSON.parse(solc.compile(JSON.stringify(input)));

        if (output.errors) {
            for (const error of output.errors) {
                if (error.severity === 'error') {
                    console.error('❌ Compilation error:', error.formattedMessage);
                    return;
                }
                console.warn('⚠️ Warning:', error.formattedMessage);
            }
        }

        const contract = output.contracts['SimplePaymentReceiver.sol']['SimplePaymentReceiver'];
        const bytecode = contract.evm.bytecode.object;
        const abi = contract.abi;

        console.log('✅ Contract compiled successfully');

        const contractFactory = new ethers.ContractFactory(abi, bytecode, wallet);
        
        console.log('📡 Deploying to Sepolia testnet...');
        const deployedContract = await contractFactory.deploy();
        
        console.log('⏳ Waiting for deployment confirmation...');
        await deployedContract.waitForDeployment();
        
        const contractAddress = await deployedContract.getAddress();
        console.log('🎉 SimplePaymentReceiver deployed at:', contractAddress);

        const balance = await provider.getBalance(contractAddress);
        console.log('💰 Contract balance:', ethers.formatEther(balance), 'ETH');

        const owner = await deployedContract.owner();
        console.log('👑 Contract owner:', owner);

        console.log('\n📝 Contract ABI saved to SimplePaymentReceiver_ABI.json');
        fs.writeFileSync('./SimplePaymentReceiver_ABI.json', JSON.stringify(abi, null, 2));

        console.log('\n🔧 Environment variables to update:');
        console.log(`SIMPLE_PAYMENT_CONTRACT_ADDRESS=${contractAddress}`);

        console.log('\n🔍 Etherscan link:');
        console.log(`https://sepolia.etherscan.io/address/${contractAddress}`);

        return contractAddress;
    } catch (error) {
        console.error('❌ Deployment failed:', error);
    }
}

deploySimplePaymentReceiver();