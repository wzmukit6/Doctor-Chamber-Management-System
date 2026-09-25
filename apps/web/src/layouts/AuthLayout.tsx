import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import { setLanguage } from '@/i18n';

export function AuthLayout({ title, subtitle, children, aside }: { title: string; subtitle?: string; children: ReactNode; aside?: ReactNode }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="h-8 w-8" />
          <div>
            <p className="text-sm font-semibold text-ink">{t('app.name')}</p>
            <p className="text-2xs text-ink-subtle">{t('app.tagline')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setLanguage(i18n.language === 'bn' ? 'en' : 'bn')}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-ink-muted hover:bg-surface"
        >
          <Languages className="h-4 w-4" aria-hidden />
          {i18n.language === 'bn' ? 'English' : 'বাংলা'}
        </button>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-12 pt-6 sm:pt-12">
        <div className={aside ? 'grid w-full max-w-4xl gap-6 md:grid-cols-[minmax(0,26rem)_1fr] md:items-start' : 'w-full max-w-md'}>
          <div className="card p-6 sm:p-8">
            <h1 className="text-lg font-semibold text-ink">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>
          {aside}
        </div>
      </main>
      <footer className="pb-6 text-center text-2xs text-ink-subtle">{t('auth.secure_notice')}</footer>
    </div>
  );
}
