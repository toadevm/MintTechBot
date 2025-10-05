# Quick Start - Deployment with Separate Owner

## Your Configuration

- **Owner Address**: `BaLNjxWWqMkYK57RvTq8kRrJS46TxMKSmEenJiYFMp3T`
- **Deployer**: Your current Solana CLI wallet (pays fees, no special privileges after init)

## Prerequisites

```bash
# Check you have the required tools
solana --version
anchor --version
node --version
```

## Step-by-Step Deployment

### 1. Check Your Deployer Wallet

```bash
# See which wallet will deploy
solana address

# Check balance (you need SOL for fees)
solana balance --url devnet

# If balance is low, get devnet SOL
solana airdrop 2 --url devnet
```

### 2. Estimate Deployment Fees

```bash
cd payment_receiver
./scripts/check-fees.sh
```

This will show you:
- Program binary size
- Estimated deployment cost
- Initialization cost
- Total cost estimate

### 3. Build the Program

```bash
anchor build
```

### 4. Get Your Program ID

```bash
solana address -k target/deploy/payment_receiver-keypair.json
```

Copy this program ID and update it in two places:

**a) In `programs/payment_receiver/src/lib.rs` line 3:**
```rust
declare_id!("YOUR_PROGRAM_ID_HERE");
```

**b) In `Anchor.toml` under `[programs.devnet]`:**
```toml
payment_receiver = "YOUR_PROGRAM_ID_HERE"
```

Then rebuild:
```bash
anchor build
```

### 5. Deploy to Devnet

```bash
anchor deploy --provider.cluster devnet
```

Expected output:
```
Deploying cluster: https://api.devnet.solana.com
Program deployed successfully
Program Id: YOUR_PROGRAM_ID
```

### 6. Initialize with Owner Address

The script is already configured with your owner address `BaLNjxWWqMkYK57RvTq8kRrJS46TxMKSmEenJiYFMp3T`.

```bash
anchor run initialize --provider.cluster devnet
```

Or directly:
```bash
ts-node scripts/initialize.ts
```

You should see:
```
Program ID: YOUR_PROGRAM_ID
Deployer (payer): YOUR_DEPLOYER_ADDRESS
Owner: BaLNjxWWqMkYK57RvTq8kRrJS46TxMKSmEenJiYFMp3T

Payment State PDA: ...
Vault PDA: ...

✅ Initialized successfully!
Transaction signature: ...

Verification:
- Owner: BaLNjxWWqMkYK57RvTq8kRrJS46TxMKSmEenJiYFMp3T
- Total Payments: 0
- Matches expected owner: true
```

## What This Means

✅ **Deployer wallet** (your current wallet):
- Paid for deployment
- Paid for initialization
- Has NO special privileges after initialization

✅ **Owner address** (`BaLNjxWWqMkYK57RvTq8kRrJS46TxMKSmEenJiYFMp3T`):
- Can withdraw all funds from vault
- Can transfer ownership to another address
- Needs private key ONLY when withdrawing or transferring ownership

## Testing the Program

### Send a test payment

```bash
# Get the program ID
PROGRAM_ID=$(solana address -k target/deploy/payment_receiver-keypair.json)

# Run tests
anchor test --skip-local-validator --provider.cluster devnet
```

### Check vault balance

```bash
# First, get the vault PDA from the initialization output above, then:
solana balance VAULT_PDA_ADDRESS --url devnet
```

## Next Steps

- Save the Program ID, Payment State PDA, and Vault PDA addresses
- Share the Program ID with users who want to send payments
- Use the owner wallet (with private key) only when withdrawing funds
- Monitor payments via Solana Explorer: `https://explorer.solana.com/address/PROGRAM_ID?cluster=devnet`

## Cost Summary (Typical)

- **Deployment**: ~0.5-2 SOL (one-time, refundable if you close the program)
- **Initialization**: ~0.002 SOL (rent for accounts)
- **Per payment**: ~0.00001 SOL (transaction fee paid by sender)
- **Withdrawal**: ~0.00001 SOL (transaction fee paid by owner)

**Note**: Devnet SOL is free for testing. Mainnet costs real SOL.
