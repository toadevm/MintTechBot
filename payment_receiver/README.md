# Solana Payment Receiver Program

A Solana program equivalent to the SimplePaymentReceiver Ethereum contract. Receives SOL payments, tracks payment history, and allows owner withdrawals.

## Features

- ✅ Accept SOL payments with automatic tracking
- ✅ Store payment history (payer, amount, timestamp)
- ✅ Owner-only withdrawal functionality
- ✅ Transfer ownership capability
- ✅ Query payment records and vault balance
- ✅ Event logging via Solana transaction logs

## Program Architecture

### Accounts

**PaymentState** (PDA: `["payment_state"]`)
- Owner pubkey
- Total payment count
- Bump seed

**PaymentRecord** (PDA: `["payment", payment_id]`)
- Payment ID
- Payer pubkey
- Amount in lamports
- Unix timestamp
- Bump seed

**Vault** (PDA: `["vault", payment_state]`)
- System account holding all received SOL

### Instructions

1. **initialize** - Initialize the payment receiver with owner
2. **receive_payment** - Accept SOL payment and create payment record
3. **withdraw** - Withdraw all vault funds to owner
4. **transfer_ownership** - Transfer program authority to new owner

## Setup

### Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Install Anchor
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest
avm use latest
```

### Build

```bash
cd payment_receiver
anchor build
```

### Test

```bash
# Run on localnet
anchor test

# Run on devnet
anchor test --provider.cluster devnet
```

### Deploy

```bash
# Deploy to devnet
anchor deploy --provider.cluster devnet

# Deploy to mainnet
anchor deploy --provider.cluster mainnet
```

## Client SDK Usage

```typescript
import { PaymentReceiverClient } from "./client/sdk";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

// Initialize client
const connection = new Connection("https://api.devnet.solana.com");
const wallet = new anchor.Wallet(Keypair.generate());
const programId = new PublicKey("YOUR_PROGRAM_ID");

const client = new PaymentReceiverClient(programId, connection, wallet);

// Initialize program
await client.initialize(wallet.publicKey);

// Send payment
const paymentAmount = 0.1 * LAMPORTS_PER_SOL;
await client.receivePayment(wallet.publicKey, paymentAmount);

// Get vault balance
const balance = await client.getVaultBalanceInSOL();
console.log(`Vault balance: ${balance} SOL`);

// Get all payments
const payments = await client.getAllPayments();
console.log("Payment history:", payments);

// Withdraw funds (owner only)
await client.withdraw(wallet.publicKey);

// Transfer ownership
const newOwner = Keypair.generate();
await client.transferOwnership(wallet.publicKey, newOwner.publicKey);
```

## Monitoring Payments

Payment events are logged in transaction logs:

```
Program log: Payment received - ID: 1, Payer: ABC..., Amount: 100000000 lamports, Timestamp: 1234567890
```

You can monitor these using:
- Solana Explorer
- `solana logs` CLI command
- WebSocket subscriptions
- Transaction signature polling

## Comparison with Ethereum Contract

| Feature | Ethereum | Solana |
|---------|----------|--------|
| Payment acceptance | `receive()` function | `receive_payment` instruction |
| Storage | Contract storage | PDA accounts |
| Events | Solidity events | Program logs |
| Ownership | `onlyOwner` modifier | `has_one = owner` constraint |
| Payment tracking | Mapping | PDA per payment |
| Balance query | `address(this).balance` | `getBalance(vault)` |

## Security Considerations

- ✅ Owner-only access control via `has_one` constraint
- ✅ PDA-based vault prevents direct access
- ✅ No rent exemption issues (accounts properly sized)
- ✅ No reentrancy vulnerabilities (Solana model)
- ⚠️ Owner key security is critical - use hardware wallet

## Program Addresses

- **Localnet**: Generated on each test run
- **Devnet**: Update in `Anchor.toml` after first deployment
- **Mainnet**: Update in `Anchor.toml` after first deployment

## License

MIT
