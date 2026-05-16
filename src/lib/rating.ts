// 1=Strong Sell, 2=Sell, 3=Hold, 4=Buy, 5=Strong Buy
const RATING_MAP: Record<string, number> = {
  'strong sell':1,'conviction sell':1,
  'sell':2,'underperform':2,'underweight':2,'negative':2,'reduce':2,
  'market underperform':2,'sector underperform':2,'weak hold':2,'moderate sell':2,
  'hold':3,'neutral':3,'market perform':3,'equal weight':3,'equal-weight':3,
  'in-line':3,'in line':3,'sector perform':3,'sector weight':3,'peer perform':3,
  'mixed':3,'perform':3,
  'buy':4,'outperform':4,'overweight':4,'positive':4,'add':4,'accumulate':4,
  'market outperform':4,'sector outperform':4,'long-term buy':4,'speculative buy':4,'moderate buy':4,
  'strong buy':5,'conviction buy':5,'top pick':5,
};

export function normalizeRating(rating: string | null | undefined): number | null {
  if (!rating) return null;
  const r = String(rating).toLowerCase().trim();
  if (RATING_MAP[r] != null) return RATING_MAP[r];
  if (r.includes('strong buy') || r.includes('conviction buy') || r.includes('top pick')) return 5;
  if (r.includes('strong sell') || r.includes('conviction sell')) return 1;
  if (r.includes('outperform') || r.includes('overweight') || r.includes('accumulate') || r.includes('positive')) return 4;
  if (r.includes('underperform') || r.includes('underweight') || r.includes('reduce') || r.includes('negative')) return 2;
  if (r.includes('hold') || r.includes('neutral') || r.includes('equal') || r.includes('market perform') ||
      r.includes('peer perform') || r.includes('sector perform') || r.includes('in-line') || r.includes('in line')) return 3;
  if (r.includes('buy')) return 4;
  if (r.includes('sell')) return 2;
  return null;
}

export function labelFor(n: number | null): string {
  if (!n) return '';
  return ({1:'Strong Sell',2:'Sell',3:'Hold',4:'Buy',5:'Strong Buy'} as Record<number,string>)[n] || '';
}
