use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct VaultState {
    pub admin: Pubkey,
    pub token_mint: Pubkey,
    pub vault_token_account: Pubkey,
    pub share_mint: Pubkey,
    pub total_tokens: u64,
    pub total_shares: u64,
    pub bump: u8,
    pub in_market: bool,
    pub token_mint_b: Pubkey,
    pub vault_token_account_b: Pubkey,
    pub position_open: bool,
    pub position_nft_mint: Pubkey,
    pub personal_position: Pubkey,
}

#[account]
#[derive(InitSpace)]
pub struct UserCard {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub deposited: u64,
    pub shares: u64,
    pub bump: u8,
}
