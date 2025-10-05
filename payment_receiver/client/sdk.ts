import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Connection, PublicKey, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";

export class PaymentReceiverClient {
  program: Program;
  provider: AnchorProvider;
  paymentStatePda: PublicKey;
  vaultPda: PublicKey;

  constructor(
    programId: PublicKey,
    connection: Connection,
    wallet: anchor.Wallet
  ) {
    this.provider = new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    this.program = new Program(
      require("../target/idl/payment_receiver.json"),
      programId,
      this.provider
    );

    [this.paymentStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("payment_state")],
      programId
    );

    [this.vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), this.paymentStatePda.toBuffer()],
      programId
    );
  }

  async initialize(owner: PublicKey, payer: PublicKey): Promise<string> {
    const tx = await this.program.methods
      .initialize(owner)
      .accounts({
        paymentState: this.paymentStatePda,
        vault: this.vaultPda,
        payer: payer,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  async receivePayment(payer: PublicKey, amount: number): Promise<string> {
    const paymentState = await this.program.account.paymentState.fetch(
      this.paymentStatePda
    );

    const nextPaymentId = paymentState.totalPayments.toNumber() + 1;

    const [paymentRecordPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("payment"),
        new anchor.BN(nextPaymentId).toArrayLike(Buffer, "le", 8),
      ],
      this.program.programId
    );

    const tx = await this.program.methods
      .receivePayment(new anchor.BN(amount))
      .accounts({
        paymentState: this.paymentStatePda,
        paymentRecord: paymentRecordPda,
        vault: this.vaultPda,
        payer: payer,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  async withdraw(owner: PublicKey): Promise<string> {
    const tx = await this.program.methods
      .withdraw()
      .accounts({
        paymentState: this.paymentStatePda,
        vault: this.vaultPda,
        owner: owner,
      })
      .rpc();

    return tx;
  }

  async transferOwnership(
    currentOwner: PublicKey,
    newOwner: PublicKey
  ): Promise<string> {
    const tx = await this.program.methods
      .transferOwnership(newOwner)
      .accounts({
        paymentState: this.paymentStatePda,
        owner: currentOwner,
      })
      .rpc();

    return tx;
  }

  async getPaymentState(): Promise<any> {
    return await this.program.account.paymentState.fetch(this.paymentStatePda);
  }

  async getPaymentRecord(paymentId: number): Promise<any> {
    const [paymentRecordPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("payment"),
        new anchor.BN(paymentId).toArrayLike(Buffer, "le", 8),
      ],
      this.program.programId
    );

    return await this.program.account.paymentRecord.fetch(paymentRecordPda);
  }

  async getAllPayments(): Promise<any[]> {
    return await this.program.account.paymentRecord.all();
  }

  async getRecentPayments(count: number): Promise<any[]> {
    const allPayments = await this.getAllPayments();
    return allPayments.slice(-count);
  }

  async getVaultBalance(): Promise<number> {
    return await this.provider.connection.getBalance(this.vaultPda);
  }

  async getVaultBalanceInSOL(): Promise<number> {
    const balance = await this.getVaultBalance();
    return balance / LAMPORTS_PER_SOL;
  }
}

export interface PaymentInfo {
  paymentId: number;
  payer: string;
  amount: number;
  timestamp: number;
}

export async function formatPaymentRecords(
  client: PaymentReceiverClient
): Promise<PaymentInfo[]> {
  const records = await client.getAllPayments();

  return records.map((record) => ({
    paymentId: record.account.paymentId.toNumber(),
    payer: record.account.payer.toString(),
    amount: record.account.amount.toNumber(),
    timestamp: record.account.timestamp.toNumber(),
  }));
}
