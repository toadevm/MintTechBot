# Complete Installation & Deployment Guide

## System Requirements

You need sudo access to install all dependencies.

## Step 1: Install Build Dependencies

```bash
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  pkg-config \
  libudev-dev \
  llvm \
  libclang-dev \
  protobuf-compiler \
  libssl-dev \
  curl \
  git
```

## Step 2: Install Rust (Already Done ✓)

```bash
# Already installed, verify:
rustc --version
cargo --version
```

Expected output:
```
rustc 1.90.0 (1159e78c4 2025-09-14)
cargo 1.90.0 (840b83a10 2025-07-30)
```

## Step 3: Install Solana CLI (Already Done ✓)

```bash
# Already installed, verify:
export PATH="/home/toad/.local/share/solana/install/active_release/bin:$PATH"
solana --version
```

Expected output:
```
solana-cli 2.3.12 (src:f1c269ac; feat:2142755730, client:Agave)
```

## Step 4: Install Anchor CLI

After installing build dependencies, run:

```bash
export PATH="$HOME/.cargo/bin:$PATH"
cargo install --git https://github.com/coral-xyz/anchor avm --force
```

This will take 10-15 minutes. Then:

```bash
avm install latest
avm use latest
anchor --version
```

Expected output: `anchor-cli 0.30.x`

## Step 5: Setup Solana Wallet

### Option A: Use existing wallet
```bash
export PATH="/home/toad/.local/share/solana/install/active_release/bin:$PATH"
solana config set --url https://api.mainnet-beta.solana.com
solana config set --keypair /path/to/your/keypair.json
```

### Option B: Create new wallet (DEVNET TESTING ONLY)
```bash
export PATH="/home/toad/.local/share/solana/install/active_release/bin:$PATH"
solana-keygen new --outfile ~/solana-wallet.json
solana config set --keypair ~/solana-wallet.json
```

### For Devnet Testing
```bash
solana config set --url https://api.devnet.solana.com
solana airdrop 2
solana balance
```

### For Mainnet Deployment
```bash
solana config set --url https://api.mainnet-beta.solana.com
# You need to fund this wallet with real SOL (~2-3 SOL)
solana balance
```

## Step 6: Build the Program

```bash
cd /home/toad/Documents/Builds/candy_rush/payment_receiver
export PATH="$HOME/.cargo/bin:$PATH"
export PATH="/home/toad/.local/share/solana/install/active_release/bin:$PATH"

anchor build
```

## Step 7: Update Program ID

```bash
# Get the program ID
solana address -k target/deploy/payment_receiver-keypair.json
```

Copy the output and update:

**File: `programs/payment_receiver/src/lib.rs` (line 3)**
```rust
declare_id!("PASTE_YOUR_PROGRAM_ID_HERE");
```

**File: `Anchor.toml`**
```toml
[programs.localnet]
payment_receiver = "PASTE_YOUR_PROGRAM_ID_HERE"

[programs.devnet]
payment_receiver = "PASTE_YOUR_PROGRAM_ID_HERE"

[programs.mainnet]
payment_receiver = "PASTE_YOUR_PROGRAM_ID_HERE"
```

Then rebuild:
```bash
anchor build
```

## Step 8: Check Deployment Fees

```bash
./scripts/check-fees.sh
```

## Step 9: Deploy

### Devnet (Testing)
```bash
solana config set --url https://api.devnet.solana.com
anchor deploy --provider.cluster devnet
```

### Mainnet (Production)
```bash
solana config set --url https://api.mainnet-beta.solana.com
anchor deploy --provider.cluster mainnet
```

## Step 10: Initialize with Owner

The owner address is already set to: `BaLNjxWWqMkYK57RvTq8kRrJS46TxMKSmEenJiYFMp3T`

### Devnet
```bash
anchor run initialize --provider.cluster devnet
```

### Mainnet
```bash
anchor run initialize --provider.cluster mainnet
```

Or run the script directly:
```bash
export PATH="$HOME/.cargo/bin:$PATH"
export PATH="/home/toad/.local/share/solana/install/active_release/bin:$PATH"
ts-node scripts/initialize.ts
```

## Verification

After deployment and initialization:

```bash
# Get your program ID
PROGRAM_ID=$(solana address -k target/deploy/payment_receiver-keypair.json)

# View on Explorer (Devnet)
echo "https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"

# View on Explorer (Mainnet)
echo "https://explorer.solana.com/address/$PROGRAM_ID"
```

## Cost Breakdown

### Devnet (FREE SOL via airdrop)
- Deploy: ~1-2 SOL (refundable)
- Initialize: ~0.002 SOL
- Total: ~2 SOL

### Mainnet (REAL SOL)
- Deploy: ~1-2 SOL (refundable)
- Initialize: ~0.002 SOL
- Total: ~2 SOL (Have 3 SOL to be safe)

## Important Notes

1. **Owner Address**: `BaLNjxWWqMkYK57RvTq8kRrJS46TxMKSmEenJiYFMp3T`
   - This address will control withdrawals
   - You only need the private key when withdrawing funds
   - You do NOT need it for deployment

2. **Deployer Wallet**: Whatever wallet you configure with `solana config`
   - Pays for deployment and initialization
   - No special privileges after initialization

3. **Program Binary**: The compiled program at `target/deploy/payment_receiver.so`
   - This gets deployed to Solana
   - Size determines deployment cost

4. **Rent**: Solana accounts require rent
   - Deployment cost is mostly rent (refundable)
   - Small accounts like PaymentState require ~0.002 SOL

## Troubleshooting

### "anchor: command not found"
```bash
export PATH="$HOME/.cargo/bin:$PATH"
```

### "solana: command not found"
```bash
export PATH="/home/toad/.local/share/solana/install/active_release/bin:$PATH"
```

### Add to ~/.bashrc permanently
```bash
echo 'export PATH="$HOME/.cargo/bin:$PATH"' >> ~/.bashrc
echo 'export PATH="/home/toad/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### Insufficient funds
```bash
# Devnet
solana airdrop 2 --url devnet

# Mainnet
# Transfer SOL to your wallet address from an exchange
```

### Build errors
```bash
# Clean and rebuild
anchor clean
anchor build
```
