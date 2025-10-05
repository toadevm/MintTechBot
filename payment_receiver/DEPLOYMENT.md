# Deployment Guide

## Setting a Different Owner on Initialization

The program now supports deploying with one wallet but setting a different address as the owner.

### How It Works

- **Deployer wallet**: Pays for transaction fees and rent
- **Owner address**: Has control over withdrawals and ownership transfers

### Steps to Deploy

#### 1. Edit the initialization script

Open `scripts/initialize.ts` and replace `YOUR_OWNER_ADDRESS_HERE` with your desired owner address:

```typescript
const OWNER_ADDRESS = new PublicKey("YOUR_ACTUAL_OWNER_PUBKEY_HERE");
```

#### 2. Build the program

```bash
cd payment_receiver
anchor build
```

#### 3. Deploy to Devnet

```bash
anchor deploy --provider.cluster devnet
```

Note the program ID from the output and update it in:
- `Anchor.toml` (under `[programs.devnet]`)
- `programs/payment_receiver/src/lib.rs` (in `declare_id!()`)

Then rebuild:
```bash
anchor build
anchor deploy --provider.cluster devnet
```

#### 4. Initialize with your owner address

```bash
anchor run initialize --provider.cluster devnet
```

Or using the script directly:
```bash
ts-node scripts/initialize.ts
```

### Example Usage

Let's say you want to:
- Deploy using wallet: `DeployerWallet111111111111111111111111111111`
- Set owner as: `OwnerWallet222222222222222222222222222222222`

1. Edit `scripts/initialize.ts`:
```typescript
const OWNER_ADDRESS = new PublicKey("OwnerWallet222222222222222222222222222222222");
```

2. Deploy with deployer wallet (set in `~/.config/solana/id.json`):
```bash
anchor deploy --provider.cluster devnet
```

3. Initialize:
```bash
anchor run initialize --provider.cluster devnet
```

Now:
- `OwnerWallet222...` can withdraw funds and transfer ownership
- `DeployerWallet111...` has no special privileges after initialization

### Client SDK Usage

```typescript
import { PaymentReceiverClient } from "./client/sdk";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";

const connection = new Connection("https://api.devnet.solana.com");
const deployerKeypair = Keypair.fromSecretKey(/* deployer secret key */);
const ownerPubkey = new PublicKey("YOUR_OWNER_ADDRESS");

const wallet = new anchor.Wallet(deployerKeypair);
const programId = new PublicKey("YOUR_PROGRAM_ID");

const client = new PaymentReceiverClient(programId, connection, wallet);

// Deployer initializes, but owner gets control
await client.initialize(ownerPubkey, deployerKeypair.publicKey);
```

### Verification

After initialization, verify the owner:

```bash
# Get payment state account
solana account <PAYMENT_STATE_PDA> --output json

# Or using the SDK
const paymentState = await client.getPaymentState();
console.log("Owner:", paymentState.owner.toString());
```

### Security Notes

⚠️ **Important**: The owner address has full control over:
- Withdrawing all funds from the vault
- Transferring ownership to another address

Make sure you:
- ✅ Control the private key for the owner address
- ✅ Store the owner private key securely (hardware wallet recommended)
- ✅ Verify the owner address before initializing
- ✅ Double-check the address - ownership transfer requires the current owner's signature
