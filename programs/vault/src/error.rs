use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Calculated shares amount is too small (evaluated to zero)")]
    SharesTooSmall,
    #[msg("Math overflow occurred")]
    MathOverflow,
    #[msg("Vault has no shares")]
    VaultEmpty,
    #[msg("Calculated tokens amount is too small (evaluated to zero)")]
    WithdrawTooSmall,
    #[msg("User card has insufficient shares recorded")]
    InsufficientCardShares,
}
