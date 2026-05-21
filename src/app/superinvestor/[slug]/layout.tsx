import { notFound } from 'next/navigation';
import { getInvestorBySlugAsync } from '@/lib/superinvestor/investors-store';
import InvestorTabs from '../_components/InvestorTabs';

export default async function InvestorLayout({
  children, params,
}: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const inv = await getInvestorBySlugAsync(slug);
  if (!inv) notFound();
  return (
    <>
      <InvestorTabs slug={slug} />
      {children}
    </>
  );
}
