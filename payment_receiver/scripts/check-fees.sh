#!/bin/bash

echo "=== Deployment Fee Estimation ==="
echo ""

# Build the program first
echo "Building program..."
anchor build

# Get program binary size
PROGRAM_PATH="target/deploy/payment_receiver.so"
if [ -f "$PROGRAM_PATH" ]; then
    SIZE=$(wc -c < "$PROGRAM_PATH")
    SIZE_KB=$((SIZE / 1024))
    echo "Program size: $SIZE bytes ($SIZE_KB KB)"
    echo ""

    # Estimate deployment cost (roughly 2x the binary size in lamports on devnet)
    # Actual cost varies but this gives a ballpark
    DEPLOY_COST_LAMPORTS=$((SIZE * 2))
    DEPLOY_COST_SOL=$(echo "scale=4; $DEPLOY_COST_LAMPORTS / 1000000000" | bc)

    echo "Estimated deployment cost: ~$DEPLOY_COST_SOL SOL"
    echo ""
else
    echo "Program binary not found. Run 'anchor build' first."
    exit 1
fi

# Check wallet balance
echo "Current wallet: $(solana address)"
echo "Current balance: $(solana balance --url devnet)"
echo ""

# Estimate initialization costs
echo "Initialization account rent costs:"
echo "- PaymentState account: ~0.002 SOL"
echo "- Transaction fee: ~0.00001 SOL"
echo "Total initialization: ~0.0021 SOL"
echo ""

TOTAL=$(echo "scale=4; $DEPLOY_COST_SOL + 0.0021" | bc)
echo "=== Total estimated cost: ~$TOTAL SOL ==="
echo ""
echo "Recommended: Have at least $(echo "$TOTAL + 0.1" | bc) SOL in deployer wallet"
