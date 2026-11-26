pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use error::*;
pub use instructions::*;
pub use state::*;

declare_id!("HBdEu7TNtdBnR5sLzczBpeMJddzcxxEfVtaqYn1CjyKp");

#[program]
pub mod vault {
    use super::*;

    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        instructions::initialize_vault::handler(ctx)
    }

    pub fn create_user_card(ctx: Context<CreateUserCard>) -> Result<()> {
        instructions::create_user_card::handler(ctx)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handler(ctx, amount)
    }
}
