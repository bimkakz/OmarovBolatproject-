export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

export function getRpcUrl(): string {
  return (
    import.meta.env.VITE_RPC_URL?.trim() || "https://api.devnet.solana.com"
  );
}
