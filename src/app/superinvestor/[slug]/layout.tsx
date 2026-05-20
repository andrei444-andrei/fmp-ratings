import { notFound } from 'next/navigation';
import { investorBySlug } from '@/lib/superinvestor/registry';
import InvestorTabs from '../_components/InvestorTabs';

export default async function InvestorLayout({
  children, params,
}: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const inv = investorBySlug(slug);
  if (!inv) notFound();
  return (
    <>
      <InvestorTabs slug={slug} />
      {children}
    </>
  );
}
