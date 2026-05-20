import type { AssetClass, LiquidityTier, HoldingSource } from '@/db/schema';

export type { AssetClass, LiquidityTier, HoldingSource };

export const ASSET_CLASSES: AssetClass[] = ['public', 'private', 'real_estate', 'crypto', 'cash'];

export const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  public: 'Public markets',
  private: 'Private',
  real_estate: 'Real estate',
  crypto: 'Crypto',
  cash: 'Cash',
};

export const ASSET_CLASS_COLOR: Record<AssetClass, string> = {
  public: '#185FA5',
  real_estate: '#1D9E75',
  crypto: '#EF9F27',
  private: '#7F77DD',
  cash: '#888780',
};

// Дефолтный тир ликвидности по классу актива (можно переопределить вручную).
export const DEFAULT_LIQUIDITY: Record<AssetClass, LiquidityTier> = {
  cash: 't0',
  public: 't7',
  crypto: 't90',
  private: 'locked',
  real_estate: 'locked',
};

// Запись позиции, как её отдаёт CSV-парсер или AI до записи в БД.
export type ParsedHolding = {
  assetClass: AssetClass;
  name: string;
  symbol?: string | null;
  quantity?: number | null;
  value: number;
  costBasis?: number | null;
  account?: string | null;
  liquidityTier?: LiquidityTier | null;
  note?: string | null;
  raw?: string | null;
};
