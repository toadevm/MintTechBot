-- Migration: Add Helius webhook support for Solana NFT tracking
-- Date: 2025-10-07
-- Description: Adds helius_webhook_id and marketplace columns to tracked_tokens table

-- Add helius_webhook_id column for Solana webhook tracking
ALTER TABLE tracked_tokens
ADD COLUMN IF NOT EXISTS helius_webhook_id VARCHAR(255);

-- Add marketplace column to distinguish between OpenSea, Magic Eden, etc.
ALTER TABLE tracked_tokens
ADD COLUMN IF NOT EXISTS marketplace VARCHAR(50) DEFAULT 'opensea';

-- Create index for faster helius webhook lookups
CREATE INDEX IF NOT EXISTS idx_tracked_tokens_helius_webhook
ON tracked_tokens(helius_webhook_id)
WHERE helius_webhook_id IS NOT NULL;

-- Create index for marketplace filtering
CREATE INDEX IF NOT EXISTS idx_tracked_tokens_marketplace
ON tracked_tokens(marketplace);

-- Update existing records to have opensea as default marketplace
UPDATE tracked_tokens
SET marketplace = 'opensea'
WHERE marketplace IS NULL;
