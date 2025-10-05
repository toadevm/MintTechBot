import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert, expect } from "chai";

describe("payment-receiver", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PaymentReceiver as Program;

  let paymentStatePda: PublicKey;
  let vaultPda: PublicKey;
  let paymentStateBump: number;
  let vaultBump: number;

  before(async () => {
    [paymentStatePda, paymentStateBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("payment_state")],
      program.programId
    );

    [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), paymentStatePda.toBuffer()],
      program.programId
    );
  });

  it("Initializes the payment receiver", async () => {
    const tx = await program.methods
      .initialize(provider.wallet.publicKey)
      .accounts({
        paymentState: paymentStatePda,
        vault: vaultPda,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Initialize transaction signature", tx);

    const paymentState = await program.account.paymentState.fetch(paymentStatePda);

    assert.ok(paymentState.owner.equals(provider.wallet.publicKey));
    assert.equal(paymentState.totalPayments.toNumber(), 0);
  });

  it("Receives a payment", async () => {
    const paymentAmount = 0.1 * LAMPORTS_PER_SOL;
    const paymentId = 1;

    const [paymentRecordPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("payment"),
        new anchor.BN(paymentId).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    const vaultBalanceBefore = await provider.connection.getBalance(vaultPda);

    const tx = await program.methods
      .receivePayment(new anchor.BN(paymentAmount))
      .accounts({
        paymentState: paymentStatePda,
        paymentRecord: paymentRecordPda,
        vault: vaultPda,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Receive payment transaction signature", tx);

    const paymentState = await program.account.paymentState.fetch(paymentStatePda);
    assert.equal(paymentState.totalPayments.toNumber(), 1);

    const paymentRecord = await program.account.paymentRecord.fetch(paymentRecordPda);
    assert.equal(paymentRecord.paymentId.toNumber(), paymentId);
    assert.ok(paymentRecord.payer.equals(provider.wallet.publicKey));
    assert.equal(paymentRecord.amount.toNumber(), paymentAmount);
    assert.ok(paymentRecord.timestamp.toNumber() > 0);

    const vaultBalanceAfter = await provider.connection.getBalance(vaultPda);
    assert.equal(vaultBalanceAfter - vaultBalanceBefore, paymentAmount);
  });

  it("Receives multiple payments", async () => {
    const paymentAmount = 0.05 * LAMPORTS_PER_SOL;

    for (let i = 2; i <= 3; i++) {
      const [paymentRecordPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("payment"),
          new anchor.BN(i).toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      await program.methods
        .receivePayment(new anchor.BN(paymentAmount))
        .accounts({
          paymentState: paymentStatePda,
          paymentRecord: paymentRecordPda,
          vault: vaultPda,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    const paymentState = await program.account.paymentState.fetch(paymentStatePda);
    assert.equal(paymentState.totalPayments.toNumber(), 3);
  });

  it("Withdraws funds", async () => {
    const ownerBalanceBefore = await provider.connection.getBalance(provider.wallet.publicKey);
    const vaultBalanceBefore = await provider.connection.getBalance(vaultPda);

    const tx = await program.methods
      .withdraw()
      .accounts({
        paymentState: paymentStatePda,
        vault: vaultPda,
        owner: provider.wallet.publicKey,
      })
      .rpc();

    console.log("Withdraw transaction signature", tx);

    const vaultBalanceAfter = await provider.connection.getBalance(vaultPda);
    assert.equal(vaultBalanceAfter, 0);

    const ownerBalanceAfter = await provider.connection.getBalance(provider.wallet.publicKey);
    assert.ok(ownerBalanceAfter > ownerBalanceBefore);
  });

  it("Fails to withdraw when no funds available", async () => {
    try {
      await program.methods
        .withdraw()
        .accounts({
          paymentState: paymentStatePda,
          vault: vaultPda,
          owner: provider.wallet.publicKey,
        })
        .rpc();

      assert.fail("Should have failed with no funds error");
    } catch (err) {
      assert.include(err.toString(), "NoFundsToWithdraw");
    }
  });

  it("Transfers ownership", async () => {
    const newOwner = anchor.web3.Keypair.generate();

    const tx = await program.methods
      .transferOwnership(newOwner.publicKey)
      .accounts({
        paymentState: paymentStatePda,
        owner: provider.wallet.publicKey,
      })
      .rpc();

    console.log("Transfer ownership transaction signature", tx);

    const paymentState = await program.account.paymentState.fetch(paymentStatePda);
    assert.ok(paymentState.owner.equals(newOwner.publicKey));
  });

  it("Fetches payment records", async () => {
    const allPaymentRecords = await program.account.paymentRecord.all();

    console.log(`\nTotal payment records: ${allPaymentRecords.length}`);

    allPaymentRecords.forEach((record, index) => {
      console.log(`\nPayment ${index + 1}:`);
      console.log(`  ID: ${record.account.paymentId.toString()}`);
      console.log(`  Payer: ${record.account.payer.toString()}`);
      console.log(`  Amount: ${record.account.amount.toNumber() / LAMPORTS_PER_SOL} SOL`);
      console.log(`  Timestamp: ${new Date(record.account.timestamp.toNumber() * 1000).toISOString()}`);
    });

    assert.equal(allPaymentRecords.length, 3);
  });
});
