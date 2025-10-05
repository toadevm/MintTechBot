#!/bin/bash

# Solana Payment Receiver - Complete Deployment Script
# This script handles building, deploying, and initializing the program

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Owner address (already configured)
OWNER_ADDRESS="BaLNjxWWqMkYK57RvTq8kRrJS46TxMKSmEenJiYFMp3T"

echo -e "${GREEN}=== Solana Payment Receiver Deployment ===${NC}\n"

# Step 0: Setup environment
echo -e "${YELLOW}Setting up environment...${NC}"
export PATH="$HOME/.cargo/bin:$PATH"
export PATH="/home/toad/.local/share/solana/install/active_release/bin:$PATH"

# Step 1: Check dependencies
echo -e "\n${YELLOW}Checking dependencies...${NC}"

if ! command -v rustc &> /dev/null; then
    echo -e "${RED}❌ Rust not found. Please install Rust first.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Rust: $(rustc --version)${NC}"

if ! command -v solana &> /dev/null; then
    echo -e "${RED}❌ Solana CLI not found. Please install Solana CLI first.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Solana CLI: $(solana --version)${NC}"

if ! command -v anchor &> /dev/null; then
    echo -e "${RED}❌ Anchor not found. Please install Anchor CLI first.${NC}"
    echo "Run: cargo install --git https://github.com/coral-xyz/anchor avm --force"
    exit 1
fi
echo -e "${GREEN}✓ Anchor: $(anchor --version)${NC}"

# Step 2: Select network
echo -e "\n${YELLOW}Select deployment network:${NC}"
echo "1) Devnet (Free SOL for testing)"
echo "2) Mainnet (Real SOL required)"
read -p "Enter choice (1 or 2): " NETWORK_CHOICE

if [ "$NETWORK_CHOICE" = "1" ]; then
    CLUSTER="devnet"
    RPC_URL="https://api.devnet.solana.com"
elif [ "$NETWORK_CHOICE" = "2" ]; then
    CLUSTER="mainnet"
    RPC_URL="https://api.mainnet-beta.solana.com"
else
    echo -e "${RED}Invalid choice${NC}"
    exit 1
fi

echo -e "${GREEN}Selected: $CLUSTER${NC}"
solana config set --url $RPC_URL

# Step 3: Check wallet
echo -e "\n${YELLOW}Checking wallet...${NC}"
WALLET_ADDRESS=$(solana address)
BALANCE=$(solana balance | awk '{print $1}')

echo "Deployer wallet: $WALLET_ADDRESS"
echo "Balance: $BALANCE SOL"

if (( $(echo "$BALANCE < 2" | bc -l) )); then
    echo -e "${RED}⚠️  Low balance! You need at least 2 SOL to deploy.${NC}"
    if [ "$CLUSTER" = "devnet" ]; then
        read -p "Request airdrop? (y/n): " AIRDROP
        if [ "$AIRDROP" = "y" ]; then
            echo "Requesting airdrop..."
            solana airdrop 2
            echo "New balance: $(solana balance)"
        fi
    else
        echo "Please fund your wallet with at least 2 SOL and try again."
        exit 1
    fi
fi

# Step 4: Build program
echo -e "\n${YELLOW}Building program...${NC}"
anchor build

if [ ! -f "target/deploy/payment_receiver.so" ]; then
    echo -e "${RED}❌ Build failed. Program binary not found.${NC}"
    exit 1
fi

# Get program size
PROGRAM_SIZE=$(wc -c < target/deploy/payment_receiver.so)
PROGRAM_SIZE_KB=$((PROGRAM_SIZE / 1024))
echo -e "${GREEN}✓ Program built successfully (${PROGRAM_SIZE_KB} KB)${NC}"

# Step 5: Get program ID
PROGRAM_ID=$(solana address -k target/deploy/payment_receiver-keypair.json)
echo -e "\n${GREEN}Program ID: $PROGRAM_ID${NC}"

# Step 6: Check if program ID is configured correctly
echo -e "\n${YELLOW}Checking program ID configuration...${NC}"
DECLARED_ID=$(grep 'declare_id!' programs/payment_receiver/src/lib.rs | sed -n 's/.*declare_id!("\([^"]*\)").*/\1/p')

if [ "$DECLARED_ID" != "$PROGRAM_ID" ]; then
    echo -e "${YELLOW}⚠️  Program ID mismatch!${NC}"
    echo "Declared in code: $DECLARED_ID"
    echo "Actual keypair:   $PROGRAM_ID"
    echo -e "${YELLOW}Updating program ID in source code...${NC}"

    # Update lib.rs
    sed -i "s/declare_id!(\".*\");/declare_id!(\"$PROGRAM_ID\");/" programs/payment_receiver/src/lib.rs

    # Update Anchor.toml
    sed -i "s/payment_receiver = \".*\"/payment_receiver = \"$PROGRAM_ID\"/" Anchor.toml

    echo -e "${GREEN}✓ Program ID updated. Rebuilding...${NC}"
    anchor build
fi

# Step 7: Estimate costs
echo -e "\n${YELLOW}Estimated deployment costs:${NC}"
DEPLOY_COST=$(echo "scale=4; ($PROGRAM_SIZE * 2) / 1000000000" | bc)
echo "Deploy program: ~$DEPLOY_COST SOL (refundable rent)"
echo "Initialize: ~0.002 SOL"
TOTAL_COST=$(echo "$DEPLOY_COST + 0.002" | bc)
echo -e "${GREEN}Total: ~$TOTAL_COST SOL${NC}"

# Step 8: Confirm deployment
echo -e "\n${YELLOW}Deployment Summary:${NC}"
echo "Network: $CLUSTER"
echo "Program ID: $PROGRAM_ID"
echo "Owner: $OWNER_ADDRESS"
echo "Deployer: $WALLET_ADDRESS"
echo "Estimated cost: ~$TOTAL_COST SOL"
echo ""
read -p "Proceed with deployment? (y/n): " CONFIRM

if [ "$CONFIRM" != "y" ]; then
    echo "Deployment cancelled"
    exit 0
fi

# Step 9: Deploy
echo -e "\n${YELLOW}Deploying to $CLUSTER...${NC}"
anchor deploy --provider.cluster $CLUSTER

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Program deployed successfully!${NC}"
else
    echo -e "${RED}❌ Deployment failed${NC}"
    exit 1
fi

# Step 10: Initialize
echo -e "\n${YELLOW}Initializing program with owner $OWNER_ADDRESS...${NC}"
read -p "Proceed with initialization? (y/n): " INIT_CONFIRM

if [ "$INIT_CONFIRM" = "y" ]; then
    # Update provider cluster in script
    PROVIDER_CLUSTER=$CLUSTER ts-node scripts/initialize.ts

    if [ $? -eq 0 ]; then
        echo -e "\n${GREEN}✓ Program initialized successfully!${NC}"
    else
        echo -e "${RED}❌ Initialization failed${NC}"
        exit 1
    fi
fi

# Step 11: Summary
echo -e "\n${GREEN}=== Deployment Complete ===${NC}\n"
echo "Network: $CLUSTER"
echo "Program ID: $PROGRAM_ID"
echo "Owner: $OWNER_ADDRESS"
echo ""
echo "Explorer URL:"
if [ "$CLUSTER" = "devnet" ]; then
    echo "https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
else
    echo "https://explorer.solana.com/address/$PROGRAM_ID"
fi
echo ""
echo -e "${GREEN}Deployment successful! 🚀${NC}"
