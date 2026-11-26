use anchor_lang::prelude::*;
use raydium_clmm_cpi::cpi::accounts::SwapSingleV2;

#[allow(clippy::too_many_arguments)]
pub fn swap_v2_cpi<'a, 'b, 'c, 'info>(
    clmm_program: AccountInfo<'info>,
    payer: AccountInfo<'info>,
    amm_config: AccountInfo<'info>,
    pool_state: AccountInfo<'info>,
    input_token_account: AccountInfo<'info>,
    output_token_account: AccountInfo<'info>,
    input_vault: AccountInfo<'info>,
    output_vault: AccountInfo<'info>,
    observation_state: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    token_program_2022: AccountInfo<'info>,
    memo_program: AccountInfo<'info>,
    input_vault_mint: AccountInfo<'info>,
    output_vault_mint: AccountInfo<'info>,
    remaining_accounts: &[AccountInfo<'info>],
    signer_seeds: &[&[&[u8]]],
    amount: u64,
    other_amount_threshold: u64,
    sqrt_price_limit_x64: u128,
    is_base_input: bool,
) -> Result<()> {
    let cpi_accounts = SwapSingleV2 {
        payer,
        amm_config,
        pool_state,
        input_token_account,
        output_token_account,
        input_vault,
        output_vault,
        observation_state,
        token_program,
        token_program_2022,
        memo_program,
        input_vault_mint,
        output_vault_mint,
    };

    let cpi_ctx = CpiContext::new_with_signer(clmm_program, cpi_accounts, signer_seeds)
        .with_remaining_accounts(remaining_accounts.to_vec());

    raydium_clmm_cpi::cpi::swap_v2(
        cpi_ctx,
        amount,
        other_amount_threshold,
        sqrt_price_limit_x64,
        is_base_input,
    )
}
