use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod payment_receiver {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey) -> Result<()> {
        let payment_state = &mut ctx.accounts.payment_state;
        payment_state.owner = owner;
        payment_state.total_payments = 0;
        payment_state.bump = ctx.bumps.payment_state;

        msg!("Payment receiver initialized with owner: {}", owner);
        Ok(())
    }

    pub fn receive_payment(ctx: Context<ReceivePayment>, amount: u64) -> Result<()> {
        let payment_state = &mut ctx.accounts.payment_state;
        payment_state.total_payments += 1;

        let payment_record = &mut ctx.accounts.payment_record;
        payment_record.payment_id = payment_state.total_payments;
        payment_record.payer = ctx.accounts.payer.key();
        payment_record.amount = amount;
        payment_record.timestamp = Clock::get()?.unix_timestamp;
        payment_record.bump = ctx.bumps.payment_record;

        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.payer.key(),
            &ctx.accounts.vault.key(),
            amount,
        );

        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.vault.to_account_info(),
            ],
        )?;

        msg!(
            "Payment received - ID: {}, Payer: {}, Amount: {} lamports, Timestamp: {}",
            payment_record.payment_id,
            payment_record.payer,
            payment_record.amount,
            payment_record.timestamp
        );

        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        let vault_balance = ctx.accounts.vault.lamports();
        require!(vault_balance > 0, ErrorCode::NoFundsToWithdraw);

        let payment_state = &ctx.accounts.payment_state;
        let seeds = &[
            b"vault",
            payment_state.key().as_ref(),
            &[payment_state.bump],
        ];
        let signer = &[&seeds[..]];

        **ctx.accounts.vault.try_borrow_mut_lamports()? -= vault_balance;
        **ctx.accounts.owner.try_borrow_mut_lamports()? += vault_balance;

        msg!("Withdrawn {} lamports to owner", vault_balance);
        Ok(())
    }

    pub fn transfer_ownership(ctx: Context<TransferOwnership>, new_owner: Pubkey) -> Result<()> {
        require!(new_owner != Pubkey::default(), ErrorCode::InvalidNewOwner);

        let payment_state = &mut ctx.accounts.payment_state;
        let old_owner = payment_state.owner;
        payment_state.owner = new_owner;

        msg!("Ownership transferred from {} to {}", old_owner, new_owner);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + PaymentState::INIT_SPACE,
        seeds = [b"payment_state"],
        bump
    )]
    pub payment_state: Account<'info, PaymentState>,

    #[account(
        seeds = [b"vault", payment_state.key().as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReceivePayment<'info> {
    #[account(
        mut,
        seeds = [b"payment_state"],
        bump = payment_state.bump
    )]
    pub payment_state: Account<'info, PaymentState>,

    #[account(
        init,
        payer = payer,
        space = 8 + PaymentRecord::INIT_SPACE,
        seeds = [b"payment", payment_state.total_payments.checked_add(1).unwrap().to_le_bytes().as_ref()],
        bump
    )]
    pub payment_record: Account<'info, PaymentRecord>,

    #[account(
        mut,
        seeds = [b"vault", payment_state.key().as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        seeds = [b"payment_state"],
        bump = payment_state.bump,
        has_one = owner
    )]
    pub payment_state: Account<'info, PaymentState>,

    #[account(
        mut,
        seeds = [b"vault", payment_state.key().as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,

    #[account(mut)]
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct TransferOwnership<'info> {
    #[account(
        mut,
        seeds = [b"payment_state"],
        bump = payment_state.bump,
        has_one = owner
    )]
    pub payment_state: Account<'info, PaymentState>,

    pub owner: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct PaymentState {
    pub owner: Pubkey,
    pub total_payments: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct PaymentRecord {
    pub payment_id: u64,
    pub payer: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
    pub bump: u8,
}

#[error_code]
pub enum ErrorCode {
    #[msg("No funds available to withdraw")]
    NoFundsToWithdraw,
    #[msg("Invalid new owner address")]
    InvalidNewOwner,
}
