import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";

async function main() {
  // Configure the client to use devnet
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PaymentReceiver as Program;

  // Owner address - this address will have control over withdrawals
  const OWNER_ADDRESS = new PublicKey("BaLNjxWWqMkYK57RvTq8kRrJS46TxMKSmEenJiYFMp3T");

  // The deployer wallet pays for initialization, but OWNER_ADDRESS will be the owner
  const deployerWallet = provider.wallet.publicKey;

  console.log("Program ID:", program.programId.toString());
  console.log("Deployer (payer):", deployerWallet.toString());
  console.log("Owner:", OWNER_ADDRESS.toString());

  // Derive PDAs
  const [paymentStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("payment_state")],
    program.programId
  );

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), paymentStatePda.toBuffer()],
    program.programId
  );

  console.log("\nPayment State PDA:", paymentStatePda.toString());
  console.log("Vault PDA:", vaultPda.toString());

  // Initialize the program with the specified owner
  console.log("\nInitializing payment receiver...");
  const tx = await program.methods
    .initialize(OWNER_ADDRESS)
    .accounts({
      paymentState: paymentStatePda,
      vault: vaultPda,
      payer: deployerWallet,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("✅ Initialized successfully!");
  console.log("Transaction signature:", tx);

  // Verify the initialization
  const paymentState = await program.account.paymentState.fetch(paymentStatePda);
  console.log("\nVerification:");
  console.log("- Owner:", paymentState.owner.toString());
  console.log("- Total Payments:", paymentState.totalPayments.toString());
  console.log("- Matches expected owner:", paymentState.owner.equals(OWNER_ADDRESS));
}

main()
  .then(() => {
    console.log("\n✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
