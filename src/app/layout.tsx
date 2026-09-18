import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Tempo — движение объединяет', description: 'Делитесь тренировками и находите свой темп.' };
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="ru"><body>{children}</body></html>; }
