// Foreign mega-cap ADR-листинги, которых нет в S&P 500, но они торгуются на
// US-биржах и у FMP grades есть данные. Добавляются к динамически
// реконструированному составу S&P 500 на дату.
export const FOREIGN_ADR: readonly string[] = [
  'TSM','ASML','BABA','JD','PDD','SAP','BIDU','TCEHY',
  'NVO','NVS','AZN','GSK','SNY','RHHBY','NSRGY','UL','BUD',
  'TM','SHEL','BP','TTE','EQNR','HSBC','LVMUY','BHP','VALE','PBR',
  'DEO','INFY','SONY',
];
