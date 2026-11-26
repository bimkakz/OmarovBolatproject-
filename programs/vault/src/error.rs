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
    #[msg("Only admin can perform this action")]
    Unauthorized,
    #[msg("Vault funds are currently in market")]
    InMarket,
    #[msg("Pool or pool vaults do not match vault tokens")]
    WrongPool,
    #[msg("Token B balance must be zero before syncing vault")]
    TokenBNotZero,
    #[msg("Pair token has already been added")]
    PairTokenAlreadyAdded,
    #[msg("Pair token has not been added yet")]
    PairTokenNotAdded,
    #[msg("A position is already open for this vault")]
    PositionAlreadyOpen,
    #[msg("The vault does not own this open position")]
    NoOpenPosition,
    #[msg("Close the open position before syncing the vault")]
    PositionOpen,
}
